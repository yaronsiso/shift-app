// supabase/functions/analyze-sketch-v2-scope/index.ts
//
// Stage 0 ("scope") of the new staged geometry pipeline (session 20, per
// Yaron + ChatGPT-reviewed plan — see project docs claude/49-51). This is a
// BRAND NEW, SEPARATE Edge Function. It does not replace, call, or modify
// `analyze-sketch` (the live v15 function) in any way — v15 stays the
// production baseline while this new pipeline is built and tested stage by
// stage on a separate track.
//
// What this function does, and nothing more (deliberately narrow, per
// Yaron's explicit "one small step" instruction):
//   1. Given an already-uploaded sketch image (same `renders` storage
//      bucket + <uid>/... path convention `analyze-sketch` already uses —
//      no new bucket), identify where on the sheet the main floor plan is
//      (mainFloorPlanBboxPct) and which regions are separate details/
//      cross-sections to ignore (excludedRegions). One OpenAI call, no
//      retry loop (unlike v13/v14/v15's multi-attempt validator loop —
//      this stage intentionally has none yet, so a failure is visible
//      as-is rather than silently retried).
//   2. Persists the result as a row in `analysis_artifacts` (stage='scope'),
//      linked to a row in `analysis_jobs` — NOT into `sketch_analyses`
//      (the table `analyze-sketch` v1-v15 use), which stays untouched.
//   3. Returns enough metadata (duration, attempt number, confidence) for
//      the caller to inspect and compare runs, per Yaron's explicit ask.
//
// Explicitly NOT done here (out of scope for this step, by instruction):
//   - No envelope/room/wall/opening/stair extraction at all.
//   - No image cropping (that happens client-side, in Flutter, using the
//     bbox this function returns — see the Flutter side of this change).
//   - No deterministic sanity-checking of the bbox (e.g. rejecting a
//     suspiciously tiny/huge box) — flagged as a possible future addition,
//     not built now, to keep this step exactly as small as agreed.
//
// The SCOPE_SYSTEM_PROMPT text below is intentionally DUPLICATED from
// `analyze-sketch/index.ts` (v15) rather than imported/shared, precisely so
// that touching this new function can never affect the v15 file. Once the
// new pipeline replaces v15 (if it does), this duplication goes away.
// DRAWING_SCOPE_JSON_SCHEMA / DrawingScope, however, ARE imported read-only
// from the existing v1 shared schema file — Stage 0's output shape hasn't
// changed, so re-declaring it would just be duplication with no benefit,
// and importing a type/const does not modify that file.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DRAWING_SCOPE_JSON_SCHEMA,
  type DrawingScope,
} from "../_shared/floor_plan_schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

// Duplicated from analyze-sketch v15's SCOPE_SYSTEM_PROMPT verbatim — see
// the file header above for why this is a deliberate, documented copy
// rather than a shared import.
const SCOPE_SYSTEM_PROMPT = `
את/ה עוזר/ת שממיין/ת דף סריקה/צילום של שרטוט אדריכלי, **לפני** כל ניתוח
אדריכלי בפועל. המשימה שלך היא צרה ומוגדרת: לזהות היכן בתוך התמונה נמצאת
תוכנית הקומה הראשית (ה-floor plan עצמו - הקירות, החדרים, הפתחים של
הבית/הדירה), ולהבדיל אותה מכל דבר אחר שמופיע על אותו דף/תמונה ושאינו
חלק מגיאומטריית הבית.

לדפי שרטוט מקצועיים יש לעיתים קרובות, מתחת או לצד תוכנית הקומה הראשית,
פרטי בנייה/חתכים/פריסות נוספים - למשל פרט מוגדל של חדר רחצה, חתך של
קיר, פריסת חזית של אלמנט בודד. אלה **אינם** חלק מתוכנית הקומה ואסור
שהגיאומטריה שלהם תיכנס כחדרים נוספים בניתוח הבא.

סימנים טיפוסיים לפרט/חתך נפרד (לא תוכנית קומה): כיתוב כמו "חתך", "פרט",
"מ.ד. חתך", מספור/אותיות של חתך (א-א, ב-ב), קנה מידה שונה מהתוכנית
הראשית, מסגרת/גבול גרפי נפרד סביב הציור, תוכן שחוזר על עצמו (כמה גרסאות
של אותו חדר/אלמנט מזוויות שונות).

החזר/י אך ורק:
1. mainFloorPlanBboxPct - תיבה מלבנית (באחוזים מגודל התמונה המלאה, 0-100
   בכל ציר, כאשר 0,0 היא הפינה השמאלית-עליונה) שמכילה את כל תוכנית הקומה
   הראשית ורק אותה.
2. excludedRegions - רשימת תיבות (באותו פורמט אחוזים) של אזורים שזיהית
   כפרטים/חתכים/ציורים נפרדים שאינם חלק מתוכנית הקומה, כל אחת עם reason
   קצר בעברית שמסביר למה סומן כך.
3. scopeConfidence - מספר בין 0 ל-1 שמבטא כמה את/ה בטוח/ה בזיהוי הזה.

אם כל הדף הוא תוכנית קומה אחת בלבד, בלי שום פרט/חתך נוסף - mainFloorPlanBboxPct
מכסה את כל התמונה (0,0 עד 100,100) ו-excludedRegions הוא מערך ריק. אל
תנתח/י חדרים, קירות, מידות או פתחים בשלב הזה - זה נעשה בשלב נפרד אחר-כך.
`.trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callOpenAiJsonSchema(
  messages: Array<{ role: string; content: unknown }>,
  schemaName: string,
  schema: unknown,
): Promise<
  | { ok: true; parsed: unknown; usage: Record<string, unknown> }
  | { ok: false; detail: string }
> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });
  } catch (err) {
    return { ok: false, detail: `connection error calling OpenAI: ${String(err)}` };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, detail: `OpenAI API error: ${response.status} ${errorText}` };
  }

  const openaiJson = await response.json();
  const rawContent = openaiJson?.choices?.[0]?.message?.content;
  if (!rawContent) {
    return { ok: false, detail: "OpenAI response missing content" };
  }

  try {
    const parsed = JSON.parse(rawContent);
    return { ok: true, parsed, usage: openaiJson?.usage ?? {} };
  } catch (err) {
    return { ok: false, detail: `failed to parse OpenAI JSON content: ${String(err)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "unauthorized", detail: "missing bearer token" }, 401);
  }

  let body: { imagePath?: string; jobId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  const imagePathInput = body.imagePath;
  const existingJobId = body.jobId;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized", detail: "invalid token" }, 401);
  }
  const userId = userData.user.id;

  // --- resolve/create the job row -----------------------------------------

  let jobId: string;
  let originalImagePath: string;
  let attempt: number;

  if (existingJobId) {
    // Retry of an existing job: re-run stage 0 on the same original image.
    const { data: jobRow, error: jobFetchError } = await supabase
      .from("analysis_jobs")
      .select("id, user_id, original_image_path, attempt")
      .eq("id", existingJobId)
      .single();

    if (jobFetchError || !jobRow) {
      return jsonResponse({ error: "not_found", detail: "job not found" }, 404);
    }
    const job = jobRow as {
      id: string;
      user_id: string;
      original_image_path: string;
      attempt: number | null;
    };
    if (job.user_id !== userId) {
      return jsonResponse({ error: "forbidden", detail: "job does not belong to this user" }, 403);
    }

    jobId = job.id;
    originalImagePath = job.original_image_path;
    attempt = (job.attempt ?? 0) + 1;

    await supabase
      .from("analysis_jobs")
      .update({
        status: "processing",
        current_stage: "scope",
        attempt,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } else {
    // New job: imagePath is required.
    if (!imagePathInput || typeof imagePathInput !== "string") {
      return jsonResponse(
        { error: "bad_request", detail: "imagePath is required when jobId is not provided" },
        400,
      );
    }
    if (!imagePathInput.startsWith(`${userId}/`)) {
      return jsonResponse(
        { error: "forbidden", detail: "imagePath does not belong to this user" },
        403,
      );
    }

    originalImagePath = imagePathInput;
    attempt = 1;

    const { data: insertedJob, error: insertJobError } = await supabase
      .from("analysis_jobs")
      .insert({
        user_id: userId,
        original_image_path: originalImagePath,
        status: "processing",
        current_stage: "scope",
        attempt,
      })
      .select("id")
      .single();

    if (insertJobError || !insertedJob) {
      return jsonResponse(
        { error: "internal_error", detail: "failed to create analysis job" },
        500,
      );
    }
    jobId = (insertedJob as { id: string }).id;
  }

  async function failJob(errorMessage: string) {
    await supabase
      .from("analysis_jobs")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }

  // --- run stage 0 ----------------------------------------------------------

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("renders")
    .createSignedUrl(originalImagePath, 600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    await failJob("failed to create signed url for sketch image");
    return jsonResponse(
      { error: "internal_error", detail: "failed to sign sketch image url", jobId },
      500,
    );
  }

  const startedAt = Date.now();

  const result = await callOpenAiJsonSchema(
    [
      { role: "system", content: SCOPE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "זהה/י את תיבת תוכנית הקומה הראשית ואת האזורים שאינם חלק ממנה, לפי הכללים שקיבלת." },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "drawing_scope",
    DRAWING_SCOPE_JSON_SCHEMA,
  );

  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    await failJob(result.detail);
    return jsonResponse(
      { error: "internal_error", detail: result.detail, jobId },
      500,
    );
  }

  const scope = result.parsed as DrawingScope;

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "scope",
      version: attempt,
      payload: {
        mainFloorPlanBboxPct: scope.mainFloorPlanBboxPct,
        excludedRegions: scope.excludedRegions,
        scopeConfidence: scope.scopeConfidence,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: result.usage,
      },
    })
    .select("id")
    .single();

  if (artifactError || !artifactRow) {
    await failJob("failed to persist scope artifact");
    return jsonResponse(
      { error: "internal_error", detail: "failed to persist scope artifact", jobId },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "stage_complete",
      current_stage: "scope",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return jsonResponse({
    jobId,
    artifactId: (artifactRow as { id: string }).id,
    mainFloorPlanBboxPct: scope.mainFloorPlanBboxPct,
    excludedRegions: scope.excludedRegions,
    scopeConfidence: scope.scopeConfidence,
    durationMs,
    attempt,
  });
});

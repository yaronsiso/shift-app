// supabase/functions/analyze-sketch-v2-measurements/index.ts
//
// ⚠️⚠️ SESSION 23 FOLLOW-UP #8 — LEGACY / DEBUG-ONLY, NOT PART OF THE
// AUTHORITATIVE PIPELINE ANYMORE. Yaron's explicit architecture decision:
// analyze-sketch-v2-envelope no longer requires this stage and never reads
// its output. The Flutter UI does not need to call this function before
// Stage 1 (envelope) anymore. Authoritative dimension resolution now runs
// entirely through analyze-sketch-v2-page-dimensions ->
// dimension_chain_builder_v3.ts -> dimension_extent_grouping_v3.ts ->
// dimension_chain_resolver_v3.ts -> resolved_page_dimensions_v3.ts — see
// that last file's own header for the full before/after diagram. This
// function is kept only for manual comparison/debugging (its output is
// still a valid, harmless artifact row under stage='measurements', just
// one nothing downstream reads) and is NOT deleted yet per Yaron's
// explicit instruction, pending one full regression run confirming Stage 1
// works correctly from page_dimensions alone. Do not add new callers of
// this function; do not make Stage 1 depend on it again.
//
// Everything below this banner is UNCHANGED from the original (session 21)
// version — no logic was touched in this round.
//
// NEW Edge Function — Pass 0.5 ("measurements") of the v2 pipeline, inserted
// between Stage 0 ("scope") and Stage 1 ("envelope"). Session 21 (continued
// from the same session that built Stage 0/Stage 1) — built after a real
// test exposed a concrete accuracy bug: Stage 1, given a drawing with large
// explicit printed dimensions (16.00m x 10.00m), returned a polygon of
// 17.80m x 10.25m — an 11% error on the long axis — despite its own `notes`
// claiming it had used the printed numbers. See
// _shared/dimension_extraction_schema.ts's header and claude/00_HANDOFF for
// the full before/after numbers and the architecture discussion (Yaron
// brought back an independent ChatGPT review that reached the same
// conclusion this session did).
//
// What this function does, and nothing more:
//   1. Given a jobId whose Stage 0 ("scope") already ran and uploaded a
//      crop, ask the model to do ONLY ONE job: find and transcribe every
//      written dimension chain that measures the building's OUTER
//      envelope. No geometry, no rooms, no polygon, no arithmetic — see
//      DIMENSION_EXTRACTION_SYSTEM_PROMPT below for the exact instruction.
//      This deliberately narrows the model's task so a single call isn't
//      simultaneously doing OCR/reading AND geometric reasoning (the
//      conflation believed to cause the bug above).
//   2. One OpenAI call, no retry loop (same precedent as Stage 0/original
//      Stage 1 — a retry loop can be added later if real runs show it's
//      needed).
//   3. Persists the result as a new row in `analysis_artifacts`
//      (stage='measurements', linked to the same job) — no new migration,
//      the table already supports any stage name.
//
// (Historical, no longer accurate as of session 23 follow-up #8 — see
// banner above): "Consumed by the (now updated) analyze-sketch-v2-envelope,
// which requires this stage to have run first..."
//
// Explicitly NOT done here:
//   - No geometry/topology/polygon of any kind.
//   - No room/wall/opening/stair/special-element detection.
//   - No summing of segment values into a chain total — that's done in
//     CODE by the consumer (analyze-sketch-v2-envelope), never by the
//     model, so a single deterministic addition can never be silently
//     wrong the way free-form generation can.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DIMENSION_EXTRACTION_JSON_SCHEMA,
  type DimensionExtraction,
} from "../_shared/dimension_extraction_schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const DIMENSION_EXTRACTION_SYSTEM_PROMPT = `
את/ה מערכת לחילוץ מידות כתובות מתוך תמונה של שרטוט קומה (crop שכבר בוצע
מראש לתוכנית עצמה) - את/ה **לא** מערכת לשחזור גיאומטריה, ולא אדריכל/ית.

המשימה שלך צרה ומוגדרת מאוד: למצוא ולתעד אך ורק שרשראות-מידה (קווי מידה
עם מספרים כתובים לאורכם) שמודדות את **ההיקף החיצוני** של מעטפת הבניין/
הדירה - הצלעות החיצוניות של הבניין. התעלם/י לגמרי מכל מידה שמודדת חדר
פנימי בודד, ריהוט, שטח מ"ר, גובה-תקרה, או כל דבר שאינו קו-מידה על קו
המתאר החיצוני של הבניין עצמו.

כללים קשוחים, בלי יוצא מן הכלל:

1. אסור להעריך שום אורך לפי פרופורציה חזותית או ניחוש. תעד/י אך ורק
   מספרים שכתובים בפועל וקריאים בתמונה.

2. לעולם אל תחשב/י סכום של כמה מספרים בעצמך, גם אם את/ה בטוח/ה שהחישוב
   נכון - זה לא תפקידך בשלב הזה. תעתיק/י כל מספר בודד בדיוק כפי שהוא
   כתוב. אם המידה כתובה ביחידה אחרת (למשל סנטימטרים) - המר/י למטרים
   בשדה valueM, אבל שמור/י גם את הטקסט המקורי המדויק כפי שהוא מופיע
   בתמונה בשדה text (כולל היחידה אם כתובה).

3. לכל שרשרת-מידה שאת/ה מזהה/ה: ציין/י ציר (horizontal/vertical לפי
   הכיוון שלה בתמונה - לא לפי סיבוב/הטיה של הצילום עצמו), תיאור-מיקום
   קצר וברור בעברית (למשל "צלע עליונה חיצונית", "צלע ימנית חיצונית"),
   ואת רשימת הפלחים הבודדים (segments) לפי הסדר שבו הם מופיעים לאורך
   הקו - משמאל לימין בשרשרת אופקית, מלמעלה למטה בשרשרת אנכית.

4. אם מופיע גם מספר-סיכום בודד שמסמן את הטווח הכולל של כל השרשרת בבת
   אחת (לדוגמה קו-מידה עליון שכתוב עליו "16.00" שמשתרע מעל כמה מספרים
   קטנים יותר כמו 5.20/2.80/3.60/4.40) - תעד/י אותו בנפרד בשדה
   overallValueM/overallText. אם אין בתמונה מספר-סיכום נפרד כזה, השאר/י
   את השדה הזה null - אל תחשב/י אותו בעצמך מתוך הפלחים.

5. אם באותה תמונה יש יותר משרשרת-מידה אחת לאותו ציר (למשל גם למעלה וגם
   למטה) - תעד/י את שתיהן כשתי כניסות נפרדות במערך chains, אל תמזג/י
   ביניהן.

6. אם אין בתמונה שום מידה כתובה קריאה שמודדת את ההיקף החיצוני - החזר/י
   chains כמערך ריק. זו תשובה כנה ותקינה לגמרי, לא שגיאה ולא כישלון.

7. אל תזהה/י בשלב הזה חדרים, קירות, פתחים, גרם מדרגות, פינות, זוויות, או
   כל דבר גיאומטרי אחר - זה נעשה בשלב נפרד ומאוחר יותר, לא כאן.
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

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") {
    return jsonResponse({ error: "bad_request", detail: "jobId is required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized", detail: "invalid token" }, 401);
  }
  const userId = userData.user.id;

  // --- verify the job exists, belongs to this user, and Stage 0 (scope)
  // already ran on it (same precondition Stage 1/envelope already checks) --

  const { data: jobRow, error: jobFetchError } = await supabase
    .from("analysis_jobs")
    .select("id, user_id")
    .eq("id", jobId)
    .single();

  if (jobFetchError || !jobRow) {
    return jsonResponse({ error: "not_found", detail: "job not found" }, 404);
  }
  const job = jobRow as { id: string; user_id: string };
  if (job.user_id !== userId) {
    return jsonResponse({ error: "forbidden", detail: "job does not belong to this user" }, 403);
  }

  const { data: scopeArtifacts, error: scopeCheckError } = await supabase
    .from("analysis_artifacts")
    .select("id")
    .eq("job_id", jobId)
    .eq("stage", "scope")
    .limit(1);

  if (scopeCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check scope stage", jobId },
      500,
    );
  }
  if (!scopeArtifacts || scopeArtifacts.length === 0) {
    return jsonResponse(
      {
        error: "bad_request",
        detail: "stage 0 (scope) must complete for this job before measurements can run",
        jobId,
      },
      400,
    );
  }

  // next version number for this job's measurements stage (mirrors
  // envelope's own version-tracking — a re-run is a new artifact, never an
  // overwrite).
  const { data: existingArtifacts, error: versionCheckError } = await supabase
    .from("analysis_artifacts")
    .select("version")
    .eq("job_id", jobId)
    .eq("stage", "measurements")
    .order("version", { ascending: false })
    .limit(1);

  if (versionCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check measurements version", jobId },
      500,
    );
  }
  const attempt =
    existingArtifacts && existingArtifacts.length > 0
      ? ((existingArtifacts[0] as { version: number }).version + 1)
      : 1;

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

  // --- run pass 0.5 ---------------------------------------------------------

  const croppedImagePath = `${userId}/analysis/${jobId}/cropped.jpg`;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("renders")
    .createSignedUrl(croppedImagePath, 600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    await failJob("failed to create signed url for cropped image");
    return jsonResponse(
      {
        error: "internal_error",
        detail: "failed to sign cropped image url (did stage 0 upload a crop for this job?)",
        jobId,
      },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "processing",
      current_stage: "measurements",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const startedAt = Date.now();

  const result = await callOpenAiJsonSchema(
    [
      { role: "system", content: DIMENSION_EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "תעד/י את כל שרשראות-המידה שמודדות את ההיקף החיצוני של הבניין בתמונה הזו, לפי הכללים שקיבלת.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "dimension_extraction",
    DIMENSION_EXTRACTION_JSON_SCHEMA,
  );

  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    await failJob(result.detail);
    return jsonResponse({ error: "internal_error", detail: result.detail, jobId }, 500);
  }

  const extraction = result.parsed as DimensionExtraction;

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "measurements",
      version: attempt,
      payload: {
        chains: extraction.chains,
        notes: extraction.notes,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: result.usage,
      },
    })
    .select("id")
    .single();

  if (artifactError || !artifactRow) {
    await failJob("failed to persist measurements artifact");
    return jsonResponse(
      { error: "internal_error", detail: "failed to persist measurements artifact", jobId },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "stage_complete",
      current_stage: "measurements",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return jsonResponse({
    jobId,
    artifactId: (artifactRow as { id: string }).id,
    chains: extraction.chains,
    notes: extraction.notes,
    durationMs,
    attempt,
  });
});


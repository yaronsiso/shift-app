// supabase/functions/analyze-sketch-v2-envelope/index.ts
//
// Stage 1 ("envelope") of the new staged geometry pipeline (session 21,
// direct continuation of Stage 0 "scope" from session 20 — see
// claude/51/52 for that history). BRAND NEW, SEPARATE Edge Function. Does
// not replace, call, or modify `analyze-sketch` (v15, production) or
// `analyze-sketch-v2-scope` (Stage 0) in any way — all three coexist.
//
// What this function does, and nothing more (same "one small step"
// discipline as Stage 0, confirmed again by Yaron before writing this):
//   1. Given a jobId whose Stage 0 ("scope") already ran and uploaded a
//      client-side crop (see sketch_scope_service.dart's `uploadCrop`,
//      path convention `<uid>/analysis/<jobId>/cropped.jpg` in the
//      existing `renders` bucket — no new bucket/path convention here),
//      identify ONLY the building's outer envelope polygon
//      (buildingEnvelope.vertices, schema v2). Rooms, interior walls,
//      openings, stairs and special elements are explicitly NOT
//      identified in this stage — the model is instructed to return empty
//      arrays for all of them. That comes in later, separate stages.
//   2. One OpenAI call, no retry loop (same precedent as Stage 0 — a
//      corrective retry loop can be added later if real runs show it's
//      needed, not built speculatively now).
//   3. Persists the result as a NEW row in the existing `analysis_artifacts`
//      table (stage='envelope', linked to the same job Stage 0 created) —
//      no new migration needed, the table's `stage`/`payload` columns
//      already support any stage name.
//
// Explicitly NOT done here (out of scope for this step, by instruction):
//   - No room/wall/opening/stair/special-element detection.
//   - No corrective retry-on-validation-failure loop yet.
//   - No new job creation — this always operates on an existing job whose
//     Stage 0 (scope) already completed and uploaded a crop. If it hasn't,
//     this function fails cleanly rather than guessing.
//
// Reuses the v2 schema (`floor_plan_schema_v2.ts`, written in session 20,
// not consumed by anything until now) read-only — this is the first stage
// that actually produces a FloorPlanAnalysisV2-shaped response, even
// though only buildingEnvelope/confidence/notes are meaningful in it yet.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  FLOOR_PLAN_JSON_SCHEMA_V2,
  type FloorPlanAnalysisV2,
} from "../_shared/floor_plan_schema_v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

// Rules 1/2/3/4 below are direct, deliberate adaptations of language
// already validated in production (`analyze-sketch` v14/v15's
// GEOMETRY_SYSTEM_PROMPT rules 4 and 17 — see claude/49/50) — narrowed
// down to ONLY the envelope, since this stage does not touch rooms/walls
// at all (unlike v14/v15's Pass 1A, which did envelope+rooms+walls
// together). The input image here is already the Stage 0 crop, so unlike
// v15 there is no need to tell the model to ignore separate detail/
// section drawings elsewhere on the page — Stage 0 already removed them.
const ENVELOPE_SYSTEM_PROMPT = `
את/ה אדריכל/ית שמנתח/ת שרטוט קומה שצולם/נסרק (התמונה שקיבלת כבר חתוכה
מראש לתוכנית הקומה עצמה בלבד). בשלב הזה (Stage 1: מעטפת בלבד) המשימה
שלך מצומצמת בכוונה: לזהות אך ורק את קו הגבול החיצוני השלם של הבניין/
הדירה - כולל כל שינוי כיוון שלו, פינות ישרות ואלכסוניות כאחד.

אל תזהה/י בשלב הזה חלוקה לחדרים, קירות פנימיים, פתחים, גרם מדרגות או
אלמנטים מיוחדים - כל אלה יתבצעו בשלבים נפרדים מאוחר יותר. החזר/י תמיד
rooms, walls, stairs ו-specialElements כמערכים ריקים, ו-
coordinateSystem.units כ-"meters".

כללים:

1. קביעת צירי הבניין לפני כל דבר אחר: קבע/י תחילה איזו צלע של המעטפת
   החיצונית היא הארוכה ואיזו הקצרה - לפי המידות הכתובות בפועל בשרטוט
   (קווי מידה/מספרים), אם יש כאלה - לא לפי כיוון הצילום או הסיבוב של
   התמונה.

2. אל תניח/י שצלע של המעטפת היא בהכרח אופקית או אנכית (זווית 0/90/180/270
   מעלות). קבע/י את מיקום כל קודקוד לפי הגיאומטריה הנראית בפועל בשרטוט.
   אם קו במעטפת יוצר זווית שאינה 0/90/180/270 מעלות (פינה חתוכה/אלכסונית)
   - יש להחזיר את הקודקוד האמיתי שמשקף את הזווית בפועל, ואסור "ליישר"
   אותו למלבן לצורך נוחות, גם אם רוב שאר הבניין מלבני.

3. עברו/י שיטתית סביב המעטפת השלמה בסדר רציף אחד (לא לקפוץ קדימה
   ואחורה) וסמנו כל שינוי כיוון אמיתי כקודקוד נפרד ב-
   buildingEnvelope.vertices.

4. אם את/ה לא מצליח/ה לעקוב אחרי מעטפת רציפה שלמה (למשל חלק ממנה לא ברור
   או חתוך בתמונה) - buildingEnvelope צריך להיות null. זו תשובה כנה
   ותקינה, עדיפה בהרבה על ניחוש.

5. אם יש בשרטוט מידות כתובות (מספרים/קווי מידה) - השתמש/י בהן לקבוע את
   קנה המידה האמיתי במטרים של הקואורדינטות שאת/ה מחזיר/ה. אם אין שום
   מידה כתובה בתמונה בכלל - קבע/י קואורדינטות עקביות ביחסים הנכונים בינן
   לבין עצמן (צורה ופרופורציות נכונות), והנמך/י את confidence בהתאם, במקום
   להמציא מידה מדויקת שאין לך דרך לדעת אותה.
`.trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidPoint(p: unknown): p is { x: number; y: number } {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as { x?: unknown }).x === "number" &&
    Number.isFinite((p as { x: number }).x) &&
    typeof (p as { y?: unknown }).y === "number" &&
    Number.isFinite((p as { y: number }).y)
  );
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
  // already ran on it -----------------------------------------------------

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
        detail: "stage 0 (scope) must complete for this job before envelope can run",
        jobId,
      },
      400,
    );
  }

  // next version number for this job's envelope stage (no retry loop
  // built into this function yet, but re-running it manually — e.g. a
  // "run again" debug button — should still be recorded as a new,
  // separate artifact version rather than overwriting).
  const { data: existingEnvelopeArtifacts, error: versionCheckError } = await supabase
    .from("analysis_artifacts")
    .select("version")
    .eq("job_id", jobId)
    .eq("stage", "envelope")
    .order("version", { ascending: false })
    .limit(1);

  if (versionCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check envelope version", jobId },
      500,
    );
  }
  const attempt =
    existingEnvelopeArtifacts && existingEnvelopeArtifacts.length > 0
      ? ((existingEnvelopeArtifacts[0] as { version: number }).version + 1)
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

  // --- run stage 1 ---------------------------------------------------------

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
      current_stage: "envelope",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const startedAt = Date.now();

  const result = await callOpenAiJsonSchema(
    [
      { role: "system", content: ENVELOPE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "זהה/י את המעטפת החיצונית של הבניין בתמונה החתוכה הזו, לפי הכללים שקיבלת.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "floor_plan_analysis_v2",
    FLOOR_PLAN_JSON_SCHEMA_V2,
  );

  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    await failJob(result.detail);
    return jsonResponse({ error: "internal_error", detail: result.detail, jobId }, 500);
  }

  const analysis = result.parsed as FloorPlanAnalysisV2;
  const envelope = analysis.buildingEnvelope;

  if (envelope !== null) {
    const vertices = Array.isArray(envelope?.vertices) ? envelope.vertices : [];
    if (vertices.length < 3 || vertices.some((v) => !isValidPoint(v))) {
      await failJob("model returned an invalid buildingEnvelope (fewer than 3 valid vertices)");
      return jsonResponse(
        {
          error: "internal_error",
          detail: "model returned an invalid buildingEnvelope (fewer than 3 valid vertices)",
          jobId,
        },
        500,
      );
    }
  }

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "envelope",
      version: attempt,
      payload: {
        buildingEnvelope: envelope,
        confidence: analysis.confidence,
        notes: analysis.notes,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: result.usage,
      },
    })
    .select("id")
    .single();

  if (artifactError || !artifactRow) {
    await failJob("failed to persist envelope artifact");
    return jsonResponse(
      { error: "internal_error", detail: "failed to persist envelope artifact", jobId },
      500,
    );
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "stage_complete",
      current_stage: "envelope",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return jsonResponse({
    jobId,
    artifactId: (artifactRow as { id: string }).id,
    buildingEnvelope: envelope,
    confidence: analysis.confidence,
    notes: analysis.notes,
    durationMs,
    attempt,
  });
});

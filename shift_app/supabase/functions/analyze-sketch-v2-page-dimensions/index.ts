// supabase/functions/analyze-sketch-v2-page-dimensions/index.ts
//
// Pass 1 ("page dimensions") of the v2 pipeline — session 22, rebuilt
// around "Patch 01: Measurement Integrity" (see
// ../_shared/page_dimensions_schema_v2.ts's header for full provenance:
// an external architecture audit, independently verified, that also found
// and fixed a real averaging bug in analyze-sketch-v2-envelope — see
// ../_shared/axis_extent_resolver.ts). This supersedes this session's own
// earlier, simpler version of this same function (built before the audit,
// never deployed) — same job, richer/safer data model.
//
// COMPLETELY SEPARATE from Stage 0 (scope), Pass 0.5 (measurements), and
// Stage 1 (envelope) — does not modify, replace, or get consumed by any
// of them yet. Its only precondition is Stage 0 having run (same crop it
// uses). Whether/how this eventually replaces Pass 0.5 as Stage 1's input
// is an explicit later decision, not made here.
//
// What this function does, and nothing more:
//   1. Given a jobId whose Stage 0 ("scope") already ran and uploaded a
//      crop, ask the model to transcribe EVERY legible printed
//      measurement on the page as RAW EVIDENCE — raw text, raw numeric
//      value (unconverted), unit exactly as indicated, whether that unit
//      was actually printed or just assumed, a semantic classification,
//      axis, an approximate bounding box on the page, and a short label.
//      The model does NOT convert units and does NOT sum anything — see
//      PAGE_DIMENSIONS_SYSTEM_PROMPT below.
//   2. One OpenAI call, no retry loop (same precedent as every other pass
//      in this pipeline).
//   3. CODE (never the model):
//      - converts mm/cm/m to meters (toMeters/normalizeMeasurements) —
//        an "unknown" unit is left unconverted, so an ambiguous bare
//        number can never quietly become authoritative;
//      - validates every chain's printed overall total against the sum
//        of its own referenced segments (validateChain) — reports a
//        mismatch, never silently corrects it;
//      - resolves ONE authoritative horizontal/vertical building extent
//        from the overall_building chains (resolveAuthoritativeExtent) —
//        and NEVER averages disagreeing chains into a fabricated number;
//        a real disagreement is reported as `status: "conflict"`.
//   4. Persists the raw evidence + all code-computed results as a new row
//      in `analysis_artifacts` (stage='page_dimensions').
//
// Explicitly NOT done here:
//   - No geometry/topology/polygon of any kind.
//   - No room/wall/opening/stair reconstruction — only reading and
//     classifying the printed numbers themselves.
//   - No unit conversion or chain summation by the model.
//   - Not wired into Stage 1 (envelope) yet — that requires an explicit
//     architecture decision (does it replace Pass 0.5, or run alongside
//     it?) that hasn't been made.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PAGE_DIMENSION_EVIDENCE_JSON_SCHEMA,
  type PageDimensionEvidence,
} from "../_shared/page_dimensions_schema_v2.ts";
import {
  normalizeMeasurements,
  resolveAuthoritativeExtent,
  validateChain,
} from "../_shared/measurement_resolver.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const PAGE_DIMENSIONS_SYSTEM_PROMPT = `
את/ה מערכת לתיעוד "עדות גולמית" של מידות כתובות מתוך תמונה של שרטוט קומה
(crop שכבר בוצע מראש לתוכנית עצמה) - את/ה **לא** מערכת לשחזור גיאומטריה,
ולא אדריכל/ית. המשימה שלך: לתעד כל מספר כתוב וקריא בתמונה שמייצג מידה
כלשהי - לא רק את ההיקף החיצוני, אלא כל מידה: חדרים, קירות, פתחים, שטחים,
מפלסים, גבהי-תקרה, מדרגות ועוד.

**חשוב מאוד - החלק החדש**: את/ה מתעד/ת עדות גולמית בלבד, לא מספרים
מעובדים:

1. לכל מידה בודדת, תן/י לה מזהה ייחודי (id, למשל "m1", "m2"...), ותעד/י:
   - rawText: הטקסט המדויק כפי שהוא כתוב בתמונה, מילה במילה/ספרה בספרה
     (למשל "5.20", "520", "5.20 מ'").
   - rawNumeric: המספר הגולמי בדיוק כפי שהוא כתוב, **בלי שום המרת יחידות**
     (אם כתוב "520" השאר/י 520, אל תהפוך/י ל-5.20 בעצמך - זה תפקיד הקוד,
     לא שלך).
   - unit: מה שכתוב בפועל ליד המספר - "mm"/"cm"/"m", או "unknown" אם אין
     יחידה כתובה במפורש ליד המספר הזה.
   - unitEvidence: "explicit" אם היחידה כתובה ממש ליד המספר הזה;
     "sheet_context" אם יש הערה כללית בשרטוט שקובעת יחידה לכל הדף (למשל
     "כל המידות בס"מ") אבל לא ליד המספר הספציפי הזה; "inferred" אם ניחשת
     לפי מוסכמה/הקשר בלי עיגון כתוב; "unknown" אם אין שום בסיס.
   - referenceType: סיווג סמנטי - overall_building / building_segment /
     room_dimension / room_area / wall_length / opening_width /
     opening_height / stair_tread / stair_riser / stair_width /
     elevation_level / ceiling_height / setback / structural / unknown.
   - axis: horizontal / vertical / diagonal / unknown - לפי הכיוון
     הנראה בתמונה עצמה, לא לפי סיבוב/הטיה של הצילום.
   - bboxPct: תיבה מלבנית מקורבת (אחוזים 0-100 מרוחב/גובה התמונה) שמראה
     איפה המספר הזה נמצא בתמונה. זו הערכה - לא צריך דיוק פיקסל-לפיקסל,
     אבל תעד/י אזור סביר, לא ניחוש אקראי.
   - label: תיאור קצר בעברית למה המידה מתייחסת (למשל "חדר שינה 1 - רוחב").
   - confidence: high/medium/low.

2. אסור להעריך שום אורך לפי פרופורציה חזותית או ניחוש. תעד/י אך ורק
   מספרים שכתובים בפועל וקריאים בתמונה. אם מספר לא קריא/מטושטש - אל
   תכלול/י אותו כלל.

3. לעולם אל תחשב/י סכום של כמה מספרים בעצמך - זה נעשה בקוד, לא על ידך.

4. מידות שמופיעות כשרשרת רציפה של כמה מספרים לאורך קו אחד - תעד/י כ-chain
   נפרד. chain **לא מכיל את הערכים עצמם** - הוא מפנה למזהים (id) של
   המידות שכבר תיעדת בשלב 1:
   - segmentMeasurementIds: רשימת ה-id-ים של הפלחים הבודדים, לפי הסדר
     שהם מופיעים (משמאל לימין באופקי, מלמעלה למטה באנכי).
   - overallMeasurementId: ה-id של מספר-הסיכום הנפרד אם יש כזה (וגם הוא
     חייב להיות מתועד כמידה נפרדת במערך measurements!), או null אם אין
     מספר-סיכום כתוב בנפרד.
   - level: "overall" (מודד את כל ההיקף החיצוני בבת אחת) / "secondary"
     (שרשרת-פלחים מתחת למספר-סיכום, על אותה צלע חיצונית) / "internal"
     (מידות פנימיות, לא על ההיקף) / "openings" (רוחבי פתחים לאורך קיר) /
     "unknown".
   - bboxPct/locationLabel/axis/referenceType/confidence - כמו למעלה, אבל
     עבור השרשרת כולה.

5. מידה בודדת שאינה חלק משרשרת (לא ליד מספרים נוספים על אותו קו) - תעד/י
   אותה רק במערך measurements, בלי ליצור לה chain.

6. אם אין בתמונה שום מידה כתובה קריאה בכלל - החזר/י measurements ו-chains
   כמערכים ריקים. זו תשובה כנה ותקינה לגמרי.

7. אל תזהה/י גיאומטריה, קירות כצורה, פתחים כצורה - זה נעשה בשלבים נפרדים.

8. בשדה notes: ציין/י כל דבר שהיה קשה לקרוא, מספרים חופפים/מטושטשים,
   או ספק לגבי סיווג.
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
  // already ran on it — the only precondition this pass has -------------

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
        detail: "stage 0 (scope) must complete for this job before page-dimensions can run",
        jobId,
      },
      400,
    );
  }

  // next version number for this job's page_dimensions stage.
  const { data: existingArtifacts, error: versionCheckError } = await supabase
    .from("analysis_artifacts")
    .select("version")
    .eq("job_id", jobId)
    .eq("stage", "page_dimensions")
    .order("version", { ascending: false })
    .limit(1);

  if (versionCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check page-dimensions version", jobId },
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

  // --- run pass 1 -----------------------------------------------------------

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
      current_stage: "page_dimensions",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const startedAt = Date.now();

  const result = await callOpenAiJsonSchema(
    [
      { role: "system", content: PAGE_DIMENSIONS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "תעד/י עדות גולמית עבור כל מידה כתובה וקריאה בתמונה הזו - " +
              "כל מספר, מכל סוג, בכל מקום בתמונה - לפי הכללים שקיבלת. אל תמיר/י " +
              "יחידות ואל תחשב/י סכומים בעצמך.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "page_dimension_evidence",
    PAGE_DIMENSION_EVIDENCE_JSON_SCHEMA,
  );

  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    await failJob(result.detail);
    return jsonResponse({ error: "internal_error", detail: result.detail, jobId }, 500);
  }

  const evidence = result.parsed as PageDimensionEvidence;

  // --- code-side processing (unit conversion, chain validation, axis
  // resolution) — never the model's own arithmetic --------------------------

  const normalizedMeasurements = normalizeMeasurements(evidence);
  const byId = new Map(normalizedMeasurements.map((m) => [m.id, m]));
  const chainValidations = evidence.chains.map((chain) => validateChain(chain, byId));
  const horizontalExtent = resolveAuthoritativeExtent(evidence, "horizontal");
  const verticalExtent = resolveAuthoritativeExtent(evidence, "vertical");

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "page_dimensions",
      version: attempt,
      payload: {
        measurements: evidence.measurements,
        chains: evidence.chains,
        notes: evidence.notes,
        normalizedMeasurements,
        chainValidations,
        horizontalExtent,
        verticalExtent,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: result.usage,
      },
    })
    .select("id")
    .single();

  if (artifactError || !artifactRow) {
    const detail = artifactError
      ? `failed to persist page-dimensions artifact: ${artifactError.message} (code: ${
        artifactError.code ?? "unknown"
      })`
      : "failed to persist page-dimensions artifact: insert returned no row";
    console.error("[analyze-sketch-v2-page-dimensions] artifact insert failed", {
      jobId,
      artifactError,
    });
    await failJob(detail);
    return jsonResponse({ error: "internal_error", detail, jobId }, 500);
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "stage_complete",
      current_stage: "page_dimensions",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return jsonResponse({
    jobId,
    artifactId: (artifactRow as { id: string }).id,
    measurements: evidence.measurements,
    chains: evidence.chains,
    notes: evidence.notes,
    chainValidations,
    horizontalExtent,
    verticalExtent,
    durationMs,
    attempt,
  });
});

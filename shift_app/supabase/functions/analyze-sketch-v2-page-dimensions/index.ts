// supabase/functions/analyze-sketch-v2-page-dimensions/index.ts
//
// Pass 1 ("page dimensions") of the v2 pipeline — session 23 rewrite, per
// Yaron's explicit instruction (relaying a second ChatGPT architecture
// note) after session 22's real-drawing test: 44 measurements were
// transcribed well, but the model only built 2 chains and neither was
// classified "overall_building" — it is decent at reading/classifying
// individual numbers and unreliable at both grouping them into chains AND
// deciding which chain is the building's overall extent.
//
// What changed vs. the session-22 version (see
// ../_shared/dimension_evidence_schema_v3.ts's header for the full
// before/after):
//   - The model now ONLY returns individual DimensionEvidence records
//     (raw text/number, unit, axis, bbox, and — new — the actual drawn
//     dimension-line endpoints when visible) plus a page-wide
//     DocumentMeasurementConvention it noticed as evidence. No chains. No
//     "this is the overall measurement" classification.
//   - CODE builds chains from measurement geometry
//     (../_shared/dimension_chain_builder_v3.ts) and decides which chain
//     qualifies as an axis's overall/envelope candidate purely by whether
//     its span covers ~the full page (which Stage 0 already cropped down
//     to just the main floor plan) — not by anything the model said.
//   - CODE resolves the authoritative horizontal/vertical extent
//     (../_shared/dimension_chain_resolver_v3.ts) — same never-average
//     rule as before, now applied to geometry-qualified chains.
//
// Explicitly NOT done here (per Yaron's own words: "אל תבנה Rooms ואל
// תשנה את Stage 0/1 מעבר לנדרש"):
//   - No Rooms/Walls/Openings/Stairs reconstruction.
//   - Stage 0 (scope) and Stage 1 (envelope) are untouched by this change.
//   - Pass 0.5 (the old narrow measurements pass) is untouched.
//   - Still NOT wired into Stage 1 — Yaron's own acceptance test (this
//     pipeline resolving 1669->16.69m horizontal, 1099->10.99m vertical,
//     and 274 never being selected, on the real drawing) needs to pass
//     first; wiring + retiring Pass 0.5 is an explicit next step, not
//     taken here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA,
  type PageDimensionEvidenceV3,
} from "../_shared/dimension_evidence_schema_v3.ts";
import { buildDimensionChains } from "../_shared/dimension_chain_builder_v3.ts";
import {
  normalizeMeasurementsV3,
  resolveAuthoritativeExtentV3,
} from "../_shared/dimension_chain_resolver_v3.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const PAGE_DIMENSIONS_SYSTEM_PROMPT = `
את/ה מערכת לתיעוד "עדות גולמית" של מידות כתובות מתוך תמונה של שרטוט קומה
(crop שכבר בוצע מראש לתוכנית עצמה) - את/ה **לא** מערכת לשחזור גיאומטריה,
ולא אדריכל/ית, ו**לא** את/ה זו שמחליט/ה איזו מידה היא "המידה הכוללת של
הבניין". המשימה שלך: לתעד כל מספר כתוב וקריא בתמונה שמייצג מידה כלשהי -
לא רק את ההיקף החיצוני, אלא כל מידה: חדרים, קירות, פתחים, שטחים, מפלסים,
גבהי-תקרה, מדרגות ועוד.

**חשוב מאוד**: את/ה מתעד/ת עדות גולמית בלבד, ברמת המידה הבודדת. אל תקבצ/י
מידות לשרשראות ואל תסווג/י שום מידה כ"מידה כוללת"/"היקף חיצוני" - זו
החלטה גיאומטרית שנעשית בקוד, לא על ידך.

לכל מידה בודדת, תן/י לה מזהה ייחודי (id, למשל "m1", "m2"...), ותעד/י:

1. rawText: הטקסט המדויק כפי שהוא כתוב בתמונה, מילה במילה/ספרה בספרה
   (למשל "1669", "16.69", "274").

2. rawNumeric: המספר הגולמי בדיוק כפי שהוא כתוב, **בלי שום המרת יחידות**
   (אם כתוב "1669" השאר/י 1669 - זה תפקיד הקוד להמיר, לא שלך).

3. unit: מה שכתוב בפועל ליד המספר הזה - "mm"/"cm"/"m", או "unknown" אם
   אין יחידה כתובה במפורש ליד המספר הספציפי הזה (גם אם יש הערה כללית
   בשרטוט על יחידות - זה שייך לשדה convention הנפרד למטה, לא לכאן).

4. axis: horizontal / vertical / diagonal / unknown - לפי הכיוון הנראה
   בתמונה עצמה (לא לפי סיבוב/הטיה של הצילום).

5. bboxPct: תיבה מלבנית מקורבת (אחוזים 0-100 מרוחב/גובה התמונה) שמראה
   איפה **הטקסט/המספר עצמו** נמצא בתמונה.

6. lineStartPct / lineEndPct: נקודות הקצה (אחוזים 0-100) של **קו המידה
   המצויר בפועל** (הקו עם החיצים/הסימונים שהמספר הזה מתאר) - לא של
   הטקסט! זה שונה מ-bboxPct: bboxPct הוא מיקום המספר, lineStartPct/
   lineEndPct הם איפה הקו עצמו מתחיל ומסתיים על הדף. אם הקו לא ברור/לא
   נראה בבירור - החזר/י null לשניהם, אל תנחש/י. זהו השדה הכי חשוב לצורך
   קיבוץ מידות לשרשראות בהמשך (בקוד), אז השקיע/י מאמץ אמיתי לזהות אותו
   כשהוא קיים.

7. referenceTypeHint: סיווג תיאורי בלבד (לא החלטה) - אחד מ:
   building (מידה שמתארת את גוף הבניין/המעטפת - קיר חיצוני, חזית),
   room (מידת חדר), wall (אורך קיר), opening (רוחב/גובה פתח - דלת/חלון),
   elevation (סימון מפלס/גובה, כמו "+304.50" - זו לא אורך!),
   area (שטח, כמו "13.20" מ"ר - זו לא אורך!), unknown.

8. confidence: high/medium/low.

9. אסור להעריך שום אורך לפי פרופורציה חזותית או ניחוש. תעד/י אך ורק
   מספרים שכתובים בפועל וקריאים בתמונה. אם מספר לא קריא/מטושטש - אל
   תכלול/י אותו כלל.

10. לעולם אל תחשב/י סכום של כמה מספרים בעצמך, ואל תקבץ/י מידות לשרשראות
    - זה נעשה בקוד, לא על ידך.

בנוסף לרשימת המידות, החזר/י שדה convention נפרד ברמת כל הדף (לא לכל
מידה בנפרד):
- detectedUnit: אם שמת/שמת לב לקונבנציית יחידות עקבית לכל הדף (למשל הערה
  כתובה "כל המידות בס"מ", או שרוב המספרים החשופים עקביים עם יחידה
  מסוימת) - ציין/י אותה כאן. אם אין בסיס - "unknown". זו עדות, לא החלטה
  סופית - הקוד יחליט איך/מתי להשתמש בה.
- confidence: כמה את/ה בטוח/ה בזיהוי הקונבנציה.
- evidence: רשימת הסברים קצרים בעברית למה חשבת כך (למשל: "הערה כתובה
  'מידות בס״מ' בפינה", או "רוב המספרים החשופים הם דו-שלושה ספרות, עקבי
  עם ס״מ").

אם אין בתמונה שום מידה כתובה קריאה בכלל - החזר/י measurements כמערך ריק
ו-convention עם detectedUnit="unknown".

בשדה notes: ציין/י כל דבר שהיה קשה לקרוא, מספרים חופפים/מטושטשים, או ספק
לגבי סיווג.

אל תזהה/י גיאומטריה, קירות כצורה, פתחים כצורה - זה נעשה בשלבים נפרדים.
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
              "כל מספר, מכל סוג, בכל מקום בתמונה - לפי הכללים שקיבלת. אל תקבצ/י " +
              "לשרשראות ואל תחליט/י מה 'כולל' - רק תעד/י כל מידה בנפרד, כולל " +
              "קצוות קו המידה עצמו כשהם נראים.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "page_dimension_evidence_v3",
    PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA,
  );

  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    await failJob(result.detail);
    return jsonResponse({ error: "internal_error", detail: result.detail, jobId }, 500);
  }

  const evidence = result.parsed as PageDimensionEvidenceV3;

  // --- code-side processing (chain-building, unit conversion, axis
  // resolution) — never the model's own arithmetic or grouping -----------

  const builtChains = buildDimensionChains(evidence.measurements);
  const normalizedMeasurements = normalizeMeasurementsV3(evidence.measurements, evidence.convention);
  const horizontalExtent = resolveAuthoritativeExtentV3(evidence.measurements, evidence.convention, "horizontal");
  const verticalExtent = resolveAuthoritativeExtentV3(evidence.measurements, evidence.convention, "vertical");

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "page_dimensions",
      version: attempt,
      payload: {
        measurements: evidence.measurements,
        convention: evidence.convention,
        notes: evidence.notes,
        builtChains,
        normalizedMeasurements,
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
    convention: evidence.convention,
    notes: evidence.notes,
    builtChains,
    horizontalExtent,
    verticalExtent,
    durationMs,
    attempt,
  });
});

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
//     qualifies as an axis's overall/envelope candidate purely by geometry
//     — not by anything the model said.
//   - CODE resolves the authoritative horizontal/vertical extent
//     (../_shared/dimension_chain_resolver_v3.ts) — same never-average
//     rule as before, now applied to geometry-qualified chains.
//
// SESSION 23 FOLLOW-UP #2 ("dimension strips", Yaron's second real-drawing
// test): the model kept missing a real, explicit vertical overall
// dimension ("1099") even after a prompt tweak asking it to double-check
// all four sides — a single busy full-page image makes a small/cramped
// number near the edge easy to miss. Rather than iterate the prompt
// further, this adds up to four EXTRA, separate OpenAI calls — one each
// for a tightly-zoomed "strip" image cut from just outside the top/bottom/
// left/right edge of the main floor-plan bbox (cropped client-side in
// Flutter from the ORIGINAL, full-resolution photo, not the already-
// downscaled main crop, so the model gets a genuinely higher-resolution,
// uncluttered look at exactly the region where an outer dimension line
// would be). Each strip call uses the EXACT SAME prompt/schema as the main
// crop call — nothing about single-image reading changes. What's new is
// entirely code-side, in ../_shared/dimension_measurement_merge_v3.ts:
// remapping each strip's measurements from its own local percent space
// into the main crop's, then de-duplicating anything that looks like the
// same real dimension line seen in more than one image (so it can never
// silently get double-counted/summed by the resolver). Strips are
// best-effort and additive: if a strip's bbox wasn't provided, its file
// wasn't uploaded, or its OpenAI call fails, Pass 1 still proceeds using
// whatever it has (same graceful-degradation spirit as the rest of this
// pipeline) — never a hard failure just because a strip was unavailable.
//
// SESSION 23 FOLLOW-UP #2 also changed how "overall candidate" is decided
// — see ../_shared/dimension_chain_builder_v3.ts's file header (adaptive
// to the drawing's own combined dimensioned extent, not the literal page
// edges).
//
// SESSION 23 FOLLOW-UP #3 (Yaron's real-drawing test WITH strips live):
// 1669/1099 finally got read correctly (high confidence, via
// bottom_m22/left_m12), but almost every measurement on this drawing has
// unit:"unknown" (no printed mm/cm/m label), and the model's own page-wide
// convention hint came back "unknown" too (an honest "no explicit note
// visible", not something resolveAuthoritativeExtentV3 can convert with).
// Both axes stayed stuck at status:"unresolved" even with the right raw
// numbers in hand. Two fixes, both applied below:
//   A. A NEW deterministic code-side layer,
//      ../_shared/document_unit_convention_resolver.ts, infers the
//      document's unit convention from cross-measurement architectural
//      plausibility (never a single number, never a silent cm default —
//      see that file's header). Its result — `documentUnitConvention` —
//      is what actually feeds normalizeMeasurementsV3/
//      resolveAuthoritativeExtentV3 now, NOT the model's own `convention`
//      hint (still computed/returned as-is, for reference/debug only).
//   B. dimension_chain_builder_v3.ts's coveragePct could exceed 100% for a
//      chain built mostly from strip evidence (strip-remapped coordinates
//      intentionally go outside [0,100] — see that file's own header for
//      the fix: coverage is now the clamped intersection with the
//      canonical [0,100] main-crop space).
//
// SESSION 23 FOLLOW-UPS #4-#7: see ../_shared/dimension_chain_builder_v3.ts,
// ../_shared/dimension_extent_grouping_v3.ts, and
// ../_shared/dimension_chain_resolver_v3.ts's own file headers for the
// missing-line-geometry exclusion, containment/contiguity, extent-
// equivalence corroboration, and completeness-gating fixes respectively.
// None of those changed this file.
//
// SESSION 23 FOLLOW-UP #8 (Yaron's architecture decision, after tracing
// the full data flow with Claude): this pass's resolved
// horizontalExtent/verticalExtent were being computed correctly here the
// whole time, but Stage 1 (envelope) was never actually reading them — it
// was reading a completely separate, older pipeline instead (the
// "measurements" stage from analyze-sketch-v2-measurements, session 21,
// where the model decides chains itself). See
// ../_shared/resolved_page_dimensions_v3.ts's file header for the full
// before/after diagram. The only change in THIS file: the artifact
// payload (and HTTP response) now also includes `resolvedPageDimensions`
// — a pure, thin reshape of horizontalExtent/verticalExtent into the
// canonical contract analyze-sketch-v2-envelope now reads. No new
// computation; toResolvedPageDimensions never re-resolves anything.
//
// Explicitly NOT done here (per Yaron's own words: "אל תבנה Rooms ואל
// תשנה את Stage 0/1 מעבר לנדרש"):
//   - No Rooms/Walls/Openings/Stairs reconstruction.
//   - Stage 0 (scope) itself is untouched by this change (only read from,
//     for its mainFloorPlanBboxPct, to support the strip remap above).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA,
  type BboxPct,
  type DimensionEvidence,
  type DocumentMeasurementConvention,
  type PageDimensionEvidenceV3,
} from "../_shared/dimension_evidence_schema_v3.ts";
import { buildDimensionChains } from "../_shared/dimension_chain_builder_v3.ts";
import {
  normalizeMeasurementsV3,
  resolveAuthoritativeExtentV3,
} from "../_shared/dimension_chain_resolver_v3.ts";
import {
  dedupMeasurementsV3,
  remapStripMeasurements,
  type StripName,
} from "../_shared/dimension_measurement_merge_v3.ts";
import {
  resolveDocumentUnitConvention,
  type DocumentUnitConventionResult,
} from "../_shared/document_unit_convention_resolver.ts";
import { toResolvedPageDimensions } from "../_shared/resolved_page_dimensions_v3.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const STRIP_NAMES: StripName[] = ["top", "bottom", "left", "right"];

const PAGE_DIMENSIONS_SYSTEM_PROMPT = `
את/ה מערכת לתיעוד "עדות גולמית" של מידות כתובות מתוך תמונה של שרטוט קומה
(crop שכבר בוצע מראש לתוכנית עצמה, או קרופ מוגדל/זום-אין של רצועה אחת
לאורך אחת הצלעות שלה) - את/ה **לא** מערכת לשחזור גיאומטריה, ולא אדריכל/ית,
ו**לא** את/ה זו שמחליט/ה איזו מידה היא "המידה הכוללת של הבניין". המשימה
שלך: לתעד כל מספר כתוב וקריא בתמונה שמייצג מידה כלשהי - לא רק את ההיקף
החיצוני, אלא כל מידה: חדרים, קירות, פתחים, שטחים, מפלסים, גבהי-תקרה,
מדרגות ועוד.

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

5. bboxPct: תיבה מלבנית מקורבת (אחוזים 0-100 מרוחב/גובה **התמונה הזו
   בלבד** - אם זו רצועה חתוכה/מוגדלת, האחוזים הם ביחס לרצועה עצמה, לא
   לדף המלא) שמראה איפה **הטקסט/המספר עצמו** נמצא בתמונה.

6. lineStartPct / lineEndPct: נקודות הקצה (אחוזים 0-100, שוב ביחס לתמונה
   הזו בלבד) של **קו המידה המצויר בפועל** (הקו עם החיצים/הסימונים שהמספר
   הזה מתאר) - לא של הטקסט! זה שונה מ-bboxPct: bboxPct הוא מיקום המספר,
   lineStartPct/lineEndPct הם איפה הקו עצמו מתחיל ומסתיים על הדף. אם הקו
   לא ברור/לא נראה בבירור - החזר/י null לשניהם, אל תנחש/י. זהו השדה הכי
   חשוב לצורך קיבוץ מידות לשרשראות בהמשך (בקוד), אז השקיע/י מאמץ אמיתי
   לזהות אותו כשהוא קיים.

7. referenceTypeHint: סיווג תיאורי בלבד (לא החלטה) - אחד מ:
   building (מידה שמתארת את גוף הבניין/המעטפת - קיר חיצוני, חזית),
   room (מידת חדר), wall (אורך קיר), opening (רוחב/גובה פתח - דלת/חלון),
   elevation (סימון מפלס/גובה, כמו "+304.50" - זו לא אורך!),
   area (שטח, כמו "13.20" מ"ר - זו לא אורך!), unknown.

8. confidence: high/medium/low.

9. חשוב מאוד - סריקה שיטתית של כל ארבעת הצדדים: לרוב, בשרטוט אדריכלי
   יש קו-מידה אחד שמודד את כל רוחב הבניין בבת אחת (בדרך כלל למעלה או
   למטה), וקו-מידה מקביל שמודד את כל גובה הבניין בבת אחת (בדרך כלל
   בצד שמאל או ימין) - בדיוק כמו שיש קו כזה לרוחב, לרוב יש קו מקביל
   גם לגובה, גם אם הוא פחות בולט או נמצא קרוב לשוליים של התמונה. אחרי
   שתסיימ/י לתעד את כל שאר המידות, עצר/י ובדוק/י במפורש: "האם תיעדתי
   קו-מידה שמודד את כל הגובה של גוף הבניין בבת אחת? האם תיעדתי קו-מידה
   שמודד את כל הרוחב שלו בבת אחת?" - אם יש קו כזה בתמונה וטרם תיעדת
   אותו, חזר/י ותעד/י אותו כעת, כולל lineStartPct/lineEndPct מדויקים
   ככל האפשר (זה הקו שהכי משנה בהמשך התהליך).

10. אסור להעריך שום אורך לפי פרופורציה חזותית או ניחוש. תעד/י אך ורק
   מספרים שכתובים בפועל וקריאים בתמונה. אם מספר לא קריא/מטושטש - אל
   תכלול/י אותו כלל.

11. לעולם אל תחשב/י סכום של כמה מספרים בעצמך, ואל תקבץ/י מידות לשרשראות
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

async function runPageDimensionsOnImage(
  imageUrl: string,
  extraInstructionHe: string,
): Promise<
  | { ok: true; evidence: PageDimensionEvidenceV3; usage: Record<string, unknown> }
  | { ok: false; detail: string }
> {
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
              "קצוות קו המידה עצמו כשהם נראים. " + extraInstructionHe,
          },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
    "page_dimension_evidence_v3",
    PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA,
  );
  if (!result.ok) return result;
  return { ok: true, evidence: result.parsed as PageDimensionEvidenceV3, usage: result.usage };
}

const STRIP_LABEL_HE: Record<StripName, string> = {
  top: "זוהי רצועה חתוכה/מוגדלת מהצד העליון של התוכנית (לא הדף כולו) - " +
    "מטרתה לתפוס בבירור קו-מידה שמודד את כל רוחב הבניין ליד השוליים " +
    "העליונים, אם קיים כזה.",
  bottom: "זוהי רצועה חתוכה/מוגדלת מהצד התחתון של התוכנית (לא הדף כולו) - " +
    "מטרתה לתפוס בבירור קו-מידה שמודד את כל רוחב הבניין ליד השוליים " +
    "התחתונים, אם קיים כזה.",
  left: "זוהי רצועה חתוכה/מוגדלת מהצד השמאלי של התוכנית (לא הדף כולו) - " +
    "מטרתה לתפוס בבירור קו-מידה שמודד את כל גובה הבניין ליד השוליים " +
    "השמאליים, אם קיים כזה.",
  right: "זוהי רצועה חתוכה/מוגדלת מהצד הימני של התוכנית (לא הדף כולו) - " +
    "מטרתה לתפוס בבירור קו-מידה שמודד את כל גובה הבניין ליד השוליים " +
    "הימניים, אם קיים כזה.",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "unauthorized", detail: "missing bearer token" }, 401);
  }

  let body: { jobId?: string; stripBboxes?: Partial<Record<StripName, BboxPct>> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "invalid JSON body" }, 400);
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") {
    return jsonResponse({ error: "bad_request", detail: "jobId is required" }, 400);
  }
  const stripBboxes = body.stripBboxes ?? {};

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

  // fetch Stage 0's own payload too — needed for mainFloorPlanBboxPct, the
  // reference frame every strip's measurements get remapped into (see
  // ../_shared/dimension_measurement_merge_v3.ts).
  const { data: scopeArtifacts, error: scopeCheckError } = await supabase
    .from("analysis_artifacts")
    .select("payload")
    .eq("job_id", jobId)
    .eq("stage", "scope")
    .order("version", { ascending: false })
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
  const scopePayload = (scopeArtifacts[0] as { payload: Record<string, unknown> }).payload;
  const mainFloorPlanBboxPct = scopePayload?.mainFloorPlanBboxPct as BboxPct | undefined;

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

  // Resolve which strips are actually usable: a bbox must have been sent
  // AND its uploaded file must sign successfully. Best-effort — a missing/
  // unsigned strip is just skipped, never a hard failure (see file header).
  const stripDiagnostics: string[] = [];
  const usableStrips: Array<{ name: StripName; bbox: BboxPct; signedUrl: string }> = [];

  for (const name of STRIP_NAMES) {
    const bbox = stripBboxes[name];
    if (!bbox) {
      stripDiagnostics.push(`${name}: skipped — no bbox provided by the client.`);
      continue;
    }
    const stripPath = `${userId}/analysis/${jobId}/strip_${name}.jpg`;
    const { data: stripSigned, error: stripSignError } = await supabase.storage
      .from("renders")
      .createSignedUrl(stripPath, 600);
    if (stripSignError || !stripSigned?.signedUrl) {
      stripDiagnostics.push(`${name}: skipped — could not sign strip_${name}.jpg (not uploaded?).`);
      continue;
    }
    usableStrips.push({ name, bbox, signedUrl: stripSigned.signedUrl });
  }
  if (usableStrips.length > 0 && !mainFloorPlanBboxPct) {
    stripDiagnostics.push(
      "all strips skipped — mainFloorPlanBboxPct missing from Stage 0's stored payload, cannot remap strip coordinates.",
    );
    usableStrips.length = 0;
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

  const mainCallPromise = runPageDimensionsOnImage(signedUrlData.signedUrl, "");
  const stripCallPromises = usableStrips.map((strip) =>
    runPageDimensionsOnImage(strip.signedUrl, STRIP_LABEL_HE[strip.name]).then((res) => ({ strip, res }))
  );

  const [mainResult, ...stripResults] = await Promise.all([mainCallPromise, ...stripCallPromises]);

  const durationMs = Date.now() - startedAt;

  if (!mainResult.ok) {
    await failJob(mainResult.detail);
    return jsonResponse({ error: "internal_error", detail: mainResult.detail, jobId }, 500);
  }

  const mainEvidence = mainResult.evidence;
  let allMeasurements: DimensionEvidence[] = [...mainEvidence.measurements];
  let convention: DocumentMeasurementConvention = mainEvidence.convention;
  const stripsUsed: string[] = [];
  const notesParts: string[] = [mainEvidence.notes].filter((n) => n.length > 0);

  for (const { strip, res } of stripResults) {
    if (!res.ok) {
      stripDiagnostics.push(`${strip.name}: OpenAI call failed — ${res.detail}`);
      continue;
    }
    const remapped = remapStripMeasurements(
      res.evidence.measurements,
      strip.name,
      strip.bbox,
      mainFloorPlanBboxPct!,
    );
    allMeasurements = allMeasurements.concat(remapped);
    stripsUsed.push(strip.name);
    stripDiagnostics.push(`${strip.name}: used — ${remapped.length} measurement(s) before dedup.`);
    if (res.evidence.notes) notesParts.push(`[${strip.name}] ${res.evidence.notes}`);
    if (convention.detectedUnit === "unknown" && res.evidence.convention.detectedUnit !== "unknown") {
      convention = {
        detectedUnit: res.evidence.convention.detectedUnit,
        confidence: res.evidence.convention.confidence,
        evidence: [...convention.evidence, ...res.evidence.convention.evidence],
      };
    }
  }

  const beforeDedupCount = allMeasurements.length;
  allMeasurements = dedupMeasurementsV3(allMeasurements);
  if (beforeDedupCount !== allMeasurements.length) {
    stripDiagnostics.push(
      `dedup: removed ${beforeDedupCount - allMeasurements.length} measurement(s) that looked like the same dimension line seen in more than one image.`,
    );
  }

  // --- code-side processing (chain-building, unit conversion, axis
  // resolution) — never the model's own arithmetic or grouping -----------

  const builtChains = buildDimensionChains(allMeasurements);

  // SESSION 23 FOLLOW-UP #3, fix A: the document's unit convention is now
  // resolved DETERMINISTICALLY in code from the raw measurement evidence
  // itself (never from a single number, never a silent cm default — see
  // ../_shared/document_unit_convention_resolver.ts's header) and is what
  // actually drives conversion below. The model's own `convention` field
  // (self-reported hint) is kept untouched and still returned/persisted
  // for reference/debug, but is no longer what toMetersV3 consults.
  const documentUnitConvention: DocumentUnitConventionResult = resolveDocumentUnitConvention(allMeasurements);

  const normalizedMeasurements = normalizeMeasurementsV3(allMeasurements, documentUnitConvention);
  const horizontalExtent = resolveAuthoritativeExtentV3(allMeasurements, documentUnitConvention, "horizontal");
  const verticalExtent = resolveAuthoritativeExtentV3(allMeasurements, documentUnitConvention, "vertical");

  // SESSION 23 FOLLOW-UP #8: canonical, thin reshape of the two extents
  // above into the contract analyze-sketch-v2-envelope reads. Pure
  // function, no new resolution happening here — see
  // ../_shared/resolved_page_dimensions_v3.ts's header.
  const resolvedPageDimensions = toResolvedPageDimensions(horizontalExtent, verticalExtent);

  const combinedNotes = [...notesParts, ...(stripDiagnostics.length > 0 ? [`strips: ${stripDiagnostics.join(" ")}`] : [])]
    .join("\n");

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "page_dimensions",
      version: attempt,
      payload: {
        measurements: allMeasurements,
        convention,
        documentUnitConvention,
        notes: combinedNotes,
        builtChains,
        normalizedMeasurements,
        horizontalExtent,
        verticalExtent,
        resolvedPageDimensions,
        stripsUsed,
        stripDiagnostics,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: mainResult.usage,
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
    measurements: allMeasurements,
    convention,
    documentUnitConvention,
    notes: combinedNotes,
    builtChains,
    horizontalExtent,
    verticalExtent,
    resolvedPageDimensions,
    stripsUsed,
    stripDiagnostics,
    durationMs,
    attempt,
  });
});


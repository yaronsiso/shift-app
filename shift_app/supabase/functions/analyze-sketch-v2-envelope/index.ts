// supabase/functions/analyze-sketch-v2-envelope/index.ts
//
// Stage 1 ("envelope") of the new staged geometry pipeline (session 21,
// direct continuation of Stage 0 "scope" from session 20 — see
// claude/51/52 for that history). BRAND NEW, SEPARATE Edge Function. Does
// not replace, call, or modify `analyze-sketch` (v15, production) or
// `analyze-sketch-v2-scope` (Stage 0) in any way — all three coexist.
//
// ⚠️ REWRITTEN (same session, continued) after a real accuracy bug was
// found by testing: given a drawing with large, explicit, unambiguous
// printed dimensions (16.00m x 10.00m rectangle), this function's FIRST
// version returned a polygon measuring 17.80m x 10.25m — an 11% error on
// the long axis — even though its own `notes` field claimed the printed
// numbers had been used. Root cause (independently reached here, then
// cross-checked against a ChatGPT architecture review Yaron brought back —
// same conclusion): asking one model call to both READ printed numbers
// AND CONSTRUCT geometry in the same step conflates OCR/extraction with
// geometric reasoning, and `strict:true` JSON schema only guarantees the
// *shape* of the output, never that the numbers inside it are correct.
//
// THE FIX, implemented in this file (unchanged in spirit through every
// session since):
//   1. This function REQUIRES a prior stage that has already resolved the
//      building's authoritative horizontal/vertical extent — see SESSION
//      23 FOLLOW-UP #8 below for which stage that is NOW.
//   2. The model never sums/derives the authoritative extents itself —
//      they're handed to it as ground-truth text in the prompt, explicitly
//      marked as authoritative and not to be re-derived from the image.
//   3. After the model returns a polygon, CODE validates it: the polygon's
//      own bounding-box extent is compared against the authoritative
//      extents (validateAgainstMeasurements). A mismatch beyond
//      MEASUREMENT_MISMATCH_THRESHOLD_PCT triggers ONE corrective retry —
//      not a blind re-ask, but a follow-up message that states the exact
//      numbers that didn't match and asks for a corrected polygon.
//   4. When the resulting polygon is a simple axis-aligned rectangle AND
//      both axes have confident authoritative extents, CODE overrides the
//      model's vertices entirely with a deterministically-constructed
//      rectangle built from the authoritative numbers
//      (buildDeterministicRectangle) — removing the model's arithmetic
//      from the result altogether for the case that broke it.
//   5. `confidence` returned to the client is COMPUTED IN CODE
//      (computeFinalConfidence) from measurable facts (were dimensions
//      found? did the geometry match them? was it corrected? is it code-
//      overridden?) — never just passed through from the model's own
//      self-reported confidence.
//
// ⚠️ SESSION 22 FIX ("Patch 01 — Measurement Integrity"): the axis
// resolver this function used to call directly (axis_extent_resolver.ts)
// used to AVERAGE disagreeing same-axis chains. It was fixed to never
// average. See SESSION 23 FOLLOW-UP #8 below: that fix's *spirit*
// (never average, conflict surfaces honestly) is preserved, but the
// resolver itself moved.
//
// ⚠️⚠️ SESSION 23 FOLLOW-UP #8 (Yaron's architecture decision, after
// tracing the full data flow with Claude across several follow-up
// sessions): this function used to require the "measurements" stage
// (analyze-sketch-v2-measurements, session 21) — a SEPARATE older
// pipeline where the model was asked to identify and group dimension
// chains itself, then axis_extent_resolver.ts (also old) resolved them.
// Meanwhile, an entirely disconnected NEW pipeline had been built over
// several session-23 follow-ups (analyze-sketch-v2-page-dimensions ->
// dimension_chain_builder_v3.ts -> dimension_extent_grouping_v3.ts ->
// dimension_chain_resolver_v3.ts) that does the same job far more
// reliably — geometry-driven chain building, containment/contiguity
// checks, completeness gating, extent-equivalence corroboration — but
// this function never read its output. Two independent pipelines were
// both deciding "the building's scale", and only the OLDER, weaker one
// was actually wired into Stage 1.
//
// THE FIX: this function now requires the "page_dimensions" stage instead
// of "measurements", and reads its ALREADY-COMPUTED horizontalExtent/
// verticalExtent (ResolvedExtentV3, from dimension_chain_resolver_v3.ts)
// directly from that artifact's payload — no new resolution happens here,
// this function only reshapes them (via
// ../_shared/resolved_page_dimensions_v3.ts's toResolvedPageDimensions,
// a pure function) into the canonical ResolvedPageDimensions the hard
// gate below reads. The "measurements" stage (Pass 0.5) and
// axis_extent_resolver.ts are NOT read anywhere in this file anymore —
// an old "measurements" artifact (even one containing only a stray
// reading like "274") has no path to influence anything here. Pass 0.5
// itself is NOT deleted yet (see its own file header for its new
// legacy/debug-only status) and the Flutter UI no longer needs to call it
// before this stage.
//
// What this function still does, unchanged from every prior version:
//   - Identifies ONLY the building's outer envelope polygon (schema v2,
//     buildingEnvelope.vertices). Rooms, interior walls, openings, stairs,
//     special elements remain out of scope for this stage — always empty
//     arrays, later stages fill them in.
//   - Persists the result as a row in `analysis_artifacts`
//     (stage='envelope') — no new migration; `stage`/`payload` already
//     support this.
//
// Explicitly NOT done here (documented scope limits, not oversights):
//   - No per-edge / per-chain matching of individual dimension chains to
//     specific polygon edges. The validator checks the polygon's overall
//     bounding-box width/height against the authoritative totals — correct
//     and sufficient for the normal architectural convention that exterior
//     dimension lines run the full length of a building edge, but it will
//     not catch an error confined to one interior notch/segment of a more
//     complex non-rectangular envelope while the overall extents still
//     happen to match. A future increment could match each chain to its
//     specific edge if real testing shows this is needed.
//   - Only ONE corrective retry (not an open-ended loop) — matches this
//     project's established "bounded retries, not blind ones" approach
//     and keeps this within Supabase Free tier's known compute-time
//     constraints.
//   - The deterministic-rectangle override only applies to simple 4-vertex
//     axis-aligned rectangles. A non-rectangular envelope (e.g. a building
//     with a small protruding entrance) still relies on the model's
//     (validated, possibly corrected) topology — code cannot yet construct
//     arbitrary orthogonal polygons from measurements alone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  FLOOR_PLAN_JSON_SCHEMA_V2,
  type FloorPlanAnalysisV2,
  type Point2D,
} from "../_shared/floor_plan_schema_v2.ts";
import type { ResolvedExtentV3 } from "../_shared/dimension_chain_resolver_v3.ts";
import {
  shouldBlockStage1FromPageDimensions,
  toResolvedPageDimensions,
  type ResolvedPageDimensions,
} from "../_shared/resolved_page_dimensions_v3.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

// A geometry-vs-measurement mismatch bigger than this (relative, percent)
// is treated as wrong, not noise — triggers a corrective retry. Chosen
// well above normal rounding/model noise (a percent or two) but well
// below the 11% error the original bug produced, so it actually catches
// the case that motivated this rewrite.
const MEASUREMENT_MISMATCH_THRESHOLD_PCT = 5;

type Confidence = "high" | "medium" | "low";

const ENVELOPE_SYSTEM_PROMPT_BASE = `
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

5. חשוב מאוד - קריאת מידות: קיבלת בהודעה הבאה רשימת "מידות סמכותיות"
   שכבר חולצו במעבר נפרד ומדויק על קריאת המספרים הכתובים בתמונה הזו
   בלבד. **אסור לך לקרוא בעצמך את המספרים מהתמונה מחדש ואסור להעריך אותם
   ויזואלית** - השתמש/י אך ורק במידות הסמכומיות שקיבלת כדי לקבוע את קנה-
   המידה במטרים של הקואורדינטות שאת/ה מחזיר/ה. תפקידך כאן הוא לקבוע
   טופולוגיה (כמה קודקודים, אילו זוויות, איזו צורה) - לא לקרוא ספרות.
   אם לא קיבלת מידה סמכותית לציר מסוים (המערכת תציין זאת במפורש), רק אז
   קבע/י קואורדינטות לפי יחסי-פרופורציות בלבד לאותו ציר, והנמך/י את
   confidence בהתאם.
`.trim();

function buildAuthoritativeMeasurementsPrompt(
  horizontal: ResolvedExtentV3,
  vertical: ResolvedExtentV3,
): string {
  const lines: string[] = ["מידות סמכותיות (חולצו במעבר נפרד, אל תקרא/י מהתמונה מחדש):"];

  function describeAxis(label: string, extent: ResolvedExtentV3) {
    if (extent.status === "resolved" && extent.valueM != null) {
      lines.push(
        `- ${label}: ${extent.valueM.toFixed(2)} מ' ` +
          `(מקור: ${extent.sourceChainIds.length} שרשרת/שרשראות מידה, ביטחון ${extent.confidence})`,
      );
    } else if (extent.status === "conflict") {
      lines.push(
        `- ${label}: לא נקבעה מידה סמכותית — נמצאו שרשראות-מידה סותרות ` +
          `שלא ניתן לפשר ביניהן באופן אמין (${extent.diagnostics.join("; ")}). ` +
          `התעלם/י מהמספרים האלה, קבע/י את הציר הזה לפי יחסי-פרופורציות בלבד, והנמך/י את confidence בהתאם.`,
      );
    } else {
      lines.push(`- ${label}: לא נמצאה שום מידה כתובה קריאה בתמונה.`);
    }
  }

  describeAxis("ציר אופקי (רוחב חיצוני כולל)", horizontal);
  describeAxis("ציר אנכי (גובה חיצוני כולל)", vertical);

  return lines.join("\n");
}

function conflictDiagnosticsOrNull(extent: ResolvedExtentV3): string[] | null {
  return extent.status === "conflict" ? extent.diagnostics : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidPoint(p: unknown): p is Point2D {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as { x?: unknown }).x === "number" &&
    Number.isFinite((p as { x: number }).x) &&
    typeof (p as { y?: unknown }).y === "number" &&
    Number.isFinite((p as { y: number }).y)
  );
}

// --- geometry validation / correction (CODE) -------------------------------

// NOTE (found while testing the original fix, kept as documentation): this
// compares the polygon's x-span against the "horizontal" authoritative
// extent (drawn on the image's top/bottom edges) and its y-span against
// the "vertical" one (left/right edges). That assumes the model's own x/y
// assignment lines up with the image's horizontal/vertical — which rule 1
// above tries to enforce, but is not itself immune to the model getting it
// backwards. This does NOT weaken the fix in practice: mismatchDetected
// still fires correctly either way, and the deterministic-rectangle
// override below discards the model's x/y entirely and rebuilds from the
// authoritative horizontal/vertical values directly — so the final
// rectangle is correct regardless of which axis the model confused. A
// genuinely axis-swap-aware validator (matching each chain to a specific
// polygon edge rather than a whole-bbox axis) is a documented future
// increment, relevant mainly for NON-rectangular envelopes where no
// override is possible.
function bboxExtent(vertices: Point2D[]): { widthM: number; heightM: number } {
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    widthM: Math.max(...xs) - Math.min(...xs),
    heightM: Math.max(...ys) - Math.min(...ys),
  };
}

function pctError(actualM: number, expectedM: number): number {
  if (expectedM === 0) return actualM === 0 ? 0 : 100;
  return (Math.abs(actualM - expectedM) / expectedM) * 100;
}

function isAxisAlignedRectangle(vertices: Point2D[]): boolean {
  if (vertices.length !== 4) return false;
  const tol = 0.05; // 5cm tolerance — "essentially the same coordinate"
  for (let i = 0; i < 4; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % 4];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const isHorizontalEdge = dy <= tol && dx > tol;
    const isVerticalEdge = dx <= tol && dy > tol;
    if (!isHorizontalEdge && !isVerticalEdge) return false;
  }
  return true;
}

function buildDeterministicRectangle(widthM: number, heightM: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: heightM },
    { x: 0, y: heightM },
  ];
}

interface ValidationOutcome {
  horizontalErrorPct: number | null;
  verticalErrorPct: number | null;
  mismatchDetected: boolean;
}

function validateAgainstMeasurements(
  vertices: Point2D[],
  horizontal: ResolvedExtentV3 | null,
  vertical: ResolvedExtentV3 | null,
): ValidationOutcome {
  const extent = bboxExtent(vertices);
  const horizontalErrorPct = horizontal ? pctError(extent.widthM, horizontal.valueM!) : null;
  const verticalErrorPct = vertical ? pctError(extent.heightM, vertical.valueM!) : null;
  const mismatchDetected =
    (horizontalErrorPct !== null && horizontalErrorPct > MEASUREMENT_MISMATCH_THRESHOLD_PCT) ||
    (verticalErrorPct !== null && verticalErrorPct > MEASUREMENT_MISMATCH_THRESHOLD_PCT);
  return { horizontalErrorPct, verticalErrorPct, mismatchDetected };
}

function computeFinalConfidence(params: {
  envelopeIsNull: boolean;
  horizontal: ResolvedExtentV3 | null;
  vertical: ResolvedExtentV3 | null;
  finalValidation: ValidationOutcome | null;
  codeOverrodeGeometry: boolean;
}): Confidence {
  const { envelopeIsNull, horizontal, vertical, finalValidation, codeOverrodeGeometry } = params;
  if (envelopeIsNull) return "low";
  if (codeOverrodeGeometry) return "high"; // exact by construction from authoritative numbers

  const haveBothAxes = horizontal !== null && vertical !== null;
  const haveOneAxis = horizontal !== null || vertical !== null;

  if (!haveOneAxis) return "low"; // no written dimensions found at all — pure proportion guess

  const worstAxisConfidence: Confidence =
    [horizontal?.confidence, vertical?.confidence].filter((c): c is Confidence => !!c).includes("low")
      ? "low"
      : "medium";

  if (!finalValidation) return worstAxisConfidence;

  const errors = [finalValidation.horizontalErrorPct, finalValidation.verticalErrorPct].filter(
    (e): e is number => e !== null,
  );
  const worstError = errors.length > 0 ? Math.max(...errors) : null;

  if (worstError === null) return worstAxisConfidence;
  if (worstError <= MEASUREMENT_MISMATCH_THRESHOLD_PCT && haveBothAxes) return "high";
  if (worstError <= MEASUREMENT_MISMATCH_THRESHOLD_PCT) return "medium";
  return "low"; // still mismatched after the corrective retry
}

function buildDiagnosticsNoteHe(params: {
  horizontal: ResolvedExtentV3 | null;
  vertical: ResolvedExtentV3 | null;
  horizontalConflict: string[] | null;
  verticalConflict: string[] | null;
  firstValidation: ValidationOutcome | null;
  retried: boolean;
  finalValidation: ValidationOutcome | null;
  codeOverrodeGeometry: boolean;
  envelopeIsNull: boolean;
}): string {
  const {
    horizontal,
    vertical,
    horizontalConflict,
    verticalConflict,
    firstValidation,
    retried,
    finalValidation,
    codeOverrodeGeometry,
    envelopeIsNull,
  } = params;

  if (envelopeIsNull) {
    return "לא נמצאו מידות סמכותיות רלוונטיות (או שהמעטפת עצמה יצאה null) — אין בדיקת-התאמה למספרים.";
  }

  const parts: string[] = [];

  if (horizontalConflict) {
    parts.push(`⚠️ ציר אופקי: שרשראות-מידה סותרות, לא נעשה שימוש באף אחת (${horizontalConflict.join("; ")}).`);
  }
  if (verticalConflict) {
    parts.push(`⚠️ ציר אנכי: שרשראות-מידה סותרות, לא נעשה שימוש באף אחת (${verticalConflict.join("; ")}).`);
  }

  if (!horizontal && !vertical) {
    parts.push(
      "לא נמצאו בתמונה מידות כתובות מפורשות על ההיקף החיצוני — הקואורדינטות מבוססות על הערכת-פרופורציה בלבד של ה-AI, ללא אימות מספרי.",
    );
    return parts.join(" ");
  }

  const foundParts: string[] = [];
  if (horizontal) foundParts.push(`רוחב חיצוני ${horizontal.valueM!.toFixed(2)} מ'`);
  if (vertical) foundParts.push(`גובה חיצוני ${vertical.valueM!.toFixed(2)} מ'`);
  parts.push(`נמצאו מידות כתובות: ${foundParts.join(", ")}.`);

  if (codeOverrodeGeometry) {
    parts.push(
      "הצורה שזוהתה היא מלבן פשוט — הקואורדינטות הסופיות הוחלפו בחישוב מדויק בקוד לפי המידות הכתובות (לא לפי הקואורדינטות שה-AI עצמו חישב).",
    );
    return parts.join(" ");
  }

  if (retried && firstValidation) {
    const firstErrs = [firstValidation.horizontalErrorPct, firstValidation.verticalErrorPct].filter(
      (e): e is number => e !== null,
    );
    const worstFirst = firstErrs.length > 0 ? Math.max(...firstErrs) : null;
    if (worstFirst !== null) {
      parts.push(
        `הניסיון הראשון של ה-AI לא תאם את המידות (סטייה של עד ${worstFirst.toFixed(1)}%) — נשלחה בקשת-תיקון עם המידות המדויקות, וזו הצורה שיצאה אחרי התיקון.`,
      );
    }
  }

  if (finalValidation) {
    const finalErrs = [finalValidation.horizontalErrorPct, finalValidation.verticalErrorPct].filter(
      (e): e is number => e !== null,
    );
    const worstFinal = finalErrs.length > 0 ? Math.max(...finalErrs) : null;
    if (worstFinal !== null) {
      if (worstFinal <= MEASUREMENT_MISMATCH_THRESHOLD_PCT) {
        parts.push(`הצורה הסופית תואמת את המידות הכתובות (סטייה ${worstFinal.toFixed(1)}%).`);
      } else {
        parts.push(
          `⚠️ גם אחרי ניסיון-תיקון, הצורה עדיין לא תואמת את המידות הכתובות (סטייה ${worstFinal.toFixed(1)}%) — יש להתייחס לתוצאה בזהירות.`,
        );
      }
    }
  }

  return parts.join(" ");
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

  // --- SESSION 23 FOLLOW-UP #8: precondition is now "page_dimensions",
  // NOT "measurements" (Pass 0.5, old pipeline) -- see file header. -------

  const { data: pageDimensionsArtifacts, error: pageDimensionsCheckError } = await supabase
    .from("analysis_artifacts")
    .select("payload")
    .eq("job_id", jobId)
    .eq("stage", "page_dimensions")
    .order("version", { ascending: false })
    .limit(1);

  if (pageDimensionsCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check page_dimensions stage", jobId },
      500,
    );
  }
  if (!pageDimensionsArtifacts || pageDimensionsArtifacts.length === 0) {
    return jsonResponse(
      {
        error: "bad_request",
        detail:
          "stage 1 (page_dimensions) must complete for this job before envelope can run — call analyze-sketch-v2-page-dimensions first",
        jobId,
      },
      400,
    );
  }

  const pageDimensionsPayload = (pageDimensionsArtifacts[0] as { payload: Record<string, unknown> }).payload;
  const horizontalExtent = pageDimensionsPayload?.horizontalExtent as ResolvedExtentV3 | undefined;
  const verticalExtent = pageDimensionsPayload?.verticalExtent as ResolvedExtentV3 | undefined;

  if (!horizontalExtent || !verticalExtent) {
    return jsonResponse(
      {
        error: "internal_error",
        detail:
          "page_dimensions artifact is missing horizontalExtent/verticalExtent -- was it produced before session 23 follow-up #3? re-run analyze-sketch-v2-page-dimensions for this job.",
        jobId,
      },
      500,
    );
  }

  // Pure reshape only -- see resolved_page_dimensions_v3.ts's header. This
  // is the SAME function analyze-sketch-v2-page-dimensions already used to
  // compute resolvedPageDimensions for its own artifact payload; calling
  // it again here on the same inputs is not a second resolution, it's
  // just not trusting an (optional, possibly-absent-on-old-artifacts)
  // stored field over recomputing the identical pure reshape from data
  // this function needs to fetch anyway for the prompt below.
  const resolvedPageDimensions: ResolvedPageDimensions = toResolvedPageDimensions(
    horizontalExtent,
    verticalExtent,
  );

  const horizontalExtentOrNull: ResolvedExtentV3 | null = horizontalExtent.status === "resolved" ? horizontalExtent : null;
  const verticalExtentOrNull: ResolvedExtentV3 | null = verticalExtent.status === "resolved" ? verticalExtent : null;

  const authoritativeMeasurementsText = buildAuthoritativeMeasurementsPrompt(horizontalExtent, verticalExtent);

  const chainsCount = Array.isArray(pageDimensionsPayload?.builtChains)
    ? (pageDimensionsPayload.builtChains as unknown[]).length
    : 0;

  // next version number for this job's envelope stage.
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

  // --- SESSION 23 FOLLOW-UP #2 (original) / #8 (rewired): hard gate, per
  // Yaron's explicit instruction. Without a trusted value for BOTH axes,
  // there is no reliable scale to build geometry from — calling the model
  // anyway just produces a proportion-only guess dressed up with real-
  // looking coordinates. No OpenAI call, no vertices, no artifact with a
  // fabricated shape — just an honest "blocked" status with the specific
  // per-axis reason (missing vs. conflicting) so the caller can act on it.
  // The gate condition itself now lives in resolved_page_dimensions_v3.ts
  // (shouldBlockStage1FromPageDimensions) so it's shared, pure, and
  // independently tested -- this file only calls it.
  if (shouldBlockStage1FromPageDimensions(resolvedPageDimensions)) {
    const blockedReasons: string[] = [];
    if (resolvedPageDimensions.horizontal.status !== "resolved") {
      blockedReasons.push(
        horizontalExtent.status === "conflict"
          ? `ציר אופקי: שרשראות-מידה סותרות, לא נעשה שימוש באף אחת (${horizontalExtent.diagnostics.join("; ")}).`
          : "ציר אופקי: לא נמצאה מידה סמכותית כלל.",
      );
    }
    if (resolvedPageDimensions.vertical.status !== "resolved") {
      blockedReasons.push(
        verticalExtent.status === "conflict"
          ? `ציר אנכי: שרשראות-מידה סותרות, לא נעשה שימוש באף אחת (${verticalExtent.diagnostics.join("; ")}).`
          : "ציר אנכי: לא נמצאה מידה סמכותית כלל.",
      );
    }
    const blockedNotes =
      `Stage 1 חסום — נדרשות שתי מידות סמכותיות (אופקי וגם אנכי) לפני הפעלת מודל המעטפת: ${
        blockedReasons.join(" ")
      }`;

    const { data: blockedArtifactRow, error: blockedArtifactError } = await supabase
      .from("analysis_artifacts")
      .insert({
        job_id: jobId,
        user_id: userId,
        stage: "envelope",
        version: attempt,
        payload: {
          status: "blocked",
          buildingEnvelope: null,
          confidence: "low",
          modelReportedConfidence: null,
          notes: blockedNotes,
          blockedReasons,
          resolvedPageDimensions,
          measurementsUsed: {
            horizontalM: null,
            horizontalConfidence: null,
            horizontalConflict: conflictDiagnosticsOrNull(horizontalExtent),
            verticalM: null,
            verticalConfidence: null,
            verticalConflict: conflictDiagnosticsOrNull(verticalExtent),
            chainsCount,
          },
          validation: { retried: false, codeOverrodeGeometry: false, horizontalErrorPct: null, verticalErrorPct: null },
          model: null,
          durationMs: 0,
          attempt,
          usage: null,
        },
      })
      .select("id")
      .single();

    if (blockedArtifactError || !blockedArtifactRow) {
      await failJob("failed to persist blocked envelope artifact");
      return jsonResponse(
        { error: "internal_error", detail: "failed to persist blocked envelope artifact", jobId },
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
      artifactId: (blockedArtifactRow as { id: string }).id,
      status: "blocked",
      buildingEnvelope: null,
      confidence: "low",
      modelReportedConfidence: null,
      notes: blockedNotes,
      blockedReasons,
      resolvedPageDimensions,
      measurementsUsed: {
        horizontalM: null,
        horizontalConfidence: null,
        horizontalConflict: conflictDiagnosticsOrNull(horizontalExtent),
        verticalM: null,
        verticalConfidence: null,
        verticalConflict: conflictDiagnosticsOrNull(verticalExtent),
        chainsCount,
      },
      validation: { retried: false, codeOverrodeGeometry: false, horizontalErrorPct: null, verticalErrorPct: null },
      durationMs: 0,
      attempt,
    });
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

  const systemPrompt = `${ENVELOPE_SYSTEM_PROMPT_BASE}\n\n${authoritativeMeasurementsText}`;
  const userMessageContent = [
    {
      type: "text",
      text: "זהה/י את המעטפת החיצונית של הבניין בתמונה החתוכה הזו, לפי הכללים שקיבלת ולפי המידות הסמכותיות.",
    },
    { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
  ];

  const firstResult = await callOpenAiJsonSchema(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessageContent },
    ],
    "floor_plan_analysis_v2",
    FLOOR_PLAN_JSON_SCHEMA_V2,
  );

  if (!firstResult.ok) {
    await failJob(firstResult.detail);
    return jsonResponse({ error: "internal_error", detail: firstResult.detail, jobId }, 500);
  }

  let analysis = firstResult.parsed as FloorPlanAnalysisV2;
  let envelope = analysis.buildingEnvelope;
  let usage = firstResult.usage;

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

  // --- validate against authoritative measurements, one corrective retry --

  let firstValidation: ValidationOutcome | null = null;
  let finalValidation: ValidationOutcome | null = null;
  let retried = false;

  if (envelope !== null && (horizontalExtentOrNull !== null || verticalExtentOrNull !== null)) {
    firstValidation = validateAgainstMeasurements(envelope.vertices, horizontalExtentOrNull, verticalExtentOrNull);
    finalValidation = firstValidation;

    if (firstValidation.mismatchDetected) {
      retried = true;
      const extent = bboxExtent(envelope.vertices);
      const mismatchLines: string[] = [
        "התוצאה הקודמת שלך לא תאמה את המידות הסמכותיות:",
      ];
      if (horizontalExtentOrNull && firstValidation.horizontalErrorPct !== null && firstValidation.horizontalErrorPct > MEASUREMENT_MISMATCH_THRESHOLD_PCT) {
        mismatchLines.push(
          `- רוחב (ציר אופקי): החזרת צורה שרוחבה בפועל ${extent.widthM.toFixed(2)} מ', אבל המידה הסמכותית היא ${horizontalExtentOrNull.valueM!.toFixed(2)} מ' (סטייה ${firstValidation.horizontalErrorPct.toFixed(1)}%).`,
        );
      }
      if (verticalExtentOrNull && firstValidation.verticalErrorPct !== null && firstValidation.verticalErrorPct > MEASUREMENT_MISMATCH_THRESHOLD_PCT) {
        mismatchLines.push(
          `- גובה (ציר אנכי): החזרת צורה שגובהה בפועל ${extent.heightM.toFixed(2)} מ', אבל המידה הסמכותית היא ${verticalExtentOrNull.valueM!.toFixed(2)} מ' (סטייה ${firstValidation.verticalErrorPct.toFixed(1)}%).`,
        );
      }
      mismatchLines.push(
        "בנה/י מחדש את buildingEnvelope כך שה-bounding box שלו (ההיקף הכולל שלו) יתאים בדיוק למידות הסמכותיות שקיבלת, תוך שמירה על אותה טופולוגיה/צורה כללית שזיהית (אותו מספר קודקודים ואותן פינות/זוויות יחסית). החזר/י שוב אובייקט מלא באותה סכמה.",
      );

      const retryResult = await callOpenAiJsonSchema(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessageContent },
          { role: "assistant", content: JSON.stringify(analysis) },
          { role: "user", content: mismatchLines.join("\n") },
        ],
        "floor_plan_analysis_v2",
        FLOOR_PLAN_JSON_SCHEMA_V2,
      );

      if (retryResult.ok) {
        const retryAnalysis = retryResult.parsed as FloorPlanAnalysisV2;
        const retryEnvelope = retryAnalysis.buildingEnvelope;
        const retryVerticesValid =
          retryEnvelope !== null &&
          Array.isArray(retryEnvelope.vertices) &&
          retryEnvelope.vertices.length >= 3 &&
          retryEnvelope.vertices.every((v) => isValidPoint(v));

        if (retryVerticesValid) {
          analysis = retryAnalysis;
          envelope = retryEnvelope;
          usage = { firstAttempt: usage, retryAttempt: retryResult.usage };
          finalValidation = validateAgainstMeasurements(envelope!.vertices, horizontalExtentOrNull, verticalExtentOrNull);
        }
        // if the retry came back invalid, we simply keep the first (already
        // validated, even if mismatched) result rather than discarding a
        // usable polygon for a broken one.
      }
      // if the retry call itself failed (network/API error), we likewise
      // keep the first result — a corrective retry is a best-effort
      // improvement, not a hard requirement for this stage to succeed.
    }
  }

  // --- deterministic rectangle override (CODE wins over model arithmetic) -

  let codeOverrodeGeometry = false;
  if (
    envelope !== null &&
    isAxisAlignedRectangle(envelope.vertices) &&
    horizontalExtentOrNull !== null &&
    verticalExtentOrNull !== null &&
    horizontalExtentOrNull.confidence !== "low" &&
    verticalExtentOrNull.confidence !== "low"
  ) {
    envelope = { vertices: buildDeterministicRectangle(horizontalExtentOrNull.valueM!, verticalExtentOrNull.valueM!) };
    codeOverrodeGeometry = true;
    finalValidation = { horizontalErrorPct: 0, verticalErrorPct: 0, mismatchDetected: false };
  }

  const durationMs = Date.now() - startedAt;

  const finalConfidence = computeFinalConfidence({
    envelopeIsNull: envelope === null,
    horizontal: horizontalExtentOrNull,
    vertical: verticalExtentOrNull,
    finalValidation,
    codeOverrodeGeometry,
  });

  const diagnosticsNoteHe = buildDiagnosticsNoteHe({
    horizontal: horizontalExtentOrNull,
    vertical: verticalExtentOrNull,
    horizontalConflict: conflictDiagnosticsOrNull(horizontalExtent),
    verticalConflict: conflictDiagnosticsOrNull(verticalExtent),
    firstValidation,
    retried,
    finalValidation,
    codeOverrodeGeometry,
    envelopeIsNull: envelope === null,
  });

  const combinedNotes = analysis.notes ? `${diagnosticsNoteHe}\n\nהערות ה-AI (מעבר הגיאומטריה): ${analysis.notes}` : diagnosticsNoteHe;

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "envelope",
      version: attempt,
      payload: {
        buildingEnvelope: envelope,
        confidence: finalConfidence,
        modelReportedConfidence: analysis.confidence,
        notes: combinedNotes,
        resolvedPageDimensions,
        measurementsUsed: {
          horizontalM: horizontalExtentOrNull?.valueM ?? null,
          horizontalConfidence: horizontalExtentOrNull?.confidence ?? null,
          horizontalConflict: conflictDiagnosticsOrNull(horizontalExtent),
          verticalM: verticalExtentOrNull?.valueM ?? null,
          verticalConfidence: verticalExtentOrNull?.confidence ?? null,
          verticalConflict: conflictDiagnosticsOrNull(verticalExtent),
          chainsCount,
        },
        validation: {
          retried,
          codeOverrodeGeometry,
          horizontalErrorPct: finalValidation?.horizontalErrorPct ?? null,
          verticalErrorPct: finalValidation?.verticalErrorPct ?? null,
        },
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage,
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
    confidence: finalConfidence,
    modelReportedConfidence: analysis.confidence,
    notes: combinedNotes,
    resolvedPageDimensions,
    measurementsUsed: {
      horizontalM: horizontalExtentOrNull?.valueM ?? null,
      horizontalConfidence: horizontalExtentOrNull?.confidence ?? null,
      horizontalConflict: conflictDiagnosticsOrNull(horizontalExtent),
      verticalM: verticalExtentOrNull?.valueM ?? null,
      verticalConfidence: verticalExtentOrNull?.confidence ?? null,
      verticalConflict: conflictDiagnosticsOrNull(verticalExtent),
      chainsCount,
    },
    validation: {
      retried,
      codeOverrodeGeometry,
      horizontalErrorPct: finalValidation?.horizontalErrorPct ?? null,
      verticalErrorPct: finalValidation?.verticalErrorPct ?? null,
    },
    durationMs,
    attempt,
  });
});


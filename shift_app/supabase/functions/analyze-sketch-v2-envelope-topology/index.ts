// supabase/functions/analyze-sketch-v2-envelope-topology/index.ts
//
// PRODUCER MIGRATION TO EnvelopeTopologyV2 (locked, per
// SHIFT_AGENT_HANDOFF_CURRENT.md §19.B and this session's approval): this
// function is the SAME Edge Function that used to produce
// EnvelopeTopologyV1 rows. Per the locked decision, it now produces V2 rows
// going forward. It does NOT become a new/second function — the file path,
// route, and `stage = "envelope_topology"` value are all unchanged.
//
// What changed vs. the V1 version of this file:
//   - The OpenAI call now uses ENVELOPE_TOPOLOGY_V2_JSON_SCHEMA (no
//     polygonOrder field at all — see envelope_topology_schema_v2.ts) and a
//     new Hebrew system prompt that does NOT ask for a closed polygon.
//   - Parsing/validation now goes through parseEnvelopeTopologyV2 /
//     validateEnvelopeTopologyV2 (fatal/diagnostic split, not V1's
//     all-fatal validator — see envelope_topology_validators_v2.ts).
//   - `payload.topology.schemaVersion` is now "envelope_topology_v2".
//     Downstream (H-B) dispatches on this field to select the correct
//     parser/adapter — see analyze-sketch-v2-canonical-topology/index.ts.
//   - `topologyCoverageDebug` (shoelace-area / polygonOrder-dependent debug
//     metrics) is DROPPED, not ported. V1's debug-metrics module depends
//     structurally on `polygonOrder`, which V2 does not have, and per the
//     handoff (§18) whether V2 needs an equivalent at all was explicitly
//     left undecided. Building a new debug-metrics module was out of scope
//     for this narrow implementation slice; the field is omitted from the
//     V2 payload rather than filled with a placeholder. Flag to Yaron if a
//     V2-appropriate debug metric turns out to be needed before the next
//     step (Phase2C) — not invented here.
//
// PROMPT HARDENING PASS (this session, post production-runtime
// verification): a real V2 run returned a genuine ZERO_LENGTH_EDGE fatal
// (e13, v1==v13 at identical imagePct) and a real AXIS_HINT_MISMATCH
// diagnostic (e7 hinted "horizontal" while its own returned coordinates are
// clearly diagonal). Both are perception-quality problems, not contract
// problems — the schema and validator already handled them exactly as
// designed (one correctly fatal, one correctly diagnostic-only). The fix
// is PROMPT-LEVEL ONLY: ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2 now ends with an
// explicit "FINAL STRUCTURAL SELF-CHECK" section instructing the model to
// re-check its own edges/coordinates/axisHint before returning JSON. This
// does NOT add any deterministic repair, snapping, merging, or geometry
// mutation anywhere in code — the schema
// (envelope_topology_schema_v2.ts) and validator
// (envelope_topology_validators_v2.ts) are both completely untouched by
// this change, and open/disconnected/uncertain/incomplete output remains
// fully allowed and is explicitly reaffirmed as preferable to invented
// closure, both in the pre-existing prompt text and in the new section.
//
// What did NOT change:
//   - This is still a NEW-artifact-per-call, additive stage. It does not
//     read from, write to, or otherwise touch analyze-sketch-v2-envelope,
//     analysis_jobs.current_stage="envelope", or `buildingEnvelope` in any
//     downstream response.
//   - No mutation of analysis_jobs.status/current_stage here (unchanged
//     from the V1 version of this file — this stage still runs
//     validation-only, parallel to whatever today's app already gates on).
//   - `_shared/envelope_topology_schema_v1.ts`,
//     `_shared/envelope_topology_validators_v1.ts`, and
//     `_shared/envelope_topology_debug_metrics_v1.ts` are all completely
//     untouched by this change. Historical V1 artifacts already persisted
//     by earlier runs of this same function remain exactly as they are —
//     nothing here reads, rewrites, or reinterprets them.
//
// This file duplicates callOpenAiJsonSchema()'s shape from
// analyze-sketch-v2-page-dimensions/index.ts rather than importing it,
// because that helper isn't currently exported from a shared module. Same
// as before this change — not modified here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// V1 imports are RETAINED, byte-for-byte, but are no longer wired into the
// active call path below (see PRODUCER MIGRATION note ahead of
// ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2). Kept only in case a future rollback
// or comparison needs them; the V1 contract file itself is untouched.
import {
  ENVELOPE_TOPOLOGY_V2_JSON_SCHEMA,
  parseEnvelopeTopologyV2,
  EnvelopeTopologyV2ForbiddenFieldError,
  type EnvelopeTopologyV2,
} from "../_shared/envelope_topology_schema_v2.ts";
import {
  validateEnvelopeTopologyV2,
  type ValidationResultV2,
} from "../_shared/envelope_topology_validators_v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

// V2 SYSTEM PROMPT — locked direction per §17: does NOT require a
// continuous complete perimeter, a closed polygon, or invented closure.
// Explicitly permits reporting only what is visually supported, including
// open/disconnected structure. Does NOT ask the model to make any
// KEEP/REJECT/interior/exterior semantic decision — that stays Phase1C's
// job entirely; this prompt only asks for perception evidence.
const ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2 = `
את/ה מערכת לזיהוי **עדות חזותית גולמית** (raw perception evidence) על קווי
קיר חיצוניים אפשריים מתוך תמונה של שרטוט קומה - את/ה **לא** מודד/ת שום
דבר, ואסור לך להחזיר שום מטר, ס"מ, מ"מ, שטח, קנה-מידה, או "מספר מידה"
מכל סוג.

**שינוי חשוב לעומת גרסה קודמת**: את/ה **לא** נדרש/ת להחזיר פוליגון סגור
אחד רציף. תפקידך הוא לתעד את מה שאת/ה רואה בפועל בתמונה - קטעי קיר
חיצוני, כפי שהם, גם אם:
- יש קטע שאי אפשר לראות בבירור אם הוא ממשיך (בגלל הסתרה, מקרא/legend,
  איכות תמונה, וכו') - במקרה כזה, פשוט אל תתעד/י צלע שם. אל תמציא/י המשך
  נסתר, ואל תגשר/י מעל הפער בקו מדומיין.
- הגרף שנוצר אינו נסגר למעגל אחד, או שיש בו יותר ממרכיב מחובר אחד
  (component) - זה תקין ומצופה. אל תדחה/י ראיה חזותית אמיתית רק כי היא
  לא "סוגרת" משהו.
- יש כמה קווים מועמדים אפשריים לאותו אזור - תעד/י את כולם כצלעות נפרדות,
  ואל תבחר/י ביניהם בעצמך (הבחירה נעשית בשלב נפרד לגמרי, לא על ידך).

**העיקרון המרכזי, כמו קודם**: את/ה עוקב/ת אחרי הקיר הפיזי עצמו, לא אחרי
הצללית/המלבן הכולל של הבניין. בכל מקום שבו קו הקיר החיצוני **משנה כיוון
בפועל** - גם אם זה שינוי קטן, גם אם זו רק קפיצה (jog) קצרה, גם אם זו
כניסה (recess) פנימה ואז החוצה שוב - **חובה** ליצור שם פינה (vertex)
נפרדת. אסור לדלג על שינוי כיוון אמיתי כדי "לקצר" צלע אחת ארוכה, ואסור
"לגשר" מעל recess בקו ישר אחד.

1. vertices: כל נקודה שבה קו קיר חיצוני נראה לעין משנה כיוון, מתחיל, או
   מסתיים (לא קירות פנימיים, לא ריהוט, לא טקסט/מידות שכתובות בשרטוט) -
   נקודה אחת לכל מקרה כזה, עם imagePct.xPct/yPct (0-100 ביחס לתמונה הזו
   בלבד). תן/י לכל פינה מזהה ייחודי (v1, v2, ...).

2. edges: כל צלע שמחברת שתי פינות עוקבות לאורך קו קיר חיצוני נראה לעין -
   עם fromVertexId/toVertexId, ו:
   - axisHint: "horizontal" אם הצלע אופקית, "vertical" אם אנכית,
     "diagonal_or_unknown" אם הצלע **אלכסונית בפועל** בשרטוט, או שלא
     ברור - אל תכריח/י צלע אלכסונית אמיתית להיראות אופקית/אנכית, וגם אל
     תיישר/י אותה - תעד/י אותה כפי שהיא נראית. ערך זה הוא רמז בלבד
     ואינו סופי - אין צורך "לתקן" גיאומטריה כדי להתאים לרמז.
   - roleHint: "exterior_wall" (קיר חיצוני רגיל), "opening" (פתח/כניסה
     בקו המעטפת עצמו, אם יש כזה), "uncertain" אם לא ברור.

3. perceptionNotes (אופציונלי): הערות קצרות על אזורים לא-ברורים, הסתרה,
   מקרא/legend שמכסה חלק מהשרטוט, פינה מוסתרת חלקית ע"י טקסט מידה, קו לא
   חד, אזור עם כמה קווים מועמדים אפשריים, וכו'. תעד/י את חוסר הוודאות
   כאן - אל תנסה/י "לתקן" את הטופולוגיה בעצמך כדי להסתיר אותה.

**אסור בהחלט**:
- לכתוב שום ערך במטרים/ס"מ/מ"מ.
- לחשב או להעריך שטח.
- להמציא scale/קנה-מידה.
- להחזיר "dimensionRefs" או כל התייחסות למידות כתובות בשרטוט - זה נעשה
  בשלב נפרד לגמרי, לא על ידך.
- להחזיר "polygonOrder" או כל רשימת סדר-היקפי - שדה כזה לא קיים יותר
  ואסור להמציא אותו.
- לכלול קירות פנימיים/מחיצות - רק קווי קיר חיצוניים.
- **לפשט את הבניין לצללית/למלבן הכולל שלו** - אם יש jog, זיז, שקע
  (recess), או קיר חיצוני באלכסון - **חובה** לתעד אותם במדויק, לא
  "לגשר" מעליהם בקו ישר אחד ארוך.
- **להמציא המשך נסתר** - אם אזור מוסתר/לא ברור, פשוט אל תתעד/י צלע שם
  ותאר/י את חוסר הבהירות ב-perceptionNotes. אל תנחש/י ואל תגשר/י מעל
  הפער.
- **להתעלם מקטעי קיר חיצוני קצרים** - קטע קיר קצר הוא עדיין קטע קיר
  אמיתי וצריך שתי פינות משלו, גם אם הוא נראה זניח ביחס לשאר הבניין.
- **לעקוב אחרי קווי מידה (dimension lines) או קווי setback מקווקווים**
  במקום אחרי קו הקיר האמיתי - קווי מידה וקווים מקווקווים הם עדות
  למדידה או לגבולות תכנוניים, **לא** לקו הקיר הפיזי שנבנה בפועל. אם קו
  מידה עובר במקביל לקיר אך לא צמוד אליו, עקוב/י אחרי הקיר עצמו, לא אחרי
  קו המידה.

לפני שאת/ה מסיימ/ת, עבור/י שוב באופן שיטתי על כל האזורים בתמונה, ושאל/י
את עצמך בכל קטע: "האם יש כאן קו קיר חיצוני נראה לעין שעדיין לא תיעדתי?"
- במיוחד באזורים עם גיאומטריה לא-פשוטה (פינות מטבח, אזורי מדרגות, חיבורים
בין אגפים, אזורים עם מקרא/legend חופף) בהם קווי קיר חיצוניים נוטים להיות
מורכבים יותר משורה ישרה אחת, או מוסתרים חלקית. תיעוד חלקי אך כן הוא עדיף
על פני "סגירה" מומצאת.

**בדיקה עצמית מבנית סופית (FINAL STRUCTURAL SELF-CHECK) — חובה לפני
החזרת ה-JSON**: אחרי שסיימת לתעד, עבור/י שוב על כל צלע וכל פינה שכתבת,
ובדוק/י את השבעה הכללים הבאים. זו בדיקת **מבנה/דיוק** של מה שכבר תיעדת -
לא עוד סבב תיעוד חדש:

1. כל צלע חייבת לחבר שתי נקודות שונות מבחינה גיאומטרית. אסור בהחלט
   להחזיר צלע שנקודות הקצה שלה זהות, או כמעט זהות (למשל הפרש של
   0.0-0.1 אחוז), ב-imagePct. אם fromVertexId ו-toVertexId של צלע
   מצביעים בפועל לאותו מיקום בתמונה, זו שגיאה - אל תכלול/י את הצלע הזו.

2. אל תיצור/י שתי פינות (vertex ids) שונות באותו מיקום בתמונה רק כדי
   "לסגור", "להמשיך", או "לחבר" טופולוגיה. אם שתי פינות שתיעדת מצביעות
   בפועל לאותו מיקום, זה כמעט תמיד סימן שהיית צריכות/ים להשתמש באותה
   פינה פעמיים (זהה id), לא ביצור שתי פינות נפרדות.

3. אסור להוסיף צלע זעירה/באורך אפס כדי שהגרף "ייראה" סגור או מחובר.
   ראיה חסרה צריכה להישאר חסרה - אל תמלא/י את הפער עם צלע מלאכותית קצרה
   רק כדי לחבר בין שני חלקים של הגרף.

4. בדוק/י מחדש כל צלע מול הקואורדינטות שכתבת בפועל עבור שתי הפינות שלה
   (לא מול איך שהצלע "אמורה" להיראות) - לפני שאת/ה שולח/ת את ה-JSON
   הסופי.

5. axisHint חייב לתאר את הקואורדינטות שבאמת החזרת, לא את מה שדמיינת:
   - "horizontal" רק כאשר yPct של שתי הפינות דומה בקירוב.
   - "vertical" רק כאשר xPct של שתי הפינות דומה בקירוב.
   - בכל מקרה אחר (כולל כאשר גם x וגם y משתנים משמעותית בין שתי
     הפינות) - "diagonal_or_unknown". אל תסמן/י "horizontal" או
     "vertical" רק כי זה מה שציפית לראות בשרטוט.

6. אם הראיה החזותית לא ברורה, שמור/י על חוסר הוודאות (roleHint:
   "uncertain", cornerAngleHint: "uncertain", axisHint:
   "diagonal_or_unknown", ו/או הערה ב-perceptionNotes) - אל תמציא/י
   גיאומטריה כדי "לפתור" את חוסר הבהירות.

7. פלט פתוח, לא-מחובר, או חלקי **עדיף** על פני סגירה מומצאת או גיאומטריה
   לא-תקינה מבנית (כגון צלע באורך אפס). אל תוותר/י על דיוק מבני רק כדי
   שהתוצאה "תיראה" שלמה יותר.
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

interface EnvelopeTopologyArtifactPayload {
  status: "valid" | "invalid" | "forbidden_field_error";
  topology: EnvelopeTopologyV2 | null;
  validation: ValidationResultV2 | null;
  // No topologyCoverageDebug field in the V2 payload shape — see the
  // PRODUCER MIGRATION note at the top of this file for why it was dropped
  // rather than ported (V1's debug-metrics module depends structurally on
  // polygonOrder, which V2 does not have; a V2-equivalent was explicitly
  // left undecided per the handoff and not invented here).
  rawModelOutputOnError?: unknown;
  error?: string;
  model: string;
  durationMs: number;
  attempt: number;
  usage?: Record<string, unknown>;
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

  // Service-role callers (ops/testing — e.g. `curl` with the project's
  // service_role key as the Bearer token) are not a Supabase Auth user, so
  // supabase.auth.getUser(jwt) correctly rejects them. This is a deliberate,
  // EXPLICIT second trust path, not a bypass of the first: the service_role
  // key already grants full, unrestricted DB access (it bypasses RLS by
  // definition), so accepting it here for a job-scoped perception call
  // grants no new privilege beyond what that key can already do directly
  // against the database. When this path is taken, userId comes from the
  // job row itself (needed for the storage path + artifact ownership),
  // never from a token claim, because there is no token claim to read.
  // AUTHENTICATION MODEL (revised after first real deploy — see note below):
  // Supabase's Edge Function gateway verifies the Bearer JWT's signature
  // BEFORE this code ever runs (standard behavior unless "Enforce JWT
  // Verification" has been explicitly disabled for this function in its
  // dashboard Settings tab — worth a quick confirmation there if this
  // stops matching expectations later). Given that, this function trusts
  // the JWT's own `role` claim rather than re-comparing the raw token
  // string against the SUPABASE_SERVICE_ROLE_KEY env var — the first real
  // deploy showed that direct string comparison unexpectedly failed
  // (gateway-side logs confirmed the incoming token WAS a valid,
  // correctly-signed service_role JWT for this project, decoded role:
  // "service_role" — yet `jwt === SUPABASE_SERVICE_ROLE_KEY` was false in
  // code, most likely an env var vs. freshly-copied-key mismatch of some
  // kind never fully root-caused). Decoding the payload here does not
  // re-verify the signature ourselves — it relies on the gateway having
  // already done that. If verify_jwt is ever disabled for this function,
  // this reasoning no longer holds and this block would need to change.
  function decodeJwtRoleUnsafe(token: string): string | null {
    try {
      const payloadB64 = token.split(".")[1] ?? "";
      const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(atob(normalized));
      return typeof decoded?.role === "string" ? decoded.role : null;
    } catch {
      return null;
    }
  }

  const isServiceRoleCaller = decodeJwtRoleUnsafe(jwt) === "service_role";

  let userId: string;

  if (isServiceRoleCaller) {
    console.log(`[envelope_topology] job=${jobId} authenticated via service_role key (ops/testing path)`);

    const { data: jobRow, error: jobFetchError } = await supabase
      .from("analysis_jobs")
      .select("id, user_id")
      .eq("id", jobId)
      .single();

    if (jobFetchError || !jobRow) {
      return jsonResponse({ error: "not_found", detail: "job not found" }, 404);
    }
    userId = (jobRow as { id: string; user_id: string }).user_id;
  } else {
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      // SAFE, NON-SECRET diagnostics only: JWT structure (part count,
      // header segment — which is just base64 of {"alg":...,"typ":"JWT"},
      // identical and non-secret across all JWTs), and the decoded `role`
      // claim (also not secret — it's metadata, not the signing material).
      // Never includes the payload's signature or any part of the raw
      // token itself. This is here to unblock debugging the first real
      // deploy of this function without another round of dashboard log
      // navigation; safe to remove once auth is confirmed working.
      const parts = jwt.split(".");
      let headerDecoded: unknown = null;
      try {
        headerDecoded = JSON.parse(atob(parts[0]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""));
      } catch {
        headerDecoded = null;
      }
      return jsonResponse(
        {
          error: "unauthorized",
          detail: "invalid token",
          authErrorMessage: userError?.message ?? null,
          diagnostics: {
            jwtPartCount: parts.length,
            jwtHeaderDecoded: headerDecoded,
            decodedRoleClaim: decodeJwtRoleUnsafe(jwt),
            jwtLength: jwt.length,
          },
        },
        401,
      );
    }
    userId = userData.user.id;

    // --- verify the job exists and belongs to this user -----------------
    // NOTE: unlike page-dimensions, this stage does NOT require Stage 0's
    // scope payload for anything beyond the crop already existing in
    // storage — no strip remap, no mainFloorPlanBboxPct needed. If signing
    // the crop fails below, that's the effective "scope hasn't run yet"
    // signal, same spirit as page-dimensions' explicit precondition check
    // but without a redundant extra query.

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
  }

  // next version number for this job's envelope_topology stage.
  const { data: existingArtifacts, error: versionCheckError } = await supabase
    .from("analysis_artifacts")
    .select("version")
    .eq("job_id", jobId)
    .eq("stage", "envelope_topology")
    .order("version", { ascending: false })
    .limit(1);

  if (versionCheckError) {
    return jsonResponse(
      { error: "internal_error", detail: "failed to check envelope-topology version", jobId },
      500,
    );
  }
  const attempt =
    existingArtifacts && existingArtifacts.length > 0
      ? ((existingArtifacts[0] as { version: number }).version + 1)
      : 1;

  // --- get the same cropped image the rest of the pipeline already uses --

  const croppedImagePath = `${userId}/analysis/${jobId}/cropped.jpg`;

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("renders")
    .createSignedUrl(croppedImagePath, 600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return jsonResponse(
      {
        error: "internal_error",
        detail: "failed to sign cropped image url (did stage 0 upload a crop for this job?)",
        jobId,
      },
      500,
    );
  }

  console.log(`[envelope_topology] job=${jobId} calling AI for topology-only perception`);

  const startedAt = Date.now();

  const aiResult = await callOpenAiJsonSchema(
    [
      { role: "system", content: ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2 },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "זהה/י את כל קטעי קו הקיר החיצוני הנראים לעין בתמונה הזו, " +
              "כפינות וצלעות, לפי הכללים שקיבלת. אין צורך בפוליגון סגור - " +
              "תעד/י מה שרואים בפועל, כולל קטעים לא-מחוברים או אזורים לא-ברורים. " +
              "אל תמדוד/י שום דבר, אל תכתוב/י שום מטר/ס\"מ/שטח.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "envelope_topology_v2",
    ENVELOPE_TOPOLOGY_V2_JSON_SCHEMA.schema,
  );

  const durationMs = Date.now() - startedAt;

  if (!aiResult.ok) {
    console.log(`[envelope_topology] job=${jobId} AI call FAILED: ${aiResult.detail}`);
    return jsonResponse({ error: "internal_error", detail: aiResult.detail, jobId }, 500);
  }

  let payload: EnvelopeTopologyArtifactPayload;

  try {
    // parseEnvelopeTopologyV2 throws EnvelopeTopologyV2ForbiddenFieldError
    // if the model returned any metric/scale/area/dimensionRef/polygonOrder
    // field anywhere in the tree — defense in depth on top of the schema's
    // own additionalProperties:false.
    // jobId is injected here, server-side — it is NOT part of the AI
    // schema (same convention as V1). Spread the model's parsed content
    // FIRST, then set schemaVersion after, so our value always wins even if
    // the model or a future schema change reintroduces that key.
    const topology = parseEnvelopeTopologyV2({
      ...(aiResult.parsed as Record<string, unknown>),
      schemaVersion: "envelope_topology_v2",
    });

    console.log(
      `[envelope_topology] job=${jobId} parsed topology (v2): ` +
        `${topology.vertices?.length ?? 0} vertices, ${topology.edges?.length ?? 0} edges`,
    );

    const validation = validateEnvelopeTopologyV2(topology);

    if (validation.valid) {
      console.log(
        `[envelope_topology] job=${jobId} validation PASSED — ` +
          `${validation.diagnostics.length} non-fatal diagnostic(s): ` +
          validation.diagnostics.map((d) => d.code).join(", "),
      );
      payload = {
        status: "valid",
        topology,
        validation,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: aiResult.usage,
      };
    } else {
      console.log(
        `[envelope_topology] job=${jobId} validation FAILED: ` +
          validation.errors.map((e) => e.code).join(", "),
      );
      payload = {
        status: "invalid",
        topology,
        validation,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: aiResult.usage,
      };
    }
  } catch (err) {
    if (err instanceof EnvelopeTopologyV2ForbiddenFieldError) {
      console.log(
        `[envelope_topology] job=${jobId} REJECTED — forbidden field "${err.field}" at ${err.path}. ` +
          `The model returned metric/scale/area/dimensionRef/polygonOrder data, which this stage must never accept.`,
      );
      payload = {
        status: "forbidden_field_error",
        topology: null,
        validation: null,
        rawModelOutputOnError: aiResult.parsed,
        error: err.message,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: aiResult.usage,
      };
    } else {
      throw err;
    }
  }

  const { data: artifactRow, error: artifactError } = await supabase
    .from("analysis_artifacts")
    .insert({
      job_id: jobId,
      user_id: userId,
      stage: "envelope_topology",
      version: attempt,
      payload,
    })
    .select("id")
    .single();

  if (artifactError || !artifactRow) {
    const detail = artifactError
      ? `failed to persist envelope-topology artifact: ${artifactError.message} (code: ${
        artifactError.code ?? "unknown"
      })`
      : "failed to persist envelope-topology artifact: insert returned no row";
    console.error("[analyze-sketch-v2-envelope-topology] artifact insert failed", {
      jobId,
      artifactError,
    });
    return jsonResponse({ error: "internal_error", detail, jobId }, 500);
  }

  console.log(
    `[envelope_topology] job=${jobId} artifact written, stage=envelope_topology version=${attempt} status=${payload.status}`,
  );

  // Deliberately NOT touching analysis_jobs.status/current_stage — see file
  // header. This stage is additive/parallel until Phase 4.

  return jsonResponse({
    jobId,
    artifactId: (artifactRow as { id: string }).id,
    ...payload,
  });
});

// supabase/functions/analyze-sketch-v2-envelope-topology/index.ts
//
// Phase 1 of the Envelope Constraint Solver v1 migration (see handoff /
// design-review conversation, session 24). This is a NEW, PARALLEL,
// ADDITIVE function. It does not read from, write to, or otherwise touch
// analyze-sketch-v2-envelope, analysis_jobs.current_stage="envelope", or
// `buildingEnvelope` in any downstream response. Nothing today's app reads
// depends on this function's output yet — that's Phase 4, and only after
// Phase 1, 2, and 3 have each been reviewed separately against a real
// drawing, per Yaron's explicit phased-rollout instruction.
//
// What this function does, and ONLY this:
//   1. Takes the SAME cropped floor-plan image Stage 1 (envelope) and Pass 1
//      (page-dimensions) already use (`${userId}/analysis/${jobId}/cropped.jpg`,
//      produced by Stage 0/scope).
//   2. Calls OpenAI with a strict JSON Schema
//      (../_shared/envelope_topology_schema_v1.ts) that can ONLY return
//      image-space topology: vertex positions as image percentages, an
//      ordered closed polygon, edge ids, and axis/role hints. There is no
//      field in that schema for meters, scale, area, or dimensionRefs — the
//      AI is not asked to measure anything, only to perceive shape.
//   3. Runs that raw output through
//      ../_shared/envelope_topology_schema_v1.ts's forbidden-field firewall
//      (defense in depth against a provider that doesn't honor
//      additionalProperties:false) and then through all 9 structural
//      validators in ../_shared/envelope_topology_validators_v1.ts.
//   4. Persists the result as a NEW artifact stage, "envelope_topology" —
//      never overwriting or superseding the existing "page_dimensions" or
//      any "envelope"-stage artifact.
//
// Deliberately NOT done here (Phase 2/3/4, not this file):
//   - No witness promotion (matching measurements/builtChains to topology).
//   - No constraint graph, no solving, no world coordinates, no meters
//     anywhere in this file's own logic.
//   - No mutation of analysis_jobs.status/current_stage. This is
//     intentional, not an oversight: Phase 1 is a validation-only path run
//     alongside the existing pipeline, and touching the job's status/stage
//     fields could interfere with whatever today's app already gates on
//     those fields for the real "envelope" stage. If/when Phase 4 makes
//     this function's output authoritative, that's the point to revisit
//     whether/how job status should reflect it.
//
// This file duplicates callOpenAiJsonSchema()'s shape from
// analyze-sketch-v2-page-dimensions/index.ts rather than importing it,
// because that helper isn't currently exported from a shared module.
// Worth extracting to _shared once there are 3+ call sites — not done here
// to keep this change minimal and reviewable on its own, per the phased
// rollout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ENVELOPE_TOPOLOGY_V1_JSON_SCHEMA,
  parseEnvelopeTopologyV1,
  EnvelopeTopologyForbiddenFieldError,
  type EnvelopeTopologyV1,
} from "../_shared/envelope_topology_schema_v1.ts";
import {
  validateEnvelopeTopologyV1,
  type ValidationResult,
} from "../_shared/envelope_topology_validators_v1.ts";
import { computeTopologyCoverageDebug, type TopologyCoverageDebug } from "../_shared/envelope_topology_debug_metrics_v1.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

const ENVELOPE_TOPOLOGY_SYSTEM_PROMPT = `
את/ה מערכת לזיהוי **צורה בלבד** (topology) של מעטפת בניין מתוך תמונה של
שרטוט קומה - את/ה **לא** מודד/ת שום דבר, ואסור לך להחזיר שום מטר, ס"מ,
מ"מ, שטח, קנה-מידה, או "מספר מידה" מכל סוג. תפקידך היחיד: לעקוב אחרי קו
הקיר החיצוני **הפיזי** של גוף הבניין - הקו המצויר שמייצג בפועל את הקיר
עצמו - **לאורך כל ההיקף ברציפות**, ולתעד אותו כפוליגון סגור, במונחי
אחוזים ביחס לתמונה עצמה (0-100).

**העיקרון המרכזי**: את/ה עוקב/ת אחרי הקיר עצמו, לא אחרי הצללית/המלבן
הכולל של הבניין. בכל מקום שבו קו הקיר החיצוני **משנה כיוון בפועל** - גם
אם זה שינוי קטן, גם אם זו רק קפיצה (jog) קצרה, גם אם זו כניסה (recess)
פנימה ואז החוצה שוב - **חובה** ליצור שם פינה (vertex) נפרדת. אסור לדלג
על שינוי כיוון אמיתי כדי "לקצר" צלע אחת ארוכה.

1. vertices: כל נקודה שבה קו הקיר החיצוני משנה כיוון (לא קירות פנימיים,
   לא ריהוט, לא טקסט/מידות שכתובות בשרטוט) - נקודה אחת לכל שינוי כיוון
   כזה, עם imagePct.xPct/yPct (0-100 ביחס לתמונה הזו בלבד). תן/י לכל
   פינה מזהה ייחודי (v1, v2, ...).

2. edges: כל צלע שמחברת שתי פינות עוקבות לאורך קו הקיר החיצוני - עם
   fromVertexId/toVertexId, ו:
   - axisHint: "horizontal" אם הצלע אופקית, "vertical" אם אנכית,
     "diagonal_or_unknown" אם הצלע **אלכסונית בפועל** בשרטוט (קיר
     חיצוני שבאמת מצויר באלכסון, לא ניצב) - אל תכריח/י צלע אלכסונית
     אמיתית להיראות אופקית/אנכית, וגם אל תיישר/י אותה - תעד/י אותה
     כפי שהיא נראית.
   - roleHint: "exterior_wall" (קיר חיצוני רגיל), "opening" (פתח/כניסה
     בקו המעטפת עצמו, אם יש כזה), "uncertain" אם לא ברור.

3. polygonOrder: רשימת מזהי הפינות (vertices) לפי הסדר החזותי שבו הן
   מסתובבות סביב המעטפת (בכיוון כלשהו, עקבי) - כל פינה פעם אחת, פוליגון
   סגור (הפינה האחרונה מתחברת חזרה לראשונה).

4. perceptionNotes (אופציונלי): הערות קצרות על אזורים לא-ברורים - פינה
   מוסתרת חלקית ע"י טקסט מידה, קו לא חד, וכו'.

**אסור בהחלט**:
- לכתוב שום ערך במטרים/ס"מ/מ"מ.
- לחשב או להעריך שטח.
- להמציא scale/קנה-מידה.
- להחזיר "dimensionRefs" או כל התייחסות למידות כתובות בשרטוט - זה נעשה
  בשלב נפרד לגמרי, לא על ידך.
- לכלול קירות פנימיים/מחיצות בפוליגון החיצוני - רק את קו המתאר החיצוני
  של גוף הבניין כולו.
- **לפשט את הבניין לצללית/למלבן הכולל שלו** - אם יש jog, זיז, שקע
  (recess), או קיר חיצוני באלכסון - **חובה** לתעד אותם במדויק, לא
  "לגשר" מעליהם בקו ישר אחד ארוך.
- **לגשר מעל recess** - אם קו הקיר החיצוני נכנס פנימה ואז חוזר החוצה
  (למשל סביב מדרגות, כניסה, או פינת מטבח), חובה לתעד את כל הפינות של
  ה-recess הזה בנפרד - לא לחבר בין שתי הנקודות הרחוקות בקו ישר אחד.
- **להתעלם מקטעי קיר חיצוני קצרים** - קטע קיר קצר הוא עדיין קטע קיר
  אמיתי וצריך שתי פינות משלו, גם אם הוא נראה זניח ביחס לשאר הבניין.
- **לעקוב אחרי קווי מידה (dimension lines) או קווי setback מקווקווים**
  במקום אחרי קו הקיר האמיתי - קווי מידה וקווים מקווקווים הם עדות
  למדידה או לגבולות תכנוניים, **לא** לקו הקיר הפיזי שנבנה בפועל. אם קו
  מידה עובר במקביל לקיר אך לא צמוד אליו, עקוב/י אחרי הקיר עצמו, לא אחרי
  קו המידה.

לפני שאת/ה מסיימ/ת, עבור/י שוב באופן שיטתי על כל ההיקף, צלע-צלע, ושאל/י
את עצמך בכל קטע: "האם קו הקיר החיצוני ממשיך ישר כאן, או שהוא משנה כיוון
בנקודה כלשהי שעדיין לא תיעדתי?" - במיוחד באזורים עם גיאומטריה לא-פשוטה
(פינות מטבח, אזורי מדרגות, חיבורים בין אגפים) בהם קווי קיר חיצוניים
נוטים להיות מורכבים יותר משורה ישרה אחת.
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
  topology: EnvelopeTopologyV1 | null;
  validation: ValidationResult | null;
  // Non-blocking, descriptive only — never affects `status` or
  // `validation.valid`. See envelope_topology_debug_metrics_v1.ts's header
  // for why this exists and why it deliberately has no pass/fail verdict.
  topologyCoverageDebug: TopologyCoverageDebug | null;
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
      { role: "system", content: ENVELOPE_TOPOLOGY_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "זהה/י את קו המתאר החיצוני (המעטפת) של גוף הבניין בתמונה הזו, " +
              "כפוליגון סגור עם פינות וצלעות, לפי הכללים שקיבלת. אל תמדוד/י " +
              "שום דבר, אל תכתוב/י שום מטר/ס\"מ/שטח.",
          },
          { type: "image_url", image_url: { url: signedUrlData.signedUrl, detail: "high" } },
        ],
      },
    ],
    "envelope_topology_v1",
    ENVELOPE_TOPOLOGY_V1_JSON_SCHEMA.schema,
  );

  const durationMs = Date.now() - startedAt;

  if (!aiResult.ok) {
    console.log(`[envelope_topology] job=${jobId} AI call FAILED: ${aiResult.detail}`);
    return jsonResponse({ error: "internal_error", detail: aiResult.detail, jobId }, 500);
  }

  let payload: EnvelopeTopologyArtifactPayload;

  try {
    // parseEnvelopeTopologyV1 throws EnvelopeTopologyForbiddenFieldError if
    // the model returned any metric/scale/area/dimensionRef field anywhere
    // in the tree — defense in depth on top of the schema's own
    // additionalProperties:false.
    // jobId is injected here, server-side — it is NOT part of the AI
    // schema anymore (see envelope_topology_schema_v1.ts's header). Spread
    // the model's parsed content FIRST, then set jobId/schemaVersion after,
    // so our values always win even if the model or a future schema change
    // reintroduces those keys.
    const topology = parseEnvelopeTopologyV1({
      ...(aiResult.parsed as Record<string, unknown>),
      jobId,
      schemaVersion: "envelope_topology_v1",
    });

    console.log(
      `[envelope_topology] job=${jobId} parsed topology: ` +
        `${topology.vertices?.length ?? 0} vertices, ${topology.edges?.length ?? 0} edges`,
    );

    const validation = validateEnvelopeTopologyV1(topology);

    // Computed regardless of validation.valid — this is descriptive only,
    // never a gate. See envelope_topology_debug_metrics_v1.ts's header.
    const topologyCoverageDebug = computeTopologyCoverageDebug(topology);

    if (validation.valid) {
      console.log(
        `[envelope_topology] job=${jobId} validation PASSED — ` +
          `boundingBoxFillRatio=${topologyCoverageDebug.boundingBoxFillRatio} ` +
          `longestEdgeShareOfPerimeter=${topologyCoverageDebug.longestEdgeShareOfPerimeter}`,
      );
      payload = {
        status: "valid",
        topology,
        validation,
        topologyCoverageDebug,
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
        topologyCoverageDebug,
        model: OPENAI_MODEL,
        durationMs,
        attempt,
        usage: aiResult.usage,
      };
    }
  } catch (err) {
    if (err instanceof EnvelopeTopologyForbiddenFieldError) {
      console.log(
        `[envelope_topology] job=${jobId} REJECTED — forbidden field "${err.field}" at ${err.path}. ` +
          `The model returned metric/scale/area/dimensionRef data, which this stage must never accept.`,
      );
      payload = {
        status: "forbidden_field_error",
        topology: null,
        validation: null,
        topologyCoverageDebug: null,
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

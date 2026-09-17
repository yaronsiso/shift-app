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
// PROMPT HARDENING PASS (post production-runtime verification): a real V2
// run returned a genuine ZERO_LENGTH_EDGE fatal (e13, v1==v13 at identical
// imagePct) and a real AXIS_HINT_MISMATCH diagnostic (e7 hinted
// "horizontal" while its own returned coordinates are clearly diagonal).
// Both are perception-quality problems, not contract problems — the schema
// and validator already handled them exactly as designed (one correctly
// fatal, one correctly diagnostic-only). The fix was PROMPT-LEVEL ONLY.
//
// SEGMENTATION-STABILITY PASS (this change): repeated runs on the SAME crop
// produced materially different raw graphs (roughly 14/13, 23/23, 26/25,
// 32/30 vertices/edges). Again PROMPT-LEVEL ONLY, and additionally the
// prompt has now been MOVED OUT of this file into
// ../_shared/envelope_topology_system_prompt_v2.ts so it can be covered by
// regression tests — see that file's header for the exact rules added and
// why. Nothing else in this file changed: the schema
// (envelope_topology_schema_v2.ts) and validator
// (envelope_topology_validators_v2.ts) are untouched, no deterministic
// repair/snapping/merging/geometry mutation exists anywhere in code, and
// open/disconnected/uncertain/incomplete output remains fully allowed and
// explicitly preferable to invented closure.
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
// active call path below. Kept only in case a future rollback or comparison
// needs them; the V1 contract file itself is untouched.
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
// The V2 RAW-perception system prompt lives in its own shared module so it
// can be asserted on by regression tests (same testability precedent as the
// schema/validator files above, which are symlinked into
// claude/phase1c-a/src/). Extraction only — the prompt is the single
// authority for this stage's perception instructions, exactly as it was
// when defined inline here through commit 9d96d99. See that file's header
// for the segmentation-stability rationale behind its current content.
import { ENVELOPE_TOPOLOGY_SYSTEM_PROMPT_V2 } from "../_shared/envelope_topology_system_prompt_v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

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

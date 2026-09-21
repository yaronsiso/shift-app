// supabase/functions/analyze-sketch-vnext-checkpoint1/index.ts
//
// SHIFT VNext — Checkpoint 1 ONLY (per explicit authorization).
//
// Scope, locked: same normalized/cropped plan image -> Luna Geometry
// Observation call + Luna Evidence Observation call, in TRUE PARALLEL ->
// validate both observation schemas -> persist raw observations + timings
// -> STOP. No deterministic resolver, no Phase1C adaptation, no Canonical
// integration, no targeted verification, no 3D integration, and no
// legacy-stage retirement exist in this file. Nothing below reads or
// writes anything Stage1 Envelope, PageDimensions, Measurements,
// EnvelopeTopology V2, Phase1C, CanonicalTopology, or analyze-sketch (v15)
// own — this is a brand new, additive, isolated function and stage.
//
// This function follows EnvelopeTopology V2's precedent (not Stage 1's):
// additive-only, does not touch analysis_jobs.status/current_stage at
// all, and does not hard-gate on any prior v2-pipeline stage beyond
// needing Stage 0's crop to exist (signing the crop failing IS the "scope
// hasn't run yet" signal, same convention analyze-sketch-v2-envelope-
// topology/index.ts already uses).
//
// Persisted as a NEW additive artifact stage ("vnext_checkpoint1") in the
// EXISTING analysis_artifacts table -- analysis_artifacts.stage is a plain
// `text` column with no enum/check constraint (see
// 0007_analysis_jobs_v2.sql). Atomic artifact version allocation is provided
// by 0008_analysis_artifact_atomic_versioning.sql and must be applied before
// deploying this function.
//
// Both OpenAI calls run via vnext_openai_json_schema_client.ts's shared
// helper (see that file's header for why this one is shared rather than
// duplicated) and via vnext_checkpoint1_orchestrator.ts's pure
// runParallelObservations (see that file's header for why the
// parallelism itself lives outside this Deno-specific handler, so it's
// independently testable under Node).
//
// Sampling: no `temperature`, no `seed` anywhere in this file, per the
// explicit "do not assume support" instruction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  GEOMETRY_OBSERVATION_VNEXT_JSON_SCHEMA,
  type GeometryObservationVNext,
} from "../_shared/geometry_observation_schema_vnext.ts";
import { GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT } from "../_shared/geometry_observation_prompt_vnext.ts";
import {
  EVIDENCE_OBSERVATION_VNEXT_JSON_SCHEMA,
  type EvidenceObservationVNext,
} from "../_shared/evidence_observation_schema_vnext.ts";
import { EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT } from "../_shared/evidence_observation_prompt_vnext.ts";
import { callOpenAiJsonSchemaVNext } from "../_shared/vnext_openai_json_schema_client.ts";
import { runParallelObservations, type ObservationCallOutcome } from "../_shared/vnext_checkpoint1_orchestrator.ts";
import {
  buildVnextCheckpoint1PayloadInput,
  buildVnextCheckpoint1Response,
  isCanonicalUuid,
  withVnextCheckpoint1Attempt,
} from "../_shared/vnext_checkpoint1_payload.ts";
import {
  resolveEvidenceOutcome,
  resolveGeometryOutcome,
} from "../_shared/vnext_checkpoint1_outcomes.ts";
import { buildVnextPersistenceFailure } from "../_shared/vnext_persistence_failure.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
// Same env var and default as every other stage in this project — "Luna"
// is gpt-5.6-luna throughout the existing codebase.
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callGeometryVNext(imageUrl: string): Promise<ObservationCallOutcome<GeometryObservationVNext>> {
  const outcome = await callOpenAiJsonSchemaVNext(
    OPENAI_API_KEY,
    OPENAI_MODEL,
    [
      { role: "system", content: GEOMETRY_OBSERVATION_SYSTEM_PROMPT_VNEXT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "זהה/י את כל הגיאומטריה הפיזית הנראית לעין בתמונה הזו - קירות (חיצוניים ופנימיים), " +
              "חדרים, דלתות, חלונות, מדרגות פנים/חוץ, ומרפסות/טרסות/ריצוף חוץ/פרגולות/קירויים - " +
              "לפי הכללים שקיבלת. תעד/י רק גבולות ומקטעים שנראים; אל תחבר/י fragments, אל תשלים/י " +
              "קטע מוסתר ואל תסגור/י גבול ללא ראיה. אל תמדוד/י שום דבר ואל תכתוב/י שום טקסט מידה.",
          },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
    "geometry_observation_vnext_v1",
    GEOMETRY_OBSERVATION_VNEXT_JSON_SCHEMA.schema,
  );
  if (!outcome.ok) return outcome;
  return { ok: true, parsed: outcome.parsed as GeometryObservationVNext, usage: outcome.usage };
}

async function callEvidenceVNext(imageUrl: string): Promise<ObservationCallOutcome<EvidenceObservationVNext>> {
  const outcome = await callOpenAiJsonSchemaVNext(
    OPENAI_API_KEY,
    OPENAI_MODEL,
    [
      { role: "system", content: EVIDENCE_OBSERVATION_SYSTEM_PROMPT_VNEXT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "תעד/י את כל טקסטי המידות, קווי המידה, תוויות החדרים, והערות האדריכליות " +
              "הרלוונטיות לגיאומטריה בתמונה הזו - לפי הכללים שקיבלת. " +
              "אל תמיר/י, אל תחשב/י, ואל תסווג/י שום דבר.",
          },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
    "evidence_observation_vnext_v1",
    EVIDENCE_OBSERVATION_VNEXT_JSON_SCHEMA.schema,
  );
  if (!outcome.ok) return outcome;
  return { ok: true, parsed: outcome.parsed as EvidenceObservationVNext, usage: outcome.usage };
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

  // --- same cropped image the rest of the v2 pipeline already uses -------
  // Same convention as analyze-sketch-v2-envelope-topology/index.ts: no
  // separate `stage="scope"` existence check — a signing failure below IS
  // the "Stage 0 hasn't run for this job yet" signal.

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

  console.log(`[vnext_checkpoint1] job=${jobId} calling Geometry + Evidence in parallel`);

  const { geometry, evidence, geometryDurationMs, evidenceDurationMs, totalWallClockMs } =
    await runParallelObservations(
      signedUrlData.signedUrl,
      callGeometryVNext,
      callEvidenceVNext,
    );

  const { payloadOutcome: geometryOutcome, usage: geometryUsage } = resolveGeometryOutcome(geometry);
  const { payloadOutcome: evidenceOutcome, usage: evidenceUsage } = resolveEvidenceOutcome(evidence);

  console.log(
    `[vnext_checkpoint1] job=${jobId} geometry=${geometryOutcome.status} (${geometryDurationMs}ms) ` +
      `evidence=${evidenceOutcome.status} (${evidenceDurationMs}ms) total=${totalWallClockMs}ms`,
  );

  const payloadInput = buildVnextCheckpoint1PayloadInput({
    model: OPENAI_MODEL,
    geometry: geometryOutcome,
    evidence: evidenceOutcome,
    geometryDurationMs,
    evidenceDurationMs,
    totalWallClockMs,
    geometryUsage,
    evidenceUsage,
  });

  // Version allocation and insertion are one database transaction. The RPC
  // locks the parent job row, enforces Checkpoint 1-only uniqueness for
  // (job_id, stage, version), injects the assigned version into payload.attempt,
  // and returns only the allowlisted id/version pair.
  // There is deliberately no direct-insert
  // fallback: deploying this function requires migration 0008 first.
  const { data: artifactRow, error: artifactError } = await supabase
    .rpc("insert_analysis_artifact_atomic", {
      p_job_id: jobId,
      p_user_id: userId,
      p_stage: "vnext_checkpoint1",
      p_payload: payloadInput,
    })
    .single();

  if (
    artifactError ||
    !artifactRow ||
    !isCanonicalUuid((artifactRow as { artifact_id?: unknown }).artifact_id) ||
    !Number.isInteger((artifactRow as { artifact_version?: unknown }).artifact_version) ||
    ((artifactRow as { artifact_version: number }).artifact_version < 1)
  ) {
    const incidentId = crypto.randomUUID();
    const failure = buildVnextPersistenceFailure(jobId, incidentId);
    // Never pass the database error object (or any of its properties) to
    // the logger. Only fixed, allowlisted fields leave this branch.
    console.error("[analyze-sketch-vnext-checkpoint1] artifact insert failed", failure.logFields);
    return jsonResponse(failure.responseBody, 500);
  }

  const atomicArtifact = artifactRow as { artifact_id: string; artifact_version: number };
  const payload = withVnextCheckpoint1Attempt(payloadInput, atomicArtifact.artifact_version);

  // Deliberately NOT touching analysis_jobs.status/current_stage — same
  // convention as EnvelopeTopology V2. This stage is additive/parallel;
  // nothing in the existing pipeline is gated on it.

  return jsonResponse(
    buildVnextCheckpoint1Response(jobId, atomicArtifact.artifact_id, payload),
  );
});

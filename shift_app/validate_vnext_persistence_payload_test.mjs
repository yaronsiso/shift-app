// validate_vnext_persistence_payload_test.mjs
//
// SHIFT VNext Checkpoint 1 — tests for buildVnextCheckpoint1Payload
// (vnext_checkpoint1_payload.ts): the exact JSON shape persisted to
// analysis_artifacts.payload for stage="vnext_checkpoint1", independent
// of Supabase.

import {
  buildVnextCheckpoint1Payload,
  buildVnextCheckpoint1Response,
} from "./build/vnext_checkpoint1_payload.js";
import { resolveEvidenceOutcome, resolveGeometryOutcome } from "./build/vnext_checkpoint1_outcomes.js";
import { runParallelObservations } from "./build/vnext_checkpoint1_orchestrator.js";
import { sanitizeOpenAiProviderErrorVNext } from "./build/vnext_openai_json_schema_client.js";
import { buildVnextPersistenceFailure } from "./build/vnext_persistence_failure.js";
import { readFileSync } from "node:fs";

const TEST_FILE_ID = "persistence";
let assertionsPassed = 0;
let failures = 0;
const safeError = (code, stage = "geometry") => ({
  category: "provider", code, stage, message: "safe", status: null, requestId: null,
});
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

// ---------------------------------------------------------------------
// Test 1: required top-level keys are all present, and schemaVersions is
// always the two fixed literal strings regardless of input.
// ---------------------------------------------------------------------
{
  const payload = buildVnextCheckpoint1Payload({
    model: "gpt-5.6-luna",
    attempt: 1,
    geometry: { status: "valid", observation: { schemaVersion: "geometry_observation_vnext_v1" }, validation: { valid: true, errors: [], diagnostics: [] } },
    evidence: { status: "valid", observation: { schemaVersion: "evidence_observation_vnext_v1" }, validation: { valid: true, errors: [], diagnostics: [] } },
    geometryDurationMs: 1200,
    evidenceDurationMs: 900,
    totalWallClockMs: 1250,
    geometryUsage: { total_tokens: 500 },
    evidenceUsage: { total_tokens: 300 },
  });

  const requiredKeys = ["schemaVersions", "model", "attempt", "geometry", "evidence", "timings", "usage"];
  check("Test 1: all required top-level keys present", requiredKeys.every((k) => k in payload));
  check("Test 1: schemaVersions.geometry is the fixed literal", payload.schemaVersions.geometry === "geometry_observation_vnext_v1");
  check("Test 1: schemaVersions.evidence is the fixed literal", payload.schemaVersions.evidence === "evidence_observation_vnext_v1");
  check("Test 1: model passed through verbatim", payload.model === "gpt-5.6-luna");
  check("Test 1: attempt passed through verbatim", payload.attempt === 1);
  check("Test 1: timings.geometryDurationMs correct", payload.timings.geometryDurationMs === 1200);
  check("Test 1: timings.evidenceDurationMs correct", payload.timings.evidenceDurationMs === 900);
  check("Test 1: timings.totalWallClockMs correct", payload.timings.totalWallClockMs === 1250);
  check("Test 1: usage.geometry passed through", payload.usage.geometry.total_tokens === 500);
  check("Test 1: usage.evidence passed through", payload.usage.evidence.total_tokens === 300);
}

// ---------------------------------------------------------------------
// Test 2: a call_failed outcome (network/API error, not a validation
// failure) shapes correctly with null observation/validation.
// ---------------------------------------------------------------------
{
  const payload = buildVnextCheckpoint1Payload({
    model: "gpt-5.6-luna",
    attempt: 2,
    geometry: { status: "call_failed", observation: null, validation: null, error: safeError("provider_connection_error") },
    evidence: { status: "valid", observation: {}, validation: { valid: true, errors: [], diagnostics: [] } },
    geometryDurationMs: 30000,
    evidenceDurationMs: 1100,
    totalWallClockMs: 30000,
    geometryUsage: null,
    evidenceUsage: { total_tokens: 200 },
  });

  check("Test 2: call_failed status preserved", payload.geometry.status === "call_failed");
  check("Test 2: call_failed observation is null", payload.geometry.observation === null);
  check("Test 2: safe call_failed code preserved", payload.geometry.error.code === "provider_connection_error");
  check("Test 2: usage.geometry is null when the call failed", payload.usage.geometry === null);
  check("Test 2: the OTHER branch (evidence) is unaffected", payload.evidence.status === "valid");
}

function emptyGeometry() {
  return {
    schemaVersion: "geometry_observation_vnext_v1",
    vertices: [],
    edges: [],
    roomRegions: [],
    openings: [],
    stairs: [],
    exteriorFeatures: [],
    perceptionNotes: null,
  };
}

function failedEvidence() {
  return resolveEvidenceOutcome({
    ok: false,
    detail: safeError("provider_http_error", "evidence"),
  });
}

function payloadFromResolved(geometry, evidence, attempt) {
  return buildVnextCheckpoint1Payload({
    model: "gpt-5.6-luna",
    attempt,
    geometry: geometry.payloadOutcome,
    evidence: evidence.payloadOutcome,
    geometryDurationMs: 1,
    evidenceDurationMs: 1,
    totalWallClockMs: 1,
    geometryUsage: geometry.usage,
    evidenceUsage: evidence.usage,
  });
}

function checkSecretAbsent(label, secret, resolved, payload) {
  const responseSafeResult = buildVnextCheckpoint1Response("safe-job-id", "safe-artifact-id", payload);
  const serializedError = JSON.stringify(resolved.payloadOutcome.error ?? null);
  const message = resolved.payloadOutcome.error?.message ?? "";
  const detail = resolved.payloadOutcome.error?.detail ?? "";
  check(label + ": sentinel absent from artifact payload", !JSON.stringify(payload).includes(secret));
  check(label + ": sentinel absent from response-safe result", !JSON.stringify(responseSafeResult).includes(secret));
  check(label + ": sentinel absent from serialized error", !serializedError.includes(secret));
  check(label + ": sentinel absent from message", !message.includes(secret));
  check(label + ": sentinel absent from detail", !String(detail).includes(secret));
}

// Forbidden raw model output flows through the real resolver and payload builder.
{
  const secret = "FORBIDDEN_SENTINEL_SECRET";
  const raw = { ...emptyGeometry(), scale: secret };
  const resolved = resolveGeometryOutcome({ ok: true, parsed: raw, usage: { total_tokens: 1 } });
  const payload = payloadFromResolved(resolved, failedEvidence(), 3);
  check("Test 4a: forbidden raw output resolves to forbidden_field_error", resolved.payloadOutcome.status === "forbidden_field_error");
  checkSecretAbsent("Test 4a forbidden", secret, resolved, payload);
}

// Structurally invalid raw output may contain allowed rawText, but none of it
// may survive the structural-validation failure.
{
  const secret = "STRUCTURAL_SENTINEL_SECRET";
  const raw = {
    schemaVersion: "evidence_observation_vnext_v1",
    dimensionEvidence: [{
      id: "d1",
      rawText: secret,
      lineStartPct: null,
      lineEndPct: null,
      unitHint: null,
      // confidence intentionally missing
    }],
    textLabels: [],
  };
  const resolved = resolveEvidenceOutcome({ ok: true, parsed: raw, usage: { total_tokens: 2 } });
  const geometry = resolveGeometryOutcome({ ok: true, parsed: emptyGeometry(), usage: {} });
  const payload = payloadFromResolved(geometry, resolved, 4);
  check("Test 4b: malformed raw output resolves to structural_validation_error", resolved.payloadOutcome.status === "structural_validation_error");
  checkSecretAbsent("Test 4b structural", secret, resolved, payload);
}

// Provider error bodies are sanitized before the resolver and payload builder.
{
  const secret = "PROVIDER_SENTINEL_SECRET";
  const detail = sanitizeOpenAiProviderErrorVNext(
    429,
    JSON.stringify({ error: { code: "rate_limit", message: secret }, request_id: "req_safe_429" }),
    null,
  );
  const resolved = resolveGeometryOutcome({ ok: false, detail });
  const payload = payloadFromResolved(resolved, failedEvidence(), 5);
  check("Test 4c: provider failure resolves to call_failed", resolved.payloadOutcome.status === "call_failed");
  checkSecretAbsent("Test 4c provider", secret, resolved, payload);
}

// A thrown branch error is sanitized by orchestration before resolution.
{
  const secret = "ORCHESTRATION_SENTINEL_SECRET";
  const parallel = await runParallelObservations(
    "https://signed.invalid/failure-test",
    async () => { throw new Error(secret); },
    async () => ({ ok: false, detail: safeError("provider_http_error", "evidence") }),
  );
  const resolved = resolveGeometryOutcome(parallel.geometry);
  const evidence = resolveEvidenceOutcome(parallel.evidence);
  const payload = payloadFromResolved(resolved, evidence, 6);
  check("Test 4d: orchestration throw resolves to call_failed", resolved.payloadOutcome.status === "call_failed");
  checkSecretAbsent("Test 4d orchestration", secret, resolved, payload);
}

// Semantic invalidity retains diagnostics but never the raw observation.
{
  const secret = "INVALID_SENTINEL_SECRET";
  const raw = emptyGeometry();
  raw.vertices = [
    { id: "v1", evidenceState: "OBSERVED", imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
    { id: "v1", evidenceState: "UNKNOWN", imagePct: { xPct: 20, yPct: 20 }, cornerAngleHint: null },
  ];
  raw.perceptionNotes = [{ evidenceState: "UNKNOWN", vertexId: null, edgeId: null, regionId: null, note: secret }];
  const resolved = resolveGeometryOutcome({ ok: true, parsed: raw, usage: {} });
  const payload = payloadFromResolved(resolved, failedEvidence(), 7);
  check("Test 4e: semantic invalidity resolves to invalid", resolved.payloadOutcome.status === "invalid");
  check("Test 4e: invalid observation is discarded", resolved.payloadOutcome.observation === null);
  checkSecretAbsent("Test 4e invalid", secret, resolved, payload);
}

// ---------------------------------------------------------------------
// Test 3: the compatibility payload builder accepts an explicit attempt.
// Production persistence uses buildVnextCheckpoint1PayloadInput instead, and
// migration 0008 assigns attempt atomically from the inserted version.
// ---------------------------------------------------------------------
{
  const payload = buildVnextCheckpoint1Payload({
    model: "gpt-5.6-luna",
    attempt: 7,
    geometry: { status: "invalid", observation: null, validation: { valid: false, errors: [{ code: "ZERO_LENGTH_EDGE", message: "x", relatedIds: [] }], diagnostics: [] } },
    evidence: { status: "invalid", observation: null, validation: { valid: false, errors: [], diagnostics: [] } },
    geometryDurationMs: 800,
    evidenceDurationMs: 700,
    totalWallClockMs: 810,
    geometryUsage: {},
    evidenceUsage: {},
  });
  check("Test 3: attempt=7 passed through exactly, not recomputed", payload.attempt === 7);
  check("Test 3: invalid geometry status + its errors both preserved", payload.geometry.status === "invalid" && payload.geometry.validation.errors[0].code === "ZERO_LENGTH_EDGE");
}

// ---------------------------------------------------------------------
// Test 5: persistence failures expose only fixed allowlisted response/log
// fields. The helper intentionally cannot receive a raw database error.
// The handler source lock proves the raw object is not separately passed
// to the logger or response builder around that call site.
// ---------------------------------------------------------------------
{
  const jobId = "safe-job-id";
  const incidentId = "00000000-0000-4000-8000-000000000001";
  const failure = buildVnextPersistenceFailure(jobId, incidentId);
  const responseKeys = Object.keys(failure.responseBody).sort();
  const logKeys = Object.keys(failure.logFields).sort();

  check(
    "Test 5: persistence response has only allowlisted keys",
    JSON.stringify(responseKeys) === JSON.stringify(["detail", "error", "incidentId", "jobId"]),
  );
  check(
    "Test 5: persistence log has only allowlisted keys",
    JSON.stringify(logKeys) === JSON.stringify(["event", "incidentId", "jobId"]),
  );
  check(
    "Test 5: persistence response uses fixed generic values",
    failure.responseBody.error === "internal_error" &&
      failure.responseBody.detail === "failed to persist checkpoint artifact",
  );
  check(
    "Test 5: persistence failure preserves only safe correlation values",
    failure.responseBody.jobId === jobId &&
      failure.responseBody.incidentId === incidentId &&
      failure.logFields.jobId === jobId &&
      failure.logFields.incidentId === incidentId,
  );
  check(
    "Test 5: persistence helper accepts no database error argument",
    buildVnextPersistenceFailure.length === 2,
  );

  const serialized = JSON.stringify(failure);
  for (const forbiddenKey of ["message", "code", "details", "hint"]) {
    check(
      `Test 5: persistence failure contains no DB ${forbiddenKey} field`,
      !Object.prototype.hasOwnProperty.call(failure.responseBody, forbiddenKey) &&
        !Object.prototype.hasOwnProperty.call(failure.logFields, forbiddenKey) &&
        !serialized.includes(`"${forbiddenKey}"`),
    );
  }

  const handlerSource = readFileSync(
    "./supabase/functions/analyze-sketch-vnext-checkpoint1/index.ts",
    "utf8",
  );
  const failureBranch = handlerSource.slice(
    handlerSource.indexOf("if (\n    artifactError ||"),
    handlerSource.indexOf("// Deliberately NOT touching analysis_jobs.status/current_stage"),
  );
  check(
    "Test 5: handler creates incidentId on the server",
    failureBranch.includes("crypto.randomUUID()"),
  );
  check(
    "Test 5: handler does not read raw DB error properties in persistence branch",
    !/artifactError\s*\.(?:message|code|details|hint)/.test(failureBranch),
  );
  check(
    "Test 5: handler does not pass raw DB error object to logger or response",
    !/console\.error\([^;]*artifactError/s.test(failureBranch) &&
      !/jsonResponse\([^;]*artifactError/s.test(failureBranch),
  );
  check(
    "Test 5: handler logs and returns only helper allowlists",
    failureBranch.includes("failure.logFields") &&
      failureBranch.includes("failure.responseBody"),
  );
}


const summary = {
  testFileId: TEST_FILE_ID,
  assertionsPassed,
  assertionsFailed: failures,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify(summary));
process.exit(failures === 0 ? 0 : 1);

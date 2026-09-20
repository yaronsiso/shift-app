// validate_vnext_orchestration_test.mjs
//
// SHIFT VNext Checkpoint 1 — tests for runParallelObservations
// (vnext_checkpoint1_orchestrator.ts). This is the "parallel orchestration
// behavior where testable" category from the spec: proves TRUE
// concurrency (both calls invoked before either resolves) using a shared
// start-order recorder and artificial delays, not just a code read.

import { runParallelObservations } from "./build/vnext_checkpoint1_orchestrator.js";

const TEST_SIGNED_URL = "https://signed.invalid/test-image";

const safeFailure = (code, stage = "provider") => ({
  category: stage === "provider" ? "provider" : "orchestration",
  code,
  stage,
  message: "safe failure",
  status: null,
  requestId: null,
});

const TEST_FILE_ID = "orchestration";
let assertionsPassed = 0;
let failures = 0;
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ---------------------------------------------------------------------
// Test 1: both callables are INVOKED before either resolves — proven by
// a shared event log recording "start" the instant each function body
// begins running, before any await inside it completes.
// ---------------------------------------------------------------------
{
  const events = [];
  const callGeometry = async () => {
    events.push("geometry:start");
    await sleep(30);
    events.push("geometry:end");
    return { ok: true, parsed: { kind: "geometry" }, usage: {} };
  };
  const callEvidence = async () => {
    events.push("evidence:start");
    await sleep(30);
    events.push("evidence:end");
    return { ok: true, parsed: { kind: "evidence" }, usage: {} };
  };

  await runParallelObservations(TEST_SIGNED_URL, callGeometry, callEvidence);

  check(
    `Test 1: both calls start before either ends (events=${JSON.stringify(events)})`,
    events[0].endsWith(":start") && events[1].endsWith(":start"),
  );
}

// ---------------------------------------------------------------------
// Test 2: total wall-clock time for two ~50ms calls run in true parallel
// must be close to 50ms, NOT close to 100ms (which would indicate
// accidental sequential execution). Generous upper bound to avoid CI
// flakiness while still clearly distinguishing parallel from sequential.
// ---------------------------------------------------------------------
{
  const callGeometry = async () => { await sleep(50); return { ok: true, parsed: {}, usage: {} }; };
  const callEvidence = async () => { await sleep(50); return { ok: true, parsed: {}, usage: {} }; };

  const result = await runParallelObservations(TEST_SIGNED_URL, callGeometry, callEvidence);

  check(
    `Test 2: totalWallClockMs (${result.totalWallClockMs}ms) is well under 2x a single call's duration (not sequential)`,
    result.totalWallClockMs < 90,
  );
  check(`Test 2: geometryDurationMs recorded (~50ms, got ${result.geometryDurationMs}ms)`, result.geometryDurationMs >= 45);
  check(`Test 2: evidenceDurationMs recorded (~50ms, got ${result.evidenceDurationMs}ms)`, result.evidenceDurationMs >= 45);
}

// ---------------------------------------------------------------------
// Test 3: a failure in one call must not lose the other call's result or
// its timing — each branch's outcome is independent.
// ---------------------------------------------------------------------
{
  const callGeometry = async () => { await sleep(10); throw new Error("boom"); };
  const callEvidence = async () => { await sleep(10); return { ok: true, parsed: { kind: "evidence" }, usage: { tokens: 5 } }; };

  const result = await runParallelObservations(TEST_SIGNED_URL, callGeometry, callEvidence);

  check("Test 3: geometry failure is captured as ok:false, not thrown", result.geometry.ok === false);
  check("Test 3: geometry failure is sanitized", result.geometry.detail.code === "geometry_call_threw" && !JSON.stringify(result.geometry).includes("boom"));
  check("Test 3: evidence result is unaffected by geometry's failure", result.evidence.ok === true && result.evidence.parsed.kind === "evidence");
  check(`Test 3: evidenceDurationMs still recorded (got ${result.evidenceDurationMs}ms)`, result.evidenceDurationMs >= 8);
}

// ---------------------------------------------------------------------
// Test 4: an explicit ok:false outcome (not a thrown error) from either
// callable passes through unchanged.
// ---------------------------------------------------------------------
{
  const callGeometry = async () => ({ ok: false, detail: safeFailure("provider_http_error") });
  const callEvidence = async () => ({ ok: true, parsed: {}, usage: {} });

  const result = await runParallelObservations(TEST_SIGNED_URL, callGeometry, callEvidence);

  check("Test 4: explicit ok:false outcome passes through unchanged", result.geometry.ok === false && result.geometry.detail.code === "provider_http_error");
}

{
  const signedUrl = "https://signed.invalid/same-image";
  const received = { geometry: null, evidence: null };
  const callGeometry = async (url) => {
    received.geometry = url;
    return { ok: true, parsed: {}, usage: {} };
  };
  const callEvidence = async (url) => {
    received.evidence = url;
    return { ok: true, parsed: {}, usage: {} };
  };
  const sameUrlWasForwarded = (values, expected) =>
    values.geometry === expected && values.evidence === expected;

  await runParallelObservations(signedUrl, callGeometry, callEvidence);
  check("Test 5: Geometry receives the exact signed URL argument", received.geometry === signedUrl);
  check("Test 5: Evidence receives the exact signed URL argument", received.evidence === signedUrl);
  check("Test 5: both spies prove the same URL was forwarded", sameUrlWasForwarded(received, signedUrl));
  check(
    "Test 5: URL assertion rejects a mismatched branch value",
    !sameUrlWasForwarded({ geometry: signedUrl, evidence: signedUrl + "-wrong" }, signedUrl),
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

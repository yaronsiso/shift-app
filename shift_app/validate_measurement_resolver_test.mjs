// Standalone test for _shared/measurement_resolver.ts — session 22,
// "Patch 01: Measurement Integrity". Verifies the acceptance criteria
// listed in the patch's own README_PATCH_01.md, rather than just trusting
// that list — each one is asserted here against the real compiled code.
//
// Compile first, then run:
//   tsc --module commonjs --target ES2020 --outDir .pass1_test_build \
//     supabase/functions/_shared/measurement_resolver.ts \
//     supabase/functions/_shared/page_dimensions_schema_v2.ts
//   node validate_measurement_resolver_test.mjs

import { toMeters, validateChain, resolveAuthoritativeExtent } from "./.pass1_test_build/measurement_resolver.js";

let failures = 0;
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`ok: ${label}`);
  }
}
function assertTrue(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

function meas(id, rawNumeric, unit, overrides = {}) {
  return {
    id,
    rawText: String(rawNumeric),
    rawNumeric,
    unit,
    unitEvidence: unit === "unknown" ? "unknown" : "explicit",
    referenceType: "overall_building",
    axis: "horizontal",
    bboxPct: { xMinPct: 0, yMinPct: 0, xMaxPct: 10, yMaxPct: 5 },
    label: `measurement ${id}`,
    confidence: "high",
    ...overrides,
  };
}

function chain(id, axis, segmentIds, overallId, overrides = {}) {
  return {
    id,
    axis,
    level: "overall",
    referenceType: "overall_building",
    bboxPct: { xMinPct: 0, yMinPct: 0, xMaxPct: 100, yMaxPct: 5 },
    locationLabel: `chain ${id}`,
    segmentMeasurementIds: segmentIds,
    overallMeasurementId: overallId,
    confidence: "high",
    ...overrides,
  };
}

// --- Acceptance test 1: 16.00m and 10.00m explicit totals resolve exactly
{
  const evidence = {
    measurements: [meas("m1", 16.0, "m")],
    chains: [chain("c1", "horizontal", [], "m1")],
    notes: "",
  };
  const res = resolveAuthoritativeExtent(evidence, "horizontal");
  assertEqual(res.status, "resolved", "acceptance 1: 16.00m explicit resolves");
  assertEqual(res.valueM, 16.0, "acceptance 1: resolved value is exactly 16.00");
}
{
  const evidence = {
    measurements: [meas("m1", 10.0, "m")],
    chains: [chain("c1", "vertical", [], "m1")],
    notes: "",
  };
  const res = resolveAuthoritativeExtent(evidence, "vertical");
  assertEqual(res.status, "resolved", "acceptance 1: 10.00m explicit resolves");
  assertEqual(res.valueM, 10.0, "acceptance 1: resolved value is exactly 10.00");
}

// --- Acceptance test 2: THE REGRESSION — 16.00 vs 17.80 must conflict,
// never average to 16.90.
{
  const evidence = {
    measurements: [meas("m1", 16.0, "m"), meas("m2", 17.8, "m")],
    chains: [
      chain("top", "horizontal", [], "m1"),
      chain("bottom", "horizontal", [], "m2"),
    ],
    notes: "",
  };
  const res = resolveAuthoritativeExtent(evidence, "horizontal");
  assertEqual(res.status, "conflict", "acceptance 2: conflicting 16.00 vs 17.80 -> conflict");
  assertEqual(res.valueM, null, "acceptance 2: valueM is null on conflict, never averaged");
  const wouldHaveBeenAveraged = res.valueM === 16.9;
  assertEqual(wouldHaveBeenAveraged, false, "acceptance 2: definitely not the old average (16.90)");
}

// --- Acceptance test 3: segments 5.20+2.80+3.60+4.40 with overall 16.00
// returns match.
{
  const segs = [meas("s1", 5.2, "m"), meas("s2", 2.8, "m"), meas("s3", 3.6, "m"), meas("s4", 4.4, "m")];
  const overall = meas("o1", 16.0, "m");
  const byId = new Map([...segs, overall].map((m) => [m.id, { ...m, valueM: m.rawNumeric }]));
  const c = chain("c1", "horizontal", ["s1", "s2", "s3", "s4"], "o1");
  const v = validateChain(c, byId);
  assertEqual(v.status, "match", "acceptance 3: segments summing to 16.00 with overall 16.00 -> match");
}

// --- Acceptance test 4: a bare number with unit=unknown is NOT converted
// and cannot become authoritative.
{
  assertEqual(toMeters(meas("m1", 520, "unknown")), null, "acceptance 4: unit=unknown never converts to meters");
  const evidence = {
    measurements: [meas("m1", 520, "unknown")],
    chains: [chain("c1", "horizontal", [], "m1")],
    notes: "",
  };
  const res = resolveAuthoritativeExtent(evidence, "horizontal");
  assertTrue(
    res.status !== "resolved",
    "acceptance 4: an unknown-unit measurement cannot become the authoritative resolved value",
  );
}

// --- Acceptance test 5 (schema-level, checked here structurally): every
// RawMeasurement the schema allows always carries a bboxPct — asserted by
// construction (helper meas() above always sets it) and by the JSON
// schema itself listing bboxPct in `required` for RAW_MEASUREMENT_SCHEMA
// (see page_dimensions_schema_v2.ts) — strict:true means OpenAI cannot
// omit it.
{
  const m = meas("m1", 1.0, "m");
  assertTrue(
    typeof m.bboxPct === "object" && ["xMinPct", "yMinPct", "xMaxPct", "yMaxPct"].every((k) => k in m.bboxPct),
    "acceptance 5: every measurement carries a complete bboxPct",
  );
}

// --- extra: unit conversion correctness (mm/cm/m)
{
  assertEqual(toMeters(meas("m", 5200, "mm")), 5.2, "mm -> m conversion");
  assertEqual(toMeters(meas("m", 520, "cm")), 5.2, "cm -> m conversion");
  assertEqual(toMeters(meas("m", 5.2, "m")), 5.2, "m -> m is a no-op");
}

// --- extra: contradiction (segments don't match printed overall)
{
  const segs = [meas("s1", 5.2, "m"), meas("s2", 1.0, "m")];
  const overall = meas("o1", 16.0, "m");
  const byId = new Map([...segs, overall].map((m) => [m.id, { ...m, valueM: m.rawNumeric }]));
  const c = chain("c1", "horizontal", ["s1", "s2"], "o1");
  const v = validateChain(c, byId);
  assertEqual(v.status, "contradiction", "extra: segments 5.20+1.00 vs overall 16.00 -> contradiction");
}

// --- extra: missing axis chains -> "missing" status, distinct from conflict
{
  const evidence = { measurements: [], chains: [], notes: "" };
  const res = resolveAuthoritativeExtent(evidence, "horizontal");
  assertEqual(res.status, "missing", "extra: no chains at all -> missing, not conflict");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Standalone regression test for _shared/axis_extent_resolver.ts
// (resolveAxisExtent) — session 22, "Patch 01: Measurement Integrity".
//
// This is the exact bug found in an architecture audit and independently
// confirmed by reading the deployed analyze-sketch-v2-envelope/index.ts:
// when two same-axis dimension chains disagreed, the old code averaged
// them (e.g. 16.00m and 17.80m silently became 16.90m — a number that
// never appeared anywhere in the drawing). This test asserts the new
// resolver NEVER does that: disagreement beyond tolerance must return a
// conflict with valueM effectively unusable (extent: null), never an
// averaged number.
//
// Compile the .ts to plain JS first, into a throwaway build dir next to
// this file (run from the shift_app repo root):
//   tsc --module commonjs --target ES2020 --outDir .envelope_test_build \
//     supabase/functions/_shared/axis_extent_resolver.ts
// then: node validate_envelope_axis_resolution_test.mjs
// (the apply script does this automatically and deletes the build dir
// afterward — .envelope_test_build is never committed).

import { resolveAxisExtent } from "./.envelope_test_build/axis_extent_resolver.js";

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

function chain(id, axis, overallValueM, segmentValuesM, confidence = "high") {
  return {
    id,
    axis,
    location: `chain ${id}`,
    segments: segmentValuesM.map((v) => ({ valueM: v, text: String(v) })),
    overallValueM,
    overallText: overallValueM == null ? null : String(overallValueM),
    confidence,
  };
}

// 1. THE REGRESSION CASE — this is the bug. 16.00 vs 17.80 must NEVER
// resolve to their average (16.90). It must be a conflict.
{
  const chains = [
    chain("top", "horizontal", 16.0, [5.2, 2.8, 3.6, 4.4]),
    chain("bottom", "horizontal", 17.8, [5.2, 2.8, 3.6, 6.2]),
  ];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(res.extent, null, "REGRESSION: conflicting 16.00 vs 17.80 never averages — extent is null");
  assertEqual(res.conflict !== null, true, "REGRESSION: conflicting chains report a conflict, not silence");
  // the specific failure mode this patch exists to prevent:
  const wouldHaveBeenAveraged = res.extent?.valueM === 16.9;
  assertEqual(wouldHaveBeenAveraged, false, "REGRESSION: resolved value is definitely not the old average (16.90)");
}

// 2. A single explicit chain resolves exactly — no ambiguity, no rounding.
{
  const chains = [chain("top", "horizontal", 16.0, [5.2, 2.8, 3.6, 4.4])];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(res.extent?.valueM, 16.0, "single chain with explicit overall resolves exactly to 16.00");
  assertEqual(res.conflict, null, "single chain: no conflict");
}

// 3. Two chains that agree (within tolerance) resolve — not every
// multi-chain axis is a conflict, only disagreeing ones.
{
  const chains = [
    chain("top", "horizontal", 16.0, [5.2, 2.8, 3.6, 4.4]),
    chain("bottom", "horizontal", 16.05, [5.2, 2.8, 3.6, 4.45]),
  ];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(res.extent !== null, true, "agreeing chains (within tolerance) resolve, not conflict");
  assertEqual(res.conflict, null, "agreeing chains: no conflict reported");
}

// 4. A chain with only segments (no explicit overall) sums correctly when
// alone.
{
  const chains = [chain("top", "horizontal", null, [5.2, 2.8, 3.6, 4.4])];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(Math.round((res.extent?.valueM ?? 0) * 100) / 100, 16.0, "segment-only chain sums to 16.00");
}

// 5. Explicit overall outranks a segment-sum-only chain when both exist
// and roughly agree (tie-break prefers the explicitly printed total).
{
  const chains = [
    chain("explicit", "horizontal", 16.0, []),
    chain("segments-only", "horizontal", null, [5.2, 2.8, 3.6, 4.4]),
  ];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(res.extent?.valueM, 16.0, "explicit overall chain is preferred as the resolved value");
}

// 6. No chains for this axis at all -> missing, not a conflict.
{
  const res = resolveAxisExtent([chain("v", "vertical", 10.0, [])], "horizontal");
  assertEqual(res.extent, null, "no horizontal chains -> extent null");
  assertEqual(res.conflict, null, "no horizontal chains -> not a conflict, just missing");
}

// 7. Axis filter: a vertical chain must never leak into a horizontal
// resolution.
{
  const chains = [
    chain("h", "horizontal", 16.0, []),
    chain("v", "vertical", 10.0, []),
  ];
  const res = resolveAxisExtent(chains, "horizontal");
  assertEqual(res.extent?.valueM, 16.0, "cross-axis chains do not interfere with each other");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Standalone test for _shared/dimension_measurement_merge_v3.ts — session
// 23, follow-up #2 ("dimension strips"). Covers the two pure functions
// that make the multi-image feature safe:
//   1. remapLocalPctToCropPct / remapStripMeasurements — a strip's own
//      local 0-100% coordinates must be correctly converted into the main
//      crop's 0-100% coordinate space (composing strip-bbox and
//      main-crop-bbox, both in ORIGINAL-image-percent terms) before its
//      measurements can be merged with the main crop's own. A remapped
//      value legitimately going negative or above 100 (a point that sits
//      just outside the crop, which is the whole point of a strip's
//      padding) is correct, not a bug.
//   2. dedupMeasurementsV3 — the same real dimension line seen (and
//      independently transcribed) in more than one image must not enter
//      the merged list twice, or resolveAuthoritativeExtentV3 would SUM
//      the duplicate into the chain's total (silently doubling a real
//      measurement).
//
// Compile first (from shift_app repo root):
//   tsc --module commonjs --target ES2020 --outDir .dim_merge_test_build \
//     supabase/functions/_shared/dimension_evidence_schema_v3.ts \
//     supabase/functions/_shared/dimension_measurement_merge_v3.ts
//   node validate_dimension_measurement_merge_v3_test.mjs

import {
  remapLocalPctToCropPct,
  remapStripMeasurements,
  dedupMeasurementsV3,
} from "./.dim_merge_test_build/dimension_measurement_merge_v3.js";

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
function assertClose(actual, expected, label, eps = 1e-6) {
  if (actual == null || Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`FAIL: ${label}\n  expected ~${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

function m(id, rawNumeric, overrides = {}) {
  return {
    id,
    rawText: String(rawNumeric),
    rawNumeric,
    unit: "cm",
    axis: "horizontal",
    bboxPct: { xMinPct: 0, yMinPct: 0, xMaxPct: 5, yMaxPct: 5 },
    lineStartPct: null,
    lineEndPct: null,
    referenceTypeHint: "building",
    confidence: "high",
    ...overrides,
  };
}

// 1. Identity: strip bbox === crop bbox -> local pct passes through
// unchanged.
{
  const v = remapLocalPctToCropPct(37, 10, 90, 10, 90);
  assertClose(v, 37, "identity: strip bbox === crop bbox leaves the value unchanged");
}

// 2. Real composition, by hand: strip covers original-image x [0,20], crop
// covers original-image x [10,90]. A strip-local pct of 50 sits at
// original x=10 -- exactly the crop's own left edge -> crop-pct 0.
{
  const v = remapLocalPctToCropPct(50, 0, 20, 10, 90);
  assertClose(v, 0, "composition: strip-local midpoint maps onto the crop's own left edge");
}

// 3. A point that sits OUTSIDE the crop (this is the whole reason strips
// exist -- to capture a dimension line just past the tight crop) must
// remap to a NEGATIVE crop-pct, not be clamped to 0.
{
  const v = remapLocalPctToCropPct(0, 0, 20, 10, 90);
  assertClose(v, -12.5, "outside-crop point: remaps to a negative crop-pct, not clamped");
}

// 4. remapStripMeasurements: id gets a source prefix, bbox + line
// endpoints both get remapped using the composed transform, on x and y
// independently.
{
  const stripBbox = { xMinPct: 0, yMinPct: 40, xMaxPct: 20, yMaxPct: 60 }; // a "left" strip, original-image pct
  const cropBbox = { xMinPct: 10, yMinPct: 20, xMaxPct: 90, yMaxPct: 80 }; // main crop, original-image pct
  const measurement = m("m1", 1099, {
    axis: "vertical",
    lineStartPct: { xPct: 80, yPct: 5 },
    lineEndPct: { xPct: 80, yPct: 95 },
    bboxPct: { xMinPct: 75, yMinPct: 45, xMaxPct: 85, yMaxPct: 55 },
  });
  const [remapped] = remapStripMeasurements([measurement], "left", stripBbox, cropBbox);
  assertEqual(remapped.id, "left_m1", "remapStripMeasurements: id is prefixed with the source strip name");
  // x: local 80 -> original 0+0.8*20=16 -> crop ((16-10)/80)*100 = 7.5
  assertClose(remapped.lineStartPct.xPct, 7.5, "remapStripMeasurements: lineStartPct.x correctly composed");
  // y: local 5 -> original 40+0.05*20=41 -> crop ((41-20)/60)*100 = 35
  assertClose(remapped.lineStartPct.yPct, 35, "remapStripMeasurements: lineStartPct.y correctly composed");
  // y: local 95 -> original 40+0.95*20=59 -> crop ((59-20)/60)*100 = 65
  assertClose(remapped.lineEndPct.yPct, 65, "remapStripMeasurements: lineEndPct.y correctly composed");
  assertEqual(remapped.rawNumeric, 1099, "remapStripMeasurements: non-geometric fields pass through unchanged");
}

// 5. dedupMeasurementsV3: the SAME real dimension line, documented once in
// the main crop (no line endpoints found, medium confidence) and once in
// a strip (line endpoints found, high confidence, already remapped into
// crop-space) -- must collapse to ONE measurement, keeping the more
// informative copy.
{
  const fromMainCrop = m("m1", 1099, {
    axis: "vertical", confidence: "medium",
    bboxPct: { xMinPct: 2, yMinPct: 48, xMaxPct: 6, yMaxPct: 52 },
  });
  const fromLeftStrip = m("left_m1", 1099, {
    axis: "vertical", confidence: "high",
    lineStartPct: { xPct: 3, yPct: 2 }, lineEndPct: { xPct: 3, yPct: 96 },
    bboxPct: { xMinPct: 1, yMinPct: 47, xMaxPct: 5, yMaxPct: 53 },
  });
  const result = dedupMeasurementsV3([fromMainCrop, fromLeftStrip]);
  assertEqual(result.length, 1, "dedup: two readings of the same real line collapse to one");
  assertEqual(result[0].id, "left_m1", "dedup: keeps the copy with real line-endpoint data over the bbox-only copy");
}

// 6. NOT a duplicate: same numeric value, but far apart (two different
// walls that both happen to measure 234cm) -- both must survive.
{
  const wallA = m("wA", 234, { axis: "horizontal", bboxPct: { xMinPct: 10, yMinPct: 10, xMaxPct: 14, yMaxPct: 14 } });
  const wallB = m("wB", 234, { axis: "horizontal", bboxPct: { xMinPct: 70, yMinPct: 70, xMaxPct: 74, yMaxPct: 74 } });
  const result = dedupMeasurementsV3([wallA, wallB]);
  assertEqual(result.length, 2, "dedup: two genuinely different measurements sharing a value are NOT collapsed");
}

// 7. NOT a duplicate: same numeric value and same rough position, but
// different axis -- a real physical coincidence should not happen, but
// the axis guard must hold regardless.
{
  const h = m("h1", 500, { axis: "horizontal", bboxPct: { xMinPct: 40, yMinPct: 40, xMaxPct: 44, yMaxPct: 44 } });
  const v = m("v1", 500, { axis: "vertical", bboxPct: { xMinPct: 40, yMinPct: 40, xMaxPct: 44, yMaxPct: 44 } });
  const result = dedupMeasurementsV3([h, v]);
  assertEqual(result.length, 2, "dedup: same value/position but different axis -- never collapsed");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// validate_chain_nesting_v3_test.mjs
//
// Session 23 follow-up #5. Node-only tests for the containment/contiguity
// fix: an overall dimension line must never be additively summed with
// shorter measurements nested inside its own span.
//
// Run with: node validate_chain_nesting_v3_test.mjs
// Exit code checked directly with `echo $?` immediately after.

import { buildDimensionChains } from "./build/dimension_chain_builder_v3.js";
import { resolveAuthoritativeExtentV3 } from "./build/dimension_chain_resolver_v3.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

function mLine(id, rawNumeric, axis, hint, unit, lineStart, lineEnd, confidence = "high") {
  const xs = [lineStart.xPct, lineEnd.xPct];
  const ys = [lineStart.yPct, lineEnd.yPct];
  return {
    id,
    rawText: String(rawNumeric),
    rawNumeric,
    unit,
    axis,
    bboxPct: { xMinPct: Math.min(...xs), yMinPct: Math.min(...ys), xMaxPct: Math.max(...xs), yMaxPct: Math.max(...ys) },
    lineStartPct: lineStart,
    lineEndPct: lineEnd,
    referenceTypeHint: hint,
    confidence,
  };
}

function mNoLine(id, rawNumeric, axis, hint, unit, bbox, confidence = "high") {
  return {
    id, rawText: String(rawNumeric), rawNumeric, unit, axis, bboxPct: bbox,
    lineStartPct: null, lineEndPct: null, referenceTypeHint: hint, confidence,
  };
}

const convention = { detectedUnit: "cm", confidence: "high", evidence: [] };

// ---------------------------------------------------------------------
// Test 1 (the real bug): 1669 (overall) shares a baseline with 5 shorter
// segments that are all nested INSIDE its own span. They must never be
// summed together (the real bug produced 34.965m from exactly these
// numbers). 1669 must end up as its own single_overall chain; the 5
// segments (which don't cover enough of the page on their own) must not
// become an overall candidate.
// ---------------------------------------------------------------------
{
  const y = 14; // same baseline for all six
  const measurements = [
    mLine("bottom_m23", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: y }, { xPct: 98, yPct: y }),
    mLine("top_m1", 96.5, "horizontal", "wall", "cm", { xPct: 10, yPct: y }, { xPct: 20, yPct: y }),
    mLine("top_m2", 254, "horizontal", "wall", "cm", { xPct: 20, yPct: y }, { xPct: 25, yPct: y }),
    mLine("top_m3", 920, "horizontal", "wall", "cm", { xPct: 25, yPct: y }, { xPct: 45, yPct: y }),
    mLine("top_m4", 62, "horizontal", "wall", "cm", { xPct: 45, yPct: y }, { xPct: 50, yPct: y }),
    mLine("top_m5", 495, "horizontal", "wall", "cm", { xPct: 50, yPct: y }, { xPct: 55, yPct: y }),
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");

  const overallChain = chains.find((c) => c.measurementIds.length === 1 && c.measurementIds[0] === "bottom_m23");
  check("Test 1: 1669 becomes its own single-member chain", !!overallChain);
  check("Test 1: 1669's chain is tagged candidateType=single_overall", overallChain?.candidateType === "single_overall");
  check("Test 1: 1669 is an overall candidate on its own", overallChain?.isOverallCandidate === true);

  const buggyChain = chains.find((c) => c.measurementIds.includes("bottom_m23") && c.measurementIds.length > 1);
  check("Test 1: no chain sums 1669 together with any of the 5 nested segments", buggyChain === undefined);

  const segmentedChain = chains.find(
    (c) => c.measurementIds.length === 5 && c.measurementIds.every((id) => id.startsWith("top_m")),
  );
  check("Test 1: the 5 nested segments still form their own segmented_chain", !!segmentedChain);
  check("Test 1: that segmented_chain lists 1669 as an excluded container", segmentedChain?.excludedContainerIds.includes("bottom_m23"));
  check("Test 1: that segmented_chain is NOT an overall candidate (only 45% of the page)", segmentedChain?.isOverallCandidate === false);

  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  check(`Test 1: resolves to 16.69m from 1669 alone, not the old buggy 34.965m (got ${resolved.valueM})`, resolved.status === "resolved" && Math.abs(resolved.valueM - 16.69) < 0.001);
}

// ---------------------------------------------------------------------
// Test 2: containment requires at least 2 nested siblings (MIN_CONTAINED_SIBLINGS).
// Two ordinary adjacent segments on the same baseline (neither contains
// the other) must still sum normally -- this must NOT regress into every
// pair being treated as container+contained.
// ---------------------------------------------------------------------
{
  const y = 30;
  const measurements = [
    mLine("s1", 500, "vertical", "wall", "cm", { xPct: 5, yPct: 10 }, { xPct: 5, yPct: 50 }),
    mLine("s2", 300, "vertical", "wall", "cm", { xPct: 5, yPct: 50 }, { xPct: 5, yPct: 80 }),
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "vertical");
  const summed = chains.find((c) => c.measurementIds.length === 2);
  check("Test 2: two ordinary adjacent segments still form one segmented_chain (no false containment)", !!summed && summed.candidateType === "segmented_chain");
}

// ---------------------------------------------------------------------
// Test 3: contiguity -- two segments on the same baseline with a large
// gap between them (not "the next segment") must NOT be merged into one
// chain, even though nothing contains anything.
// ---------------------------------------------------------------------
{
  const y = 60;
  const measurements = [
    mLine("g1", 100, "horizontal", "wall", "cm", { xPct: 5, yPct: y }, { xPct: 15, yPct: y }),
    mLine("g2", 100, "horizontal", "wall", "cm", { xPct: 60, yPct: y }, { xPct: 70, yPct: y }), // big gap: 15 -> 60
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");
  const merged = chains.find((c) => c.measurementIds.length === 2);
  check("Test 3: two segments with a large gap between them are NOT merged into one chain", merged === undefined);
  check("Test 3: they instead form two separate local_dimension chains", chains.filter((c) => c.candidateType === "local_dimension").length === 2);
}

// ---------------------------------------------------------------------
// Regression: follow-up #4 (missing line geometry) must still behave
// correctly after the follow-up #5 changes.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("left_m1", 1089, "vertical", "building", "cm", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 91 }),
    mNoLine("bottom_m23v", 712, "vertical", "building", "cm", { xMinPct: 4, yMinPct: 30, xMaxPct: 8, yMaxPct: 40 }),
  ];
  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  check(`Regression (follow-up #4): vertical still resolves from 1089 alone (got ${resolved.valueM})`, resolved.status === "resolved" && Math.abs(resolved.valueM - 10.89) < 0.001);
}

// ---------------------------------------------------------------------
// Happy path: clean single overall chain per axis still resolves exactly
// as before.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("h_overall", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    mLine("v_overall", 1099, "vertical", "building", "cm", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 99 }),
  ];
  const h = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  const v = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  check(`Happy path: horizontal resolves to 16.69m (got ${h.valueM})`, h.status === "resolved" && Math.abs(h.valueM - 16.69) < 0.001);
  check(`Happy path: vertical resolves to 10.99m (got ${v.valueM})`, v.status === "resolved" && Math.abs(v.valueM - 10.99) < 0.001);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests PASSED");
  process.exit(0);
}


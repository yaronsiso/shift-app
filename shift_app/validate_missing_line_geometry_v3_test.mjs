// validate_missing_line_geometry_v3_test.mjs
//
// Session 23 follow-up #4. Standalone, node-only tests (no Deno/Flutter)
// for the missing-line-geometry exclusion fix in
// dimension_chain_builder_v3.ts / dimension_chain_resolver_v3.ts.
//
// Run against the commonjs build compiled from src_node/ (import paths
// stripped of the .ts suffix Deno needs -- source of truth for the real
// Deno files keeps the .ts imports; this is a node-compatible mirror for
// pure-logic testing only, same pattern the rest of this pipeline uses).
//
// Run with: node validate_missing_line_geometry_v3_test.mjs
// Exit code checked directly with `echo $?` immediately after -- never
// through a pipe (a real bug caught and fixed earlier in this project).

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
    id,
    rawText: String(rawNumeric),
    rawNumeric,
    unit,
    axis,
    bboxPct: bbox,
    lineStartPct: null,
    lineEndPct: null,
    referenceTypeHint: hint,
    confidence,
  };
}

const convention = { detectedUnit: "cm", confidence: "high", evidence: [] };

// ---------------------------------------------------------------------
// Test 1: 1669 and 147 sit on two different drawn baselines (cross apart
// by 8 pts, tolerance is 4) -> must never end up in the same chain, no
// matter how the model classified them.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("bottom_m17", 1669, "horizontal", "building", "unknown", { xPct: 7, yPct: 14 }, { xPct: 98, yPct: 14 }),
    mLine("bottom_m16", 147, "horizontal", "wall", "unknown", { xPct: 105, yPct: 6 }, { xPct: 111, yPct: 6 }),
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");
  const mixedChain = chains.find(
    (c) => c.measurementIds.includes("bottom_m17") && c.measurementIds.includes("bottom_m16"),
  );
  check("Test 1: 1669 and 147 (different baselines) never share a chain", mixedChain === undefined);
  check("Test 1: 1669 forms its own additive chain", chains.some((c) => c.measurementIds.length === 1 && c.measurementIds[0] === "bottom_m17" && c.chainMembership === "additive"));
}

// ---------------------------------------------------------------------
// Test 2 + 4: 712 has no line geometry and sits spatially close to 1089
// (which does have line geometry). 712 must become a standalone chain,
// tagged excluded_from_additive_chain: missing_line_geometry, and must
// never be summed with 1089 -- this is the exact real-drawing bug
// (chain_01_v = 712 + 1089 = 18.01m, wrongly conflicting with the correct
// 1089-alone = 10.89m reading).
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("left_m1", 1089, "vertical", "building", "unknown", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 91 }),
    mNoLine("bottom_m23", 712, "vertical", "building", "unknown", { xMinPct: 4, yMinPct: 30, xMaxPct: 8, yMaxPct: 40 }),
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "vertical");

  const standalone712 = chains.find((c) => c.measurementIds.length === 1 && c.measurementIds[0] === "bottom_m23");
  check("Test 2: 712 becomes its own standalone chain", !!standalone712);
  check("Test 2: 712's chain is tagged chainMembership=standalone", standalone712?.chainMembership === "standalone");
  check(
    "Test 2: 712's chain is tagged excluded_from_additive_chain=missing_line_geometry",
    standalone712?.excludedFromAdditiveChain === "missing_line_geometry",
  );
  check(
    "Test 2: 712's own coverage is far below the overall threshold (bbox span is tiny) -> not an overall candidate",
    standalone712?.isOverallCandidate === false,
  );

  const mixedChain = chains.find(
    (c) => c.measurementIds.includes("left_m1") && c.measurementIds.includes("bottom_m23"),
  );
  check("Test 2/4: 712 and 1089 never share a chain (no proximity fallback)", mixedChain === undefined);

  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  check("Test 2: vertical resolves (from 1089 alone, not 712+1089)", resolved.status === "resolved");
  check(
    `Test 2: resolved value is 10.89m, not the old buggy 18.01m (got ${resolved.valueM})`,
    resolved.valueM != null && Math.abs(resolved.valueM - 10.89) < 0.001,
  );
  check(
    "Test 2: no source chain used to resolve includes measurement 712",
    !resolved.sourceChainIds.some((id) => {
      const c = chains.find((ch) => ch.id === id);
      return c?.measurementIds.includes("bottom_m23");
    }),
  );
}

// ---------------------------------------------------------------------
// Test 3: a measurement with NO line geometry can still be independently
// judged a standalone overall candidate when its own bbox-derived span is
// strong enough AND at least one additive (geometry-known) chain exists on
// the same axis to anchor the reference span against.
// ---------------------------------------------------------------------
{
  const measurements = [
    // A short additive (geometry-known) wall chain that anchors the
    // reference span near the full page width.
    mLine("w1", 20, "horizontal", "wall", "cm", { xPct: 2, yPct: 50 }, { xPct: 97, yPct: 50 }),
    // A geometry-missing "1669"-like overall candidate whose own bbox span
    // independently covers almost the whole page and reaches both edges.
    mNoLine("standalone_overall", 1669, "horizontal", "building", "cm", {
      xMinPct: 3,
      yMinPct: 20,
      xMaxPct: 96,
      yMaxPct: 22,
    }),
  ];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");
  const standalone = chains.find((c) => c.measurementIds[0] === "standalone_overall");
  check("Test 3: geometry-missing measurement with strong span can be an overall candidate", standalone?.isOverallCandidate === true);
  check("Test 3: it is still tagged standalone / excluded from additive chains", standalone?.chainMembership === "standalone" && standalone?.excludedFromAdditiveChain === "missing_line_geometry");
}

// ---------------------------------------------------------------------
// Conservative dead end: an axis with ONLY geometry-missing measurements
// has no additive chain to anchor a reference span against, so nothing
// can qualify as an overall candidate -- status must be "missing", never
// a guess from bbox positions alone.
// ---------------------------------------------------------------------
{
  const measurements = [
    mNoLine("only1", 1669, "horizontal", "building", "cm", { xMinPct: 3, yMinPct: 20, xMaxPct: 96, yMaxPct: 22 }),
  ];
  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  check("Conservative dead end: axis with zero additive chains resolves to status=missing", resolved.status === "missing");
}

// ---------------------------------------------------------------------
// Happy-path regression: the known-good real-drawing case (clean single
// overall chain per axis, both with real line geometry) must still
// resolve exactly as before this fix.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("h_overall", 1669, "horizontal", "building", "unknown", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    mLine("v_overall", 1099, "vertical", "building", "unknown", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 99 }),
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


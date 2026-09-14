// Standalone test for dimension_chain_builder_v3.ts + dimension_chain_resolver_v3.ts
// — session 23, "the AI never decides which chain is overall; geometry
// does". Written against synthetic evidence shaped like the real test
// drawing from session 22 (id "the same real complex plan"): an explicit
// "1669" dimension line spanning nearly the full page width at the very
// top, an explicit "1099" dimension line spanning nearly the full page
// height on the left, and a short local "274" segment covering only part
// of the width elsewhere on the page.
//
// This file enforces, literally, the three conditions Yaron required
// before Pass 1 gets wired to Stage 1:
//   1. horizontal overall = 1669 -> resolves to 16.69m
//   2. vertical overall = 1099 -> resolves to 10.99m
//   3. 274 stays a local segment and is never selected as either axis's
//      overall value
// plus the pre-existing never-average rule, now re-verified against the
// NEW geometry-driven resolver (not just the old model-labeled-chain one).
//
// Compile first (from shift_app repo root):
//   tsc --module commonjs --target ES2020 --outDir .dim_v3_test_build \
//     supabase/functions/_shared/dimension_evidence_schema_v3.ts \
//     supabase/functions/_shared/dimension_chain_builder_v3.ts \
//     supabase/functions/_shared/dimension_chain_resolver_v3.ts
//   node validate_dimension_chain_resolver_v3_test.mjs

import { buildDimensionChains } from "./.dim_v3_test_build/dimension_chain_builder_v3.js";
import {
  resolveAuthoritativeExtentV3,
  toMetersV3,
} from "./.dim_v3_test_build/dimension_chain_resolver_v3.js";
import { resolveDocumentUnitConvention } from "./.dim_v3_test_build/document_unit_convention_resolver.js";

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
function assertClose(actual, expected, label, eps = 1e-6) {
  if (actual == null || Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`FAIL: ${label}\n  expected ~${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const CONVENTION_CM = { detectedUnit: "cm", confidence: "high", evidence: ["most bare numbers are 3-4 digits, consistent with cm"] };
const CONVENTION_UNKNOWN = { detectedUnit: "unknown", confidence: "low", evidence: [] };

function point(xPct, yPct) {
  return { xPct, yPct };
}

function m(id, rawNumeric, overrides = {}) {
  return {
    id,
    rawText: String(rawNumeric),
    rawNumeric,
    unit: "unknown",
    axis: "horizontal",
    bboxPct: { xMinPct: 0, yMinPct: 0, xMaxPct: 5, yMaxPct: 5 },
    lineStartPct: null,
    lineEndPct: null,
    referenceTypeHint: "building",
    confidence: "high",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// The real-drawing-shaped fixture Yaron specified: 1669 (horizontal,
// full width, top edge), 1099 (vertical, full height, left edge), 274
// (a short local segment, must never be selected as overall).
// ---------------------------------------------------------------------
const realDrawingFixture = [
  m("m_1669", 1669, {
    axis: "horizontal",
    unit: "cm",
    referenceTypeHint: "building",
    lineStartPct: point(1, 2),
    lineEndPct: point(99, 2),
    bboxPct: { xMinPct: 48, yMinPct: 0.5, xMaxPct: 52, yMaxPct: 3 },
  }),
  m("m_1099", 1099, {
    axis: "vertical",
    unit: "cm",
    referenceTypeHint: "building",
    lineStartPct: point(2, 1),
    lineEndPct: point(2, 98),
    bboxPct: { xMinPct: 0.5, yMinPct: 48, xMaxPct: 3, yMaxPct: 52 },
  }),
  m("m_274", 274, {
    axis: "horizontal",
    unit: "cm",
    referenceTypeHint: "wall", // a local wall segment, NOT the building envelope
    lineStartPct: point(62, 55),
    lineEndPct: point(78, 55),
    bboxPct: { xMinPct: 68, yMinPct: 53, xMaxPct: 72, yMaxPct: 57 },
  }),
];

// 1. THE THREE REQUIRED CONDITIONS.
{
  const hRes = resolveAuthoritativeExtentV3(realDrawingFixture, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(hRes.status, "resolved", "condition 1: horizontal resolves");
  assertClose(hRes.valueM, 16.69, "condition 1: horizontal 1669cm -> 16.69m exactly");
  assertTrue(hRes.sourceChainIds.every((id) => !id.includes("m_274")), "condition 1: source chain is not built from 274 alone incorrectly labeled");

  const vRes = resolveAuthoritativeExtentV3(realDrawingFixture, CONVENTION_UNKNOWN, "vertical");
  assertEqual(vRes.status, "resolved", "condition 2: vertical resolves");
  assertClose(vRes.valueM, 10.99, "condition 2: vertical 1099cm -> 10.99m exactly");

  // condition 3: 274's chain must not be geometry-flagged as an overall
  // candidate at all (coverage far below threshold), so it can never be
  // the source of either resolved value.
  const chains = buildDimensionChains(realDrawingFixture);
  const chain274 = chains.find((c) => c.measurementIds.includes("m_274"));
  assertTrue(!!chain274, "condition 3: 274 is part of some built chain");
  assertEqual(chain274.isOverallCandidate, false, "condition 3: 274's chain is NOT an overall candidate (low coverage)");
  assertTrue(hRes.valueM !== 2.74 && hRes.valueM !== 274, "condition 3: 274 never leaks into the resolved horizontal value");
}

// 2. Never averages: two full-span horizontal chains that disagree.
{
  const conflicting = [
    m("top", 1600, { axis: "horizontal", unit: "cm", lineStartPct: point(1, 2), lineEndPct: point(99, 2) }),
    m("bottom", 1780, { axis: "horizontal", unit: "cm", lineStartPct: point(1, 95), lineEndPct: point(99, 95) }),
  ];
  const res = resolveAuthoritativeExtentV3(conflicting, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "conflict", "never-average: two disagreeing full-span chains -> conflict");
  assertEqual(res.valueM, null, "never-average: valueM is null on conflict");
  assertTrue(res.valueM !== 16.9, "never-average: definitely not the old-style average (16.90)");
}

// 3. Agreeing chains on different strips (an explicit total row + a
// matching segment-breakdown row) both qualify geometrically and agree ->
// resolved, not averaged, not a conflict.
{
  const explicitTotal = m("total", 1000, { axis: "horizontal", unit: "cm", lineStartPct: point(1, 2), lineEndPct: point(99, 2) });
  const seg1 = m("s1", 400, { axis: "horizontal", unit: "cm", lineStartPct: point(1, 10), lineEndPct: point(41, 10) });
  const seg2 = m("s2", 600, { axis: "horizontal", unit: "cm", lineStartPct: point(41, 10), lineEndPct: point(99, 10) });
  const res = resolveAuthoritativeExtentV3([explicitTotal, seg1, seg2], CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "resolved", "agreeing cross-checked chains: resolved, not conflict");
  assertClose(res.valueM, 10.0, "agreeing cross-checked chains: value is 10.00m (not averaged/doubled)");
}

// 4. Unit convention fallback: per-measurement unit "unknown", document
// convention says cm.
{
  const evidence = [m("only", 500, { axis: "horizontal", unit: "unknown", lineStartPct: point(1, 2), lineEndPct: point(99, 2) })];
  const res = resolveAuthoritativeExtentV3(evidence, CONVENTION_CM, "horizontal");
  assertEqual(res.status, "resolved", "convention fallback: resolves using document convention");
  assertClose(res.valueM, 5.0, "convention fallback: 500 (unit unknown) + convention cm -> 5.00m");
}

// 5. area/elevation are never treated as lengths, even if geometrically
// full-span (guards against exactly the failure mode Yaron called out:
// 13.20 as room_area, +304.50 as elevation).
{
  const areaAsFullSpan = m("area", 13.2, {
    axis: "horizontal", unit: "cm", referenceTypeHint: "area",
    lineStartPct: point(1, 2), lineEndPct: point(99, 2),
  });
  assertEqual(toMetersV3(areaAsFullSpan, CONVENTION_CM), null, "area referenceTypeHint never converts to a length");
  const res = resolveAuthoritativeExtentV3([areaAsFullSpan], CONVENTION_CM, "horizontal");
  assertEqual(res.status, "unresolved", "a full-span area-only chain is geometrically a candidate but unresolved (no usable length)");

  const elevation = m("elev", 304.5, {
    axis: "horizontal", unit: "cm", referenceTypeHint: "elevation",
    lineStartPct: point(1, 2), lineEndPct: point(99, 2),
  });
  assertEqual(toMetersV3(elevation, CONVENTION_CM), null, "elevation referenceTypeHint never converts to a length");
}

// 6. No chain anywhere reaches overall coverage -> missing, distinct from
// conflict/unresolved.
{
  const onlyShortSegments = [
    m("a", 100, { axis: "horizontal", unit: "cm", lineStartPct: point(10, 20), lineEndPct: point(30, 20) }),
    m("b", 150, { axis: "horizontal", unit: "cm", lineStartPct: point(60, 70), lineEndPct: point(75, 70) }),
  ];
  const res = resolveAuthoritativeExtentV3(onlyShortSegments, CONVENTION_CM, "horizontal");
  assertEqual(res.status, "missing", "no full-span chain anywhere -> missing");
}

// 7. Chain builder: falls back to bboxPct when lineStart/lineEnd are null,
// and still clusters/orders correctly.
{
  const noLineData = [
    m("x1", 10, { axis: "horizontal", lineStartPct: null, lineEndPct: null, bboxPct: { xMinPct: 5, yMinPct: 40, xMaxPct: 15, yMaxPct: 45 } }),
    m("x2", 20, { axis: "horizontal", lineStartPct: null, lineEndPct: null, bboxPct: { xMinPct: 80, yMinPct: 41, xMaxPct: 90, yMaxPct: 46 } }),
  ];
  const chains = buildDimensionChains(noLineData);
  const chain = chains.find((c) => c.axis === "horizontal");
  assertTrue(!!chain, "bbox fallback: still builds a chain without line endpoints");
  assertEqual(chain.measurementIds, ["x1", "x2"], "bbox fallback: orders left-to-right using bbox center");
  assertEqual(chain.usedLineEndpointsCount, 0, "bbox fallback: correctly reports 0 members used real line endpoints");
}

// 8. Cross-axis isolation: a vertical measurement never leaks into a
// horizontal chain even if its cross-position coincides.
{
  const mixed = [
    m("h", 1669, { axis: "horizontal", unit: "cm", lineStartPct: point(1, 2), lineEndPct: point(99, 2) }),
    m("v", 1099, { axis: "vertical", unit: "cm", lineStartPct: point(2, 1), lineEndPct: point(2, 98) }),
  ];
  const hRes = resolveAuthoritativeExtentV3(mixed, CONVENTION_UNKNOWN, "horizontal");
  const vRes = resolveAuthoritativeExtentV3(mixed, CONVENTION_UNKNOWN, "vertical");
  assertClose(hRes.valueM, 16.69, "cross-axis isolation: horizontal unaffected by vertical measurement");
  assertClose(vRes.valueM, 10.99, "cross-axis isolation: vertical unaffected by horizontal measurement");
}

// 9. THE EXACT REAL-DRAWING NEAR-MISS (session 23, first real device test):
// the actual "1669" chain had span [14.0, 98.0] — 84% coverage, but its
// start (14.0) sat just past the original EDGE_TOLERANCE_PCT of 12, so it
// was wrongly rejected as an overall candidate. Confirms the widened
// tolerance (16) now accepts it.
{
  const nearMissOnly = [
    m("m56", 1669, {
      axis: "horizontal", unit: "cm", referenceTypeHint: "building",
      lineStartPct: point(98, 95), lineEndPct: point(14, 95),
    }),
  ];
  const res = resolveAuthoritativeExtentV3(nearMissOnly, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "resolved", "real near-miss: span [14,98] now resolves with the widened edge tolerance");
  assertClose(res.valueM, 16.69, "real near-miss: resolves to 16.69m");
}

// 10. Same real drawing, but WITH the competing 13-segment wall chain also
// present (span [15,97], summing to 16.215m — a real ~2.85% disagreement
// with 1669). Documents the actual, intentional side effect of widening
// the tolerance: the resolver now also considers this second chain and
// correctly reports a conflict rather than picking one silently. This is
// NOT a bug — it is the same never-average principle surfacing a real
// discrepancy between an explicit total and a segment breakdown, exactly
// as it should. Whether 16.69 or 16.215 is the "true" number is something
// Yaron checks against the real drawing, not something the code guesses.
{
  const explicitTotal = m("m56", 1669, {
    axis: "horizontal", unit: "cm", referenceTypeHint: "building",
    lineStartPct: point(98, 95), lineEndPct: point(14, 95),
  });
  const segmentValuesCm = [147, 120.5, 170.5, 60, 159.5, 115, 132, 50, 75, 110, 43, 107, 170, 162];
  // Evenly spaced, contiguous, spanning exactly [15,97] (the real chain's
  // observed span) — segment WIDTH on the page doesn't need to be
  // proportional to its cm value for this test; only the chain's overall
  // span (min start to max end) matters for coverage/candidacy.
  const stepPct = (97 - 15) / segmentValuesCm.length;
  const segments = segmentValuesCm.map((v, i) => m(`seg${i}`, v, {
    axis: "horizontal", unit: "cm", referenceTypeHint: "wall",
    lineStartPct: point(15 + i * stepPct, 85), lineEndPct: point(15 + (i + 1) * stepPct, 85),
  }));
  const res = resolveAuthoritativeExtentV3([explicitTotal, ...segments], CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "conflict", "real near-miss + competing segment chain: correctly reports conflict, does not silently pick 1669");
  assertEqual(res.valueM, null, "real near-miss + competing segment chain: valueM null on conflict, never averaged/guessed");
}

// 11. 274 must never be picked as overall on either axis, even with the
// widened tolerance — its own coverage (~15% in the real data) is nowhere
// close to the threshold regardless of the edge-tolerance value.
{
  const withLocalSegment274 = [
    m("m14", 274, {
      axis: "horizontal", unit: "cm", referenceTypeHint: "opening",
      lineStartPct: point(35, 2), lineEndPct: point(24, 2),
    }),
  ];
  const res = resolveAuthoritativeExtentV3(withLocalSegment274, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "missing", "274 alone: coverage far too low to ever qualify as overall, tolerance notwithstanding");
}

// 12. THE GENERAL FIX (session 23, follow-up #2), not just a wider
// constant: isOverallCandidate's edge check is now against the union of
// ALL dimension evidence on the axis (the drawing's own combined
// dimensioned extent), not the literal page 0/100. This case is
// constructed so the OLD page-edge check (even with the already-widened
// EDGE_TOLERANCE_PCT=16) would still have wrongly rejected it: a chain
// spanning [18,98] has its left edge 18 points from the page's own left
// edge — 2 points past a literal-page-relative tolerance of 16 — yet it
// is, by construction, the ENTIRE combined dimensioned extent on this
// axis (nothing else was ever measured further left or right). The new
// adaptive check correctly accepts it; the old literal-page check would
// not have. Real drawings can have a margin/legend of any size — this is
// the fix that stops the specific "14 vs 12" incident from recurring
// under a different margin, rather than a value that merely fit the one
// drawing already seen.
{
  const marginedOverall = [
    m("m1", 1820, {
      axis: "horizontal", unit: "cm", referenceTypeHint: "building",
      lineStartPct: point(18, 3), lineEndPct: point(98, 3),
    }),
  ];
  const chains = buildDimensionChains(marginedOverall);
  const chain = chains.find((c) => c.axis === "horizontal");
  assertTrue(!!chain, "margined overall: chain exists");
  assertEqual(chain.coveragePct, 80, "margined overall: coverage is exactly 80% of the literal page");
  assertEqual(
    chain.isOverallCandidate,
    true,
    "margined overall: qualifies via the adaptive union-of-evidence edge check, even though its edges (18/98) are outside a literal-page tolerance of 16",
  );
  const res = resolveAuthoritativeExtentV3(marginedOverall, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "resolved", "margined overall: resolves");
  assertClose(res.valueM, 18.2, "margined overall: 1820cm -> 18.20m");
}

// 13. SESSION 23 FOLLOW-UP #3, Fix B: strip-derived coordinates outside the
// canonical [0,100] main-crop space must never inflate coveragePct past
// 100, or let a wildly-out-of-range chain masquerade as an overall
// candidate via an inflated union-of-chains reference span. Shaped
// directly on Yaron's real (buggy, pre-fix) screenshot data:
// chain_02_h had raw span [-9.1, 115.2] and reported "124%" coverage.
{
  const stripOverrun = [
    m("strip_h", 1780, {
      axis: "horizontal", unit: "cm", referenceTypeHint: "building",
      lineStartPct: point(-9.1, 50), lineEndPct: point(115.2, 50),
    }),
  ];
  const chains = buildDimensionChains(stripOverrun);
  const chain = chains.find((c) => c.axis === "horizontal");
  assertTrue(!!chain, "strip overrun: chain exists");
  assertEqual(chain.rawSpanStartPct, -9.1, "strip overrun: raw span start preserved for diagnostics (unclamped)");
  assertClose(chain.rawSpanEndPct, 115.2, "strip overrun: raw span end preserved for diagnostics (unclamped)");
  assertEqual(chain.spanStartPct, 0, "strip overrun: clamped span start floors at 0");
  assertEqual(chain.spanEndPct, 100, "strip overrun: clamped span end caps at 100");
  assertEqual(chain.coveragePct, 100, "strip overrun: coverage clamps to exactly 100, never 124");
  assertTrue(chain.coveragePct <= 100, "strip overrun: coverage never exceeds 100 under any circumstance");
  assertEqual(chain.isOverallCandidate, true, "strip overrun: still correctly recognized as an overall candidate (fully covers the crop)");

  const res = resolveAuthoritativeExtentV3(stripOverrun, CONVENTION_UNKNOWN, "horizontal");
  assertEqual(res.status, "resolved", "strip overrun: still resolves normally despite the out-of-range raw evidence");
  assertClose(res.valueM, 17.8, "strip overrun: 1780cm -> 17.80m, unaffected by the clamp");
}

// 13b. A chain whose raw span sits ENTIRELY off one edge of the canonical
// space (e.g. a strip measurement that never actually reaches back into
// the main crop) must collapse to exactly 0% coverage, not a negative
// width and not a spurious overall candidacy.
{
  const entirelyOffEdge = [
    m("off_edge", 300, {
      axis: "horizontal", unit: "cm", referenceTypeHint: "wall",
      lineStartPct: point(-30, 50), lineEndPct: point(-5, 50),
    }),
  ];
  const chains = buildDimensionChains(entirelyOffEdge);
  const chain = chains.find((c) => c.axis === "horizontal");
  assertEqual(chain.rawSpanStartPct, -30, "entirely-off-edge: raw start preserved");
  assertEqual(chain.rawSpanEndPct, -5, "entirely-off-edge: raw end preserved");
  assertEqual(chain.spanStartPct, 0, "entirely-off-edge: clamped start floors at 0");
  assertEqual(chain.spanEndPct, 0, "entirely-off-edge: clamped end also floors at 0 (no overlap with [0,100])");
  assertEqual(chain.coveragePct, 0, "entirely-off-edge: coverage is exactly 0, never negative");
  assertEqual(chain.isOverallCandidate, false, "entirely-off-edge: never an overall candidate");
}

// 14. FULL-PIPELINE REGRESSION, matching Yaron's exact stated success
// criteria for this round: using the NEW code-computed
// DocumentUnitConvention (not a hand-fed one) end to end --
// horizontal=16.69m (source bottom_m22), vertical=10.99m (source
// left_m12), no averaging, and neither the Pass-0.5-shaped "274" nor
// "655" local segments are ever selected as either axis's overall value.
// The convention pool below is modeled on the real screenshots: building
// envelope + a handful of room/wall unknown-unit numbers that only make
// sense as cm.
{
  const fullDrawing = [
    // The two authoritative overall measurements (unit "unknown" on the
    // record itself, exactly like the real drawing -- must be resolved
    // via the CODE-COMPUTED convention, not a printed unit).
    m("bottom_m22", 1669, {
      axis: "horizontal", referenceTypeHint: "building",
      lineStartPct: point(1, 2), lineEndPct: point(99, 2),
    }),
    m("left_m12", 1099, {
      axis: "vertical", referenceTypeHint: "building",
      lineStartPct: point(2, 1), lineEndPct: point(2, 98),
    }),
    // Room/wall evidence purely to give the convention resolver enough
    // mutually-consistent unknown-unit measurements to infer "cm" from
    // (never used as chain members for the overall axes below -- they
    // sit on unrelated strips/cross-positions).
    m("room_a", 395, { axis: "horizontal", referenceTypeHint: "room", lineStartPct: point(20, 30), lineEndPct: point(59.5, 30) }),
    m("room_b", 390, { axis: "horizontal", referenceTypeHint: "room", lineStartPct: point(20, 40), lineEndPct: point(59, 40) }),
    m("wall_a", 20, { axis: "vertical", referenceTypeHint: "wall", lineStartPct: point(45, 30), lineEndPct: point(45, 32) }),
    m("wall_b", 22, { axis: "vertical", referenceTypeHint: "wall", lineStartPct: point(55, 30), lineEndPct: point(55, 32.2) }),
    // The Pass-0.5-shaped local segments that must NEVER be promoted to
    // "overall" -- short spans, nowhere near full coverage.
    m("m_274", 274, {
      axis: "horizontal", referenceTypeHint: "wall",
      lineStartPct: point(62, 55), lineEndPct: point(78, 55),
    }),
    m("m_655", 655, {
      axis: "vertical", referenceTypeHint: "room",
      lineStartPct: point(70, 20), lineEndPct: point(70, 40),
    }),
  ];

  const computedConvention = resolveDocumentUnitConvention(fullDrawing);
  assertEqual(computedConvention.detectedUnit, "cm", "full pipeline: code-computed convention is cm (never hand-fed)");

  const hRes = resolveAuthoritativeExtentV3(fullDrawing, computedConvention, "horizontal");
  assertEqual(hRes.status, "resolved", "full pipeline: horizontal resolves using the code-computed convention");
  assertClose(hRes.valueM, 16.69, "full pipeline: horizontal = 16.69m");
  assertTrue(hRes.sourceChainIds.every((id) => {
    const chain = buildDimensionChains(fullDrawing).find((c) => c.id === id);
    return !chain?.measurementIds.includes("m_274");
  }), "full pipeline: 274 never contributes to the resolved horizontal overall");

  const vRes = resolveAuthoritativeExtentV3(fullDrawing, computedConvention, "vertical");
  assertEqual(vRes.status, "resolved", "full pipeline: vertical resolves using the code-computed convention");
  assertClose(vRes.valueM, 10.99, "full pipeline: vertical = 10.99m");
  assertTrue(vRes.sourceChainIds.every((id) => {
    const chain = buildDimensionChains(fullDrawing).find((c) => c.id === id);
    return !chain?.measurementIds.includes("m_655");
  }), "full pipeline: 655 never contributes to the resolved vertical overall");

  // And directly: neither local segment's own chain ever qualifies as an
  // overall candidate in the first place.
  const allChains = buildDimensionChains(fullDrawing);
  const chain274 = allChains.find((c) => c.measurementIds.includes("m_274"));
  const chain655 = allChains.find((c) => c.measurementIds.includes("m_655"));
  assertEqual(chain274.isOverallCandidate, false, "full pipeline: 274's chain never qualifies as overall");
  assertEqual(chain655.isOverallCandidate, false, "full pipeline: 655's chain never qualifies as overall");

  // All reported coverage across every chain in the full fixture stays
  // within [0,100] -- the general form of Fix B, not just the two
  // targeted overrun cases above.
  assertTrue(
    allChains.every((c) => c.coveragePct >= 0 && c.coveragePct <= 100),
    "full pipeline: every chain's coveragePct is within [0,100]",
  );
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

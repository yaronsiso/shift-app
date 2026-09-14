// validate_completeness_v3_test.mjs
//
// Session 23 follow-up #7. Tests geometricFillRatio/gapCount/
// isCompletePartition and the completeness gate on extent-group
// competition, using Yaron's own real numbers: the 15-segment top-strip
// chain (62+395+38+72+60+40+60+160+110+195+100+123+72+85.5+96.5 = 1669,
// exactly) as arithmetic corroboration for an explicit "1669" overall
// reading, and a synthetic genuinely-incomplete competitor (with a real
// internal gap) that must be excluded from competing.

import { buildDimensionChains } from "./build/dimension_chain_builder_v3.js";
import { resolveAuthoritativeExtentV3 } from "./build/dimension_chain_resolver_v3.js";

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`PASS: ${label}`);
  else { console.log(`FAIL: ${label}`); failures++; }
}

function mLine(id, rawNumeric, axis, hint, unit, lineStart, lineEnd, confidence = "high") {
  const xs = [lineStart.xPct, lineEnd.xPct];
  const ys = [lineStart.yPct, lineEnd.yPct];
  return {
    id, rawText: String(rawNumeric), rawNumeric, unit, axis,
    bboxPct: { xMinPct: Math.min(...xs), yMinPct: Math.min(...ys), xMaxPct: Math.max(...xs), yMaxPct: Math.max(...ys) },
    lineStartPct: lineStart, lineEndPct: lineEnd, referenceTypeHint: hint, confidence,
  };
}

const convention = { detectedUnit: "cm", confidence: "high", evidence: [] };

// ---------------------------------------------------------------------
// Test 1: Yaron's real numbers -- 15 contiguous, gapless segments summing
// to EXACTLY 1669, laid out proportionally along [7,98.5] (each segment's
// own pixel-width proportional to its cm value, so the chain is BOTH
// geometrically gapless AND numerically consistent). Paired with an
// explicit "1669" single_overall reading at a similar span. These should
// arithmetically corroborate -- same extent group, agreeing, resolved to
// 16.69m with independentObservationCount=2, WITHOUT any 1669-specific
// hardcoding (the rule is generic: complete chain + matching sum = same
// evidence group).
// ---------------------------------------------------------------------
{
  const values = [62, 395, 38, 72, 60, 40, 60, 160, 110, 195, 100, 123, 72, 85.5, 96.5];
  const total = values.reduce((a, b) => a + b, 0); // 1669
  const pageStart = 7, pageEnd = 98.5, pageWidth = pageEnd - pageStart;
  let cursor = pageStart;
  const y = 5;
  const segments = values.map((v, i) => {
    const width = (v / total) * pageWidth;
    const start = cursor;
    const end = cursor + width;
    cursor = end;
    return mLine(`top_seg_${i + 1}`, v, "horizontal", "wall", "cm", { xPct: start, yPct: y }, { xPct: end, yPct: y });
  });
  const explicitOverall = mLine("explicit_1669", 1669, "horizontal", "building", "cm", { xPct: 6.8, yPct: 20 }, { xPct: 98.4, yPct: 20 });

  const measurements = [...segments, explicitOverall];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");
  const segChain = chains.find((c) => c.measurementIds.length === 15);
  check("Test 1: the 15 segments form one segmented_chain", !!segChain);
  check(`Test 1: it is a COMPLETE partition (got fillRatio=${segChain?.geometricFillRatio.toFixed(1)}, gaps=${segChain?.gapCount})`, segChain?.isCompletePartition === true);

  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  check("Test 1: resolves (arithmetic corroboration, not conflict)", resolved.status === "resolved");
  check(`Test 1: resolved value is 16.69m (got ${resolved.valueM})`, resolved.valueM != null && Math.abs(resolved.valueM - 16.69) < 0.001);
  check(
    `Test 1: independentObservationCount is 2 (explicit + complete segmented chain) (got ${resolved.extentGroups[0]?.independentObservationCount})`,
    resolved.extentGroups.length === 1 && resolved.extentGroups[0].independentObservationCount === 2,
  );
  check("Test 1: confidence boosted to high from corroboration", resolved.confidence === "high");
}

// ---------------------------------------------------------------------
// Test 2: same setup, but the segmented chain has a REAL internal gap
// (one segment removed, leaving a genuine unaccounted stretch) while its
// own reported span still looks close to full-page (because the
// remaining segments' endpoints still reach near both edges). This must
// be flagged isCompletePartition=false and EXCLUDED from competing
// against the explicit overall reading -- no false conflict.
// ---------------------------------------------------------------------
{
  const values = [62, 395, 38, 72, 60, 40, 60, 160, 110, 195, 100, 123, 72, 85.5, 96.5];
  const pageStart = 7, pageEnd = 98.5, pageWidth = pageEnd - pageStart;
  const total = values.reduce((a, b) => a + b, 0);
  let cursor = pageStart;
  const y = 5;
  const allSegments = values.map((v) => {
    const width = (v / total) * pageWidth;
    const start = cursor;
    const end = cursor + width;
    cursor = end;
    return { start, end, v };
  });
  // Drop the middle segment (index 7, value 160) entirely -- its neighbors
  // keep their OWN original endpoints (not stretched to close the gap),
  // so a real, measurable gap opens up in the middle of the chain while
  // the chain's overall first-start/last-end still spans almost the full page.
  const missingIdx = 7;
  const segments = allSegments
    .filter((_, i) => i !== missingIdx)
    .map((s, i) => mLine(`gap_seg_${i + 1}`, s.v, "horizontal", "wall", "cm", { xPct: s.start, yPct: y }, { xPct: s.end, yPct: y }));
  const gapWidth = allSegments[missingIdx].end - allSegments[missingIdx].start;

  const explicitOverall = mLine("explicit_1669_b", 1669, "horizontal", "building", "cm", { xPct: 6.8, yPct: 20 }, { xPct: 98.4, yPct: 20 });

  const measurements = [...segments, explicitOverall];
  const chains = buildDimensionChains(measurements).filter((c) => c.axis === "horizontal");
  // The missing segment splits partitionContiguous into two separate
  // chains UNLESS the gap is small enough to be within
  // ADJACENCY_GAP_TOLERANCE_PCT -- with a ~9.6pt-wide missing segment
  // (160/1669*91.5 ≈ 8.8pct), it should exceed that tolerance and split.
  console.log(`  [info] gapWidth=${gapWidth.toFixed(2)}pct, chains found: ${chains.map((c) => `${c.id}(${c.measurementIds.length}, complete=${c.isCompletePartition})`).join(", ")}`);

  const resolved = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  check("Test 2: still resolves cleanly from the explicit reading alone", resolved.status === "resolved");
  check(`Test 2: resolved value is 16.69m from the explicit chain only (got ${resolved.valueM})`, resolved.valueM != null && Math.abs(resolved.valueM - 16.69) < 0.001);
  check("Test 2: independentObservationCount is 1 (no false corroboration from the broken chain)", resolved.extentGroups[0]?.independentObservationCount === 1);
}

console.log("");
if (failures > 0) { console.log(`${failures} test(s) FAILED`); process.exit(1); }
else { console.log("All tests PASSED"); process.exit(0); }


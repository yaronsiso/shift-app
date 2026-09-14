// validate_resolved_page_dimensions_v3_test.mjs
//
// Session 23 follow-up #8. Tests the ResolvedPageDimensions adapter and
// the Stage 1 gate function against the exact regression scenarios Yaron
// listed: resolved H=16.69/V=10.99 passes through unchanged and unblocks
// Stage 1; a conflicting or insufficient axis blocks it; nothing here
// depends on (or can be influenced by) the old measurements/274 pipeline,
// because this adapter only ever looks at ResolvedExtentV3 objects that
// came from dimension_chain_resolver_v3.ts -- it has no path to read
// anything from the old "measurements" stage at all.

import { buildDimensionChains } from "./build/dimension_chain_builder_v3.js";
import { resolveAuthoritativeExtentV3 } from "./build/dimension_chain_resolver_v3.js";
import {
  toResolvedPageDimensions,
  shouldBlockStage1FromPageDimensions,
} from "./build/resolved_page_dimensions_v3.js";

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
// Test 1: both axes resolved (H=16.69, V=10.99, Yaron's real acceptance
// numbers) -> Stage 1 must NOT be blocked, and the canonical object must
// carry the exact values through unchanged (no re-derivation).
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("h_overall", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    mLine("v_overall", 1099, "vertical", "building", "cm", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 99 }),
  ];
  const h = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  const v = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  const resolved = toResolvedPageDimensions(h, v);

  check(`Test 1: horizontal status is resolved (got ${resolved.horizontal.status})`, resolved.horizontal.status === "resolved");
  check(`Test 1: horizontal extentM is exactly 16.69 (got ${resolved.horizontal.extentM})`, Math.abs(resolved.horizontal.extentM - 16.69) < 0.0001);
  check(`Test 1: vertical extentM is exactly 10.99 (got ${resolved.vertical.extentM})`, Math.abs(resolved.vertical.extentM - 10.99) < 0.0001);
  check("Test 1: horizontal evidenceIds carried through from sourceChainIds", JSON.stringify(resolved.horizontal.evidenceIds) === JSON.stringify(h.sourceChainIds));
  check("Test 1: Stage 1 is NOT blocked", shouldBlockStage1FromPageDimensions(resolved) === false);
}

// ---------------------------------------------------------------------
// Test 2: a genuine same-extent value conflict on one axis -> that axis's
// status must be "conflict" and Stage 1 must be blocked, even though the
// other axis resolved fine.
// ---------------------------------------------------------------------
{
  const measurements = [
    // horizontal: same extent, disagreeing values -> conflict
    mLine("h1", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    mLine("h2", 1400, "horizontal", "building", "cm", { xPct: 7.5, yPct: 21 }, { xPct: 98.2, yPct: 21 }),
    // vertical: clean, resolves fine
    mLine("v1", 1099, "vertical", "building", "cm", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 99 }),
  ];
  const h = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  const v = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  const resolved = toResolvedPageDimensions(h, v);

  check(`Test 2: horizontal status is conflict (got ${resolved.horizontal.status})`, resolved.horizontal.status === "conflict");
  check("Test 2: horizontal extentM is null on conflict", resolved.horizontal.extentM === null);
  check(`Test 2: vertical still resolved on its own (got ${resolved.vertical.status})`, resolved.vertical.status === "resolved");
  check("Test 2: Stage 1 IS blocked (one axis conflicting is enough)", shouldBlockStage1FromPageDimensions(resolved) === true);
}

// ---------------------------------------------------------------------
// Test 3: no usable evidence at all on one axis -> "insufficient", and
// Stage 1 blocked -- same as the old "missing" behavior, just renamed at
// the canonical layer.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("h1", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    // no vertical measurements at all
  ];
  const h = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  const v = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  const resolved = toResolvedPageDimensions(h, v);

  check(`Test 3: horizontal resolved (got ${resolved.horizontal.status})`, resolved.horizontal.status === "resolved");
  check(`Test 3: vertical is insufficient (got ${resolved.vertical.status})`, resolved.vertical.status === "insufficient");
  check("Test 3: Stage 1 IS blocked", shouldBlockStage1FromPageDimensions(resolved) === true);
}

// ---------------------------------------------------------------------
// Test 4: extentGroupId is populated for a resolved axis and points at a
// real group in the underlying ResolvedExtentV3.
// ---------------------------------------------------------------------
{
  const measurements = [
    mLine("h_overall", 1669, "horizontal", "building", "cm", { xPct: 7, yPct: 20 }, { xPct: 98, yPct: 20 }),
    mLine("v_overall", 1099, "vertical", "building", "cm", { xPct: 5, yPct: 2 }, { xPct: 5, yPct: 99 }),
  ];
  const h = resolveAuthoritativeExtentV3(measurements, convention, "horizontal");
  const v = resolveAuthoritativeExtentV3(measurements, convention, "vertical");
  const resolved = toResolvedPageDimensions(h, v);
  check(`Test 4: horizontal extentGroupId is set (got ${resolved.horizontal.extentGroupId})`, resolved.horizontal.extentGroupId != null);
  check(
    "Test 4: that group id actually exists among the resolved extent's own groups",
    h.extentGroups.some((g) => g.groupId === resolved.horizontal.extentGroupId),
  );
}

// ---------------------------------------------------------------------
// Note on the "old measurements/274 artifact can't influence Stage 1"
// requirement: this adapter's ONLY inputs are two ResolvedExtentV3
// objects computed by resolveAuthoritativeExtentV3 in this same file.
// There is no code path here (or in the rewired envelope function) that
// reads the old "measurements" stage at all -- that's a structural
// guarantee from removing the query entirely, not something a unit test
// on this pure module can exercise (it would require mocking Supabase).
// ---------------------------------------------------------------------

console.log("");
if (failures > 0) { console.log(`${failures} test(s) FAILED`); process.exit(1); }
else { console.log("All tests PASSED"); process.exit(0); }


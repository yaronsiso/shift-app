// Standalone test for document_unit_convention_resolver.ts — session 23,
// follow-up #3, Fix A ("DocumentUnitConvention as a separate deterministic
// resolution layer").
//
// Covers Yaron's explicit test list:
//   1. unknown raw units + a coherent cm document convention -> resolves
//   2. an ambiguous convention (ties/no strong margin) -> stays unresolved
//   3. raw measurements are never mutated by the resolver
// (Conditions 3/"1669/1099 resolve to 16.69/10.99" and 4/"strip
// coordinates outside canonical bbox cannot create >100% coverage" from
// Yaron's 5-item list are full-pipeline / chain-builder concerns and are
// covered in validate_dimension_chain_resolver_v3_test.mjs instead, next
// to the existing never-average tests they build on.)
//
// Compile first (from shift_app repo root):
//   tsc --module commonjs --target ES2020 --outDir .doc_unit_test_build \
//     supabase/functions/_shared/dimension_evidence_schema_v3.ts \
//     supabase/functions/_shared/dimension_chain_resolver_v3.ts \
//     supabase/functions/_shared/dimension_chain_builder_v3.ts \
//     supabase/functions/_shared/document_unit_convention_resolver.ts
//   node validate_document_unit_convention_resolver_test.mjs

import { resolveDocumentUnitConvention } from "./.doc_unit_test_build/document_unit_convention_resolver.js";

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
// 1. Real-drawing-shaped fixture (values modeled on Yaron's actual
// screenshots): building envelope 1669/1099, a handful of room
// dimensions (395/390/285), and wall thicknesses (20/22) -- all with
// unit:"unknown", exactly the situation on his test drawing. Under cm,
// EVERY one of these lands inside its referenceTypeHint's plausible
// range; under mm the room/wall numbers fall below their plausible
// minimums; under m the building numbers alone would be implausibly
// huge for a wall/room. cm should win by a wide margin.
// ---------------------------------------------------------------------
{
  const coherentCm = [
    m("bottom_m22", 1669, { referenceTypeHint: "building" }),
    m("left_m12", 1099, { referenceTypeHint: "building" }),
    m("room_a", 395, { referenceTypeHint: "room" }),
    m("room_b", 390, { referenceTypeHint: "room" }),
    m("room_c", 285, { referenceTypeHint: "room" }),
    m("wall_a", 20, { referenceTypeHint: "wall" }),
    m("wall_b", 22, { referenceTypeHint: "wall" }),
  ];
  const result = resolveDocumentUnitConvention(coherentCm);
  assertEqual(result.detectedUnit, "cm", "coherent cm fixture: resolves to cm");
  assertEqual(result.confidence, "high", "coherent cm fixture: high confidence (100% plausible, 7 measurements)");
  assertTrue(result.evidence.length > 0, "coherent cm fixture: evidence is non-empty");
}

// ---------------------------------------------------------------------
// 2. Ambiguous fixture: bare "building" numbers (500/600/700) that are
// simultaneously plausible as mm (0.5-0.7m) and as cm (5-7m) -- both
// candidates score 100%, so the margin is exactly zero. Must resolve to
// "unknown", never a coin-flip pick of either.
// ---------------------------------------------------------------------
{
  const ambiguous = [
    m("b1", 500, { referenceTypeHint: "building" }),
    m("b2", 600, { referenceTypeHint: "building" }),
    m("b3", 700, { referenceTypeHint: "building" }),
  ];
  const result = resolveDocumentUnitConvention(ambiguous);
  assertEqual(result.detectedUnit, "unknown", "ambiguous fixture: stays unresolved (no unit picked)");
  assertEqual(result.confidence, "low", "ambiguous fixture: low confidence");
}

// ---------------------------------------------------------------------
// 2b. Too few unknown-unit length measurements (below MIN_EVIDENCE_COUNT)
// -- must never infer a convention from one or two numbers alone, per
// Yaron's explicit "never from a single number" instruction.
// ---------------------------------------------------------------------
{
  const tooFew = [
    m("only_one", 1669, { referenceTypeHint: "building" }),
    m("only_two", 1099, { referenceTypeHint: "building" }),
  ];
  const result = resolveDocumentUnitConvention(tooFew);
  assertEqual(result.detectedUnit, "unknown", "too-few fixture: stays unresolved (< 3 measurements)");
}

// ---------------------------------------------------------------------
// 2c. Only non-length referenceTypeHints (area/elevation) -- must be
// excluded from the pool entirely, same population as isLengthType/
// toMetersV3 in dimension_chain_resolver_v3.ts.
// ---------------------------------------------------------------------
{
  const nonLengthOnly = [
    m("area_1", 1320, { referenceTypeHint: "area" }),
    m("elev_1", 30450, { referenceTypeHint: "elevation" }),
    m("area_2", 1450, { referenceTypeHint: "area" }),
  ];
  const result = resolveDocumentUnitConvention(nonLengthOnly);
  assertEqual(result.detectedUnit, "unknown", "area/elevation-only fixture: excluded from pool, stays unresolved");
}

// ---------------------------------------------------------------------
// 2d. Explicit-unit measurements must never enter the pool -- this
// resolver only ever infers a convention from measurements whose OWN
// unit is "unknown" (toMetersV3 already converts explicit-unit
// measurements directly and never needs a document convention for
// them). A drawing with a couple of unknown-unit numbers plus lots of
// already-explicit ones must NOT borrow the explicit ones as evidence.
// ---------------------------------------------------------------------
{
  const mostlyExplicit = [
    m("explicit_1", 250, { unit: "cm", referenceTypeHint: "room" }),
    m("explicit_2", 300, { unit: "cm", referenceTypeHint: "room" }),
    m("explicit_3", 400, { unit: "cm", referenceTypeHint: "room" }),
    m("explicit_4", 500, { unit: "cm", referenceTypeHint: "room" }),
    m("unknown_1", 1669, { referenceTypeHint: "building" }),
    m("unknown_2", 1099, { referenceTypeHint: "building" }),
  ];
  const result = resolveDocumentUnitConvention(mostlyExplicit);
  assertEqual(
    result.detectedUnit,
    "unknown",
    "explicit-unit measurements excluded from pool: only 2 unknown-unit ones remain, too few",
  );
}

// ---------------------------------------------------------------------
// 3. Raw measurements are NEVER mutated. Deep-clone the input, run the
// resolver, and confirm the original array/objects are byte-for-byte
// identical afterwards -- rawNumeric must stay 1669, unit must stay
// "unknown", on the record itself.
// ---------------------------------------------------------------------
{
  const original = [
    m("bottom_m22", 1669, { referenceTypeHint: "building" }),
    m("left_m12", 1099, { referenceTypeHint: "building" }),
    m("room_a", 395, { referenceTypeHint: "room" }),
    m("wall_a", 20, { referenceTypeHint: "wall" }),
  ];
  const beforeJson = JSON.stringify(original);
  resolveDocumentUnitConvention(original);
  const afterJson = JSON.stringify(original);
  assertEqual(afterJson, beforeJson, "resolver never mutates its input measurements array/objects");

  // And specifically: the exact fields Yaron called out by name.
  assertEqual(original[0].rawNumeric, 1669, "rawNumeric stays 1669 after resolution (never rewritten)");
  assertEqual(original[0].unit, "unknown", "unit stays 'unknown' on the raw record itself (never rewritten)");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

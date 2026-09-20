// validate_vnext_stability_utility_test.mjs
//
// SHIFT VNext Checkpoint 1 — tests for runStabilityComparison
// (vnext_checkpoint1_stability.ts). This is the utility the first real
// 3-run experiment will actually be judged by, so its own correctness
// matters as much as the schemas: it must correctly PASS three genuinely
// identical attempts, and it must correctly FAIL (with an explicit,
// non-averaged reason) when attempts differ in each of the mechanical
// ways the spec calls out — counts, axis-hint distribution, graph
// signature, bbox drift reporting, and rawText set differences.

import { runStabilityComparison, STABILITY_TOLERANCES_VNEXT } from "./build/vnext_checkpoint1_stability.js";
import { parseGeometryObservationVNext } from "./build/geometry_observation_schema_vnext.js";
import { validateGeometryObservationVNext } from "./build/geometry_observation_validators_vnext.js";
import { parseEvidenceObservationVNext } from "./build/evidence_observation_schema_vnext.js";
import { validateEvidenceObservationVNext } from "./build/evidence_observation_validators_vnext.js";

const TEST_FILE_ID = "stability";
let assertionsPassed = 0;
let failures = 0;
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

function p(x, y) { return { xPct: x, yPct: y }; }

function rectGeometry() {
  return {
    schemaVersion: "geometry_observation_vnext_v1",
    vertices: [
      { id: "v1", evidenceState: "OBSERVED", imagePct: p(10, 10), cornerAngleHint: "orthogonal_90" },
      { id: "v2", evidenceState: "OBSERVED", imagePct: p(90, 10), cornerAngleHint: "orthogonal_90" },
      { id: "v3", evidenceState: "OBSERVED", imagePct: p(90, 90), cornerAngleHint: "orthogonal_90" },
      { id: "v4", evidenceState: "OBSERVED", imagePct: p(10, 90), cornerAngleHint: "orthogonal_90" },
    ],
    edges: [
      { id: "e1", evidenceState: "OBSERVED", fromVertexId: "v1", toVertexId: "v2", axisHint: "horizontal", roleHint: "exterior_wall", drawingConventionHint: "single_line" },
      { id: "e2", evidenceState: "OBSERVED", fromVertexId: "v2", toVertexId: "v3", axisHint: "vertical", roleHint: "exterior_wall", drawingConventionHint: "single_line" },
      { id: "e3", evidenceState: "OBSERVED", fromVertexId: "v3", toVertexId: "v4", axisHint: "horizontal", roleHint: "exterior_wall", drawingConventionHint: "single_line" },
      { id: "e4", evidenceState: "OBSERVED", fromVertexId: "v4", toVertexId: "v1", axisHint: "vertical", roleHint: "exterior_wall", drawingConventionHint: "single_line" },
    ],
    roomRegions: [{ id: "r1", evidenceState: "OBSERVED", boundaryVertexIds: ["v1", "v2", "v3", "v4"], nearestLabelHint: null, roleHint: "room" }],
    openings: [],
    stairs: [],
    exteriorFeatures: [],
    perceptionNotes: null,
  };
}

function rectGeometryRelabeled() {
  // Same shape, same topology, different ids — the utility must treat
  // this as IDENTICAL (ids are arbitrary per call, never compared
  // directly; see file header).
  const g = rectGeometry();
  const remap = { v1: "vA", v2: "vB", v3: "vC", v4: "vD" };
  return {
    ...g,
    vertices: g.vertices.map((v) => ({ ...v, id: remap[v.id] })),
    edges: g.edges.map((e, i) => ({ ...e, id: `edgeX${i}`, fromVertexId: remap[e.fromVertexId], toVertexId: remap[e.toVertexId] })),
    roomRegions: [{ id: "roomX", evidenceState: "OBSERVED", boundaryVertexIds: ["vA", "vB", "vC", "vD"], nearestLabelHint: null, roleHint: "room" }],
  };
}

function evidenceBase() {
  return {
    schemaVersion: "evidence_observation_vnext_v1",
    dimensionEvidence: [
      { id: "d1", rawText: "1669", lineStartPct: null, lineEndPct: null, unitHint: "uncertain", confidence: "high" },
    ],
    textLabels: [{ id: "l1", rawText: "סלון", anchorImagePct: p(50, 50), roleHint: "room_label" }],
  };
}

function geometryWithExteriorSemantics(relabeled = false) {
  const g = relabeled ? rectGeometryRelabeled() : rectGeometry();
  const ids = relabeled ? ["vA", "vB"] : ["v1", "v2"];
  g.stairs = [{
    id: relabeled ? "stairs-other-id" : "s1",
    evidenceState: "OBSERVED",
    typeHint: "straight",
    contextHint: "exterior",
    anchorImagePct: p(20, 70),
    directionHint: 180,
  }];
  g.exteriorFeatures = [{
    id: relabeled ? "feature-other-id" : "f1",
    evidenceState: "OBSERVED",
    typeHint: "balcony",
    wallBoundaryVertexPaths: [ids],
    visibleBoundaryPathsImagePct: [],
    anchorImagePct: p(50, 20),
    boundaryCompletenessHint: "partial_visible",
    enclosureHint: "non_enclosed",
  }];
  return g;
}

function attempt(label, geometry, evidence, overrides = {}) {
  let checkedGeometry = geometry;
  if (geometry !== null) {
    checkedGeometry = parseGeometryObservationVNext(geometry);
    const geometryValidation = validateGeometryObservationVNext(checkedGeometry);
    if (!geometryValidation.valid) {
      throw new Error(`Invalid positive Geometry fixture ${label}: ${JSON.stringify(geometryValidation.errors)}`);
    }
  }

  let checkedEvidence = evidence;
  if (evidence !== null) {
    checkedEvidence = parseEvidenceObservationVNext(evidence);
    const evidenceValidation = validateEvidenceObservationVNext(checkedEvidence);
    if (!evidenceValidation.valid) {
      throw new Error(`Invalid positive Evidence fixture ${label}: ${JSON.stringify(evidenceValidation.errors)}`);
    }
  }

  return {
    attemptLabel: label,
    geometry: checkedGeometry,
    evidence: checkedEvidence,
    geometryDurationMs: 1000,
    evidenceDurationMs: 900,
    totalWallClockMs: 1050,
    ...overrides,
  };
}

// Positive stability fixtures must be valid contract objects before they
// reach the comparison utility. Negative control: the parser rejects the
// exact regression fixed above (a roomRegion missing evidenceState).
{
  const invalid = rectGeometryRelabeled();
  delete invalid.roomRegions[0].evidenceState;
  let rejected = false;
  try { parseGeometryObservationVNext(invalid); } catch { rejected = true; }
  check("Fixture guard: roomRegion without evidenceState is rejected", rejected);
}

// ---------------------------------------------------------------------
// Test 1: three genuinely identical attempts (modulo id relabeling) ->
// overallPass true, no failure reasons.
// ---------------------------------------------------------------------
{
  const attempts = [
    attempt("attempt-1", rectGeometry(), evidenceBase()),
    attempt("attempt-2", rectGeometryRelabeled(), evidenceBase()),
    attempt("attempt-3", rectGeometryRelabeled(), evidenceBase()),
  ];
  const report = runStabilityComparison(attempts);
  check(`Test 1: three identical (id-relabeled) attempts PASS overall (reasons=${JSON.stringify(report.failureReasons)})`, report.overallPass === true);
  check("Test 1: no failure reasons reported", report.failureReasons.length === 0);
  check("Test 1: all pairwise diffs report countsMatch", report.pairwiseDiffs.every((d) => d.countsMatch));
  check("Test 1: all pairwise diffs report graphSignatureMatch", report.pairwiseDiffs.every((d) => d.graphSignatureMatch));
  check("Test 1: all pairwise diffs report rawTextSetsMatch", report.pairwiseDiffs.every((d) => d.rawTextSetsMatch));
}

// ---------------------------------------------------------------------
// Test 2: a genuine vertex/edge count difference between attempts (the
// exact real-world symptom that triggered V2's own segmentation-
// stability episode: "14/13 vs 23/23...") must be caught, reported with
// the exact delta, and must FAIL overall — never averaged away.
// ---------------------------------------------------------------------
{
  const extra = rectGeometry();
  extra.vertices.push({ id: "v5", evidenceState: "UNKNOWN", imagePct: p(50, 10), cornerAngleHint: "uncertain" });
  extra.edges.push({ id: "e5", evidenceState: "UNKNOWN", fromVertexId: "v1", toVertexId: "v5", axisHint: "horizontal", roleHint: "uncertain", drawingConventionHint: "uncertain" });
  extra.edges.push({ id: "e6", evidenceState: "UNKNOWN", fromVertexId: "v5", toVertexId: "v2", axisHint: "horizontal", roleHint: "uncertain", drawingConventionHint: "uncertain" });

  const attempts = [attempt("attempt-1", rectGeometry(), evidenceBase()), attempt("attempt-2", extra, evidenceBase())];
  const report = runStabilityComparison(attempts);

  check("Test 2: differing vertex/edge counts FAIL overall", report.overallPass === false);
  check("Test 2: countsMatch is false in the pairwise diff", report.pairwiseDiffs[0].countsMatch === false);
  check(`Test 2: exact vertex delta reported (+1, got ${JSON.stringify(report.pairwiseDiffs[0].countDeltas)})`, report.pairwiseDiffs[0].countDeltas.vertices === 1);
  check("Test 2: exact edge delta reported (+2)", report.pairwiseDiffs[0].countDeltas.edges === 2);
  check(
    "Test 2: a specific, non-generic failure reason is recorded",
    report.failureReasons.some((r) => r.includes("entity counts differ")),
  );
}

// ---------------------------------------------------------------------
// Test 3: same vertex/edge COUNTS but a different axisHint distribution
// (e.g. one run calls an edge "diagonal_or_unknown" where another calls
// it "horizontal") must be caught even though counts alone would look
// identical — proving the utility doesn't stop at the cheapest signal.
// ---------------------------------------------------------------------
{
  const shifted = rectGeometry();
  shifted.edges[0].axisHint = "diagonal_or_unknown"; // was "horizontal"

  const attempts = [attempt("attempt-1", rectGeometry(), evidenceBase()), attempt("attempt-2", shifted, evidenceBase())];
  const report = runStabilityComparison(attempts);

  check("Test 3: identical counts but differing axisHint distribution still FAILS overall", report.overallPass === false);
  check("Test 3: countsMatch is TRUE (counts really are identical here)", report.pairwiseDiffs[0].countsMatch === true);
  check("Test 3: axisHintDistributionMatch is false", report.pairwiseDiffs[0].axisHintDistributionMatch === false);
}

// ---------------------------------------------------------------------
// Test 4: exact-rawText-set requirement — a missing or extra OCR reading
// between attempts must be reported by exact string, not summarized
// away, and must fail overall.
// ---------------------------------------------------------------------
{
  const changedEvidence = evidenceBase();
  changedEvidence.dimensionEvidence = [
    { id: "d1", rawText: "1670", lineStartPct: null, lineEndPct: null, unitHint: "uncertain", confidence: "high" }, // "1669" -> "1670"
  ];

  const attempts = [attempt("attempt-1", rectGeometry(), evidenceBase()), attempt("attempt-2", rectGeometry(), changedEvidence)];
  const report = runStabilityComparison(attempts);

  check("Test 4: a single-digit rawText difference FAILS overall (no tolerance for OCR of unchanged text)", report.overallPass === false);
  check("Test 4: rawTextSetsMatch is false", report.pairwiseDiffs[0].rawTextSetsMatch === false);
  check("Test 4: the missing exact string 'dim:1669' is reported", report.pairwiseDiffs[0].rawTextMissingFromB.includes("dim:1669"));
  check("Test 4: the extra exact string 'dim:1670' is reported", report.pairwiseDiffs[0].rawTextExtraInB.includes("dim:1670"));
}

// ---------------------------------------------------------------------
// Test 5: a missing/failed observation on one attempt (geometry: null)
// must itself be treated as a stability failure, not silently skipped.
// ---------------------------------------------------------------------
{
  const attempts = [attempt("attempt-1", rectGeometry(), evidenceBase()), attempt("attempt-2", null, evidenceBase())];
  const report = runStabilityComparison(attempts);
  check("Test 5: a null geometry observation on one attempt FAILS overall", report.overallPass === false);
  check(
    "Test 5: the specific attempt+reason is named, not a generic failure",
    report.failureReasons.some((r) => r.includes("attempt-2") && r.includes("missing")),
  );
}

// ---------------------------------------------------------------------
// Test 6: bbox drift is reported as a raw number and does NOT gate
// pass/fail by default (untuned placeholder — see file header), proving
// the "do not invent a tolerance silently" instruction is honored: the
// drift is visible, but not judged.
// ---------------------------------------------------------------------
{
  const drifted = rectGeometry();
  drifted.vertices = drifted.vertices.map((v) => ({ ...v, imagePct: { xPct: v.imagePct.xPct + 3, yPct: v.imagePct.yPct } }));
  const attempts = [attempt("attempt-1", rectGeometry(), evidenceBase()), attempt("attempt-2", drifted, evidenceBase())];
  const report = runStabilityComparison(attempts);

  check("Test 6: bboxDriftPct is reported as a real, non-null number", typeof report.pairwiseDiffs[0].bboxDriftPct === "number" && report.pairwiseDiffs[0].bboxDriftPct > 2.9);
  check(
    "Test 6: bbox drift alone (with everything else identical) does NOT appear in failureReasons (untuned, not gating yet)",
    STABILITY_TOLERANCES_VNEXT.bboxDriftGatesPassFail === false,
  );
  check("Test 6: with only bbox drift differing (same counts/axisHints/rawText), overall STILL passes", report.overallPass === true);
}

// ---------------------------------------------------------------------
// Test 7: empty Geometry is a valid deterministic stability input.
// ---------------------------------------------------------------------
{
  const emptyGeometry = () => ({
    schemaVersion: "geometry_observation_vnext_v1",
    vertices: [],
    edges: [],
    roomRegions: [],
    openings: [],
    stairs: [],
    exteriorFeatures: [],
    perceptionNotes: null,
  });
  let report;
  let threw = false;
  try {
    report = runStabilityComparison([
      attempt("empty-1", emptyGeometry(), evidenceBase()),
      attempt("empty-2", emptyGeometry(), evidenceBase()),
    ]);
  } catch {
    threw = true;
  }
  check("Test 7: empty Geometry stability comparison does not throw", !threw);
  check("Test 7: empty Geometry bounding box is null", report?.perAttempt.every((item) => item.boundingBoxPct === null));
  check(
    "Test 7: empty Geometry counts are all zero",
    report?.perAttempt.every((item) => item.counts && Object.values(item.counts).every((count) => count === 0)),
  );
  check(
    "Test 7: two empty Geometry attempts compare deterministically",
    report?.overallPass === true &&
      report.pairwiseDiffs[0].countsMatch === true &&
      report.pairwiseDiffs[0].graphSignatureMatch === true &&
      report.pairwiseDiffs[0].bboxDriftPct === null,
  );
}

// Exterior semantic stability is ID-independent but sensitive to every
// reviewed semantic field and to stairs context.
{
  const report = runStabilityComparison([
    attempt("semantic-1", geometryWithExteriorSemantics(false), evidenceBase()),
    attempt("semantic-2", geometryWithExteriorSemantics(true), evidenceBase()),
  ]);
  check("Test 8: relabeled exterior entities retain a matching semantic signature", report.pairwiseDiffs[0].exteriorSemanticsSignatureMatch === true);
  check("Test 8: arbitrary exterior/stairs ids do not fail stability", report.overallPass === true);
}

{
  const mutations = [
    ["typeHint", (g) => { g.exteriorFeatures[0].typeHint = "terrace"; }],
    ["evidenceState", (g) => { g.exteriorFeatures[0].evidenceState = "INFERRED"; }],
    ["boundaryCompletenessHint", (g) => { g.exteriorFeatures[0].boundaryCompletenessHint = "unknown"; }],
    ["enclosureHint", (g) => { g.exteriorFeatures[0].enclosureHint = "partially_enclosed"; }],
    ["stairs contextHint", (g) => { g.stairs[0].contextHint = "interior"; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = geometryWithExteriorSemantics(true);
    mutate(changed);
    const report = runStabilityComparison([
      attempt("semantic-base", geometryWithExteriorSemantics(false), evidenceBase()),
      attempt("semantic-mutated", changed, evidenceBase()),
    ]);
    check(
      `Test 9: ${label} difference fails the deterministic semantic signature`,
      report.overallPass === false && report.pairwiseDiffs[0].exteriorSemanticsSignatureMatch === false,
    );
  }
}


const summary = {
  testFileId: TEST_FILE_ID,
  assertionsPassed,
  assertionsFailed: failures,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify(summary));
process.exit(failures === 0 ? 0 : 1);

// validate_geometry_observation_vnext_test.mjs
//
// SHIFT VNext Checkpoint 1 — tests for GeometryObservationVNext's schema
// acceptance/forbidden-field guard (geometry_observation_schema_vnext.ts)
// and structural validator (geometry_observation_validators_vnext.ts).
// Same style as the existing validate_*_test.mjs files at the repo root:
// plain check()/PASS/FAIL, process.exit(1) on any failure.

import {
  parseGeometryObservationVNext,
  GeometryObservationVNextForbiddenFieldError,
} from "./build/geometry_observation_schema_vnext.js";
import { validateGeometryObservationVNext } from "./build/geometry_observation_validators_vnext.js";

const TEST_FILE_ID = "geometry";
let assertionsPassed = 0;
let failures = 0;
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

function p(x, y) { return { xPct: x, yPct: y }; }

function exteriorFeature(overrides = {}) {
  return {
    id: "f1",
    evidenceState: "OBSERVED",
    typeHint: "balcony",
    wallBoundaryVertexPaths: [["v1", "v2"]],
    visibleBoundaryPathsImagePct: [],
    anchorImagePct: p(50, 20),
    boundaryCompletenessHint: "partial_visible",
    enclosureHint: "non_enclosed",
    ...overrides,
  };
}

function baseValidGraph() {
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
    roomRegions: [
      { id: "r1", evidenceState: "OBSERVED", boundaryVertexIds: ["v1", "v2", "v3", "v4"], nearestLabelHint: p(50, 50), roleHint: "room" },
    ],
    openings: [
      { id: "o1", evidenceState: "OBSERVED", typeHint: "door", onEdgeIdHint: "e1", positionAlongEdgePctHint: 50, swingHint: "in_left", anchorImagePct: p(50, 10) },
    ],
    stairs: [],
    exteriorFeatures: [],
    perceptionNotes: null,
  };
}

// ---------------------------------------------------------------------
// Test 1: schema acceptance — a well-formed graph passes parse+validate
// cleanly, with no fatal errors.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  const parsed = parseGeometryObservationVNext(raw);
  const result = validateGeometryObservationVNext(parsed);
  check("Test 1: well-formed graph parses without throwing", true);
  check(`Test 1: well-formed graph validates as valid (errors=${JSON.stringify(result.errors)})`, result.valid === true);
  check("Test 1: no fatal errors on well-formed graph", result.errors.length === 0);
}

// ---------------------------------------------------------------------
// Test 2: forbidden fields — a smuggled metric/scale/area/rawText field
// anywhere in the tree must throw GeometryObservationVNextForbiddenFieldError,
// not silently pass through.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.edges[0].scale = "1:100";
  let threw = false;
  let isRightError = false;
  try {
    parseGeometryObservationVNext(raw);
  } catch (err) {
    threw = true;
    isRightError = err instanceof GeometryObservationVNextForbiddenFieldError;
  }
  check("Test 2: forbidden field 'scale' on an edge throws", threw);
  check("Test 2: thrown error is GeometryObservationVNextForbiddenFieldError", isRightError);
}
{
  const raw = baseValidGraph();
  raw.perceptionNotes = [{ vertexId: null, edgeId: null, regionId: null, note: "x", rawText: "1669" }];
  let threw = false;
  try { parseGeometryObservationVNext(raw); } catch (err) { threw = err instanceof GeometryObservationVNextForbiddenFieldError; }
  check("Test 2b: forbidden field 'rawText' anywhere in the tree throws", threw);
}
{
  const raw = baseValidGraph();
  raw.roomRegions[0].totalAreaSqm = 42;
  let threw = false;
  try { parseGeometryObservationVNext(raw); } catch (err) { threw = err instanceof GeometryObservationVNextForbiddenFieldError; }
  check("Test 2c: forbidden field 'totalAreaSqm' throws", threw);
}

// ---------------------------------------------------------------------
// Test 3: dangling references — an edge pointing at a vertex id that
// doesn't exist, and a roomRegion pointing at a missing vertex id, must
// both be FATAL (not silently ignored, not merely diagnostic).
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.edges[0].toVertexId = "v_ghost";
  const result = validateGeometryObservationVNext(raw);
  check("Test 3: dangling edge reference is invalid", result.valid === false);
  check(
    "Test 3: EDGE_REFERENCES_UNKNOWN_VERTEX reported",
    result.errors.some((e) => e.code === "EDGE_REFERENCES_UNKNOWN_VERTEX"),
  );
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    wallBoundaryVertexPaths: [],
    visibleBoundaryPathsImagePct: [[p(15, 60), p(45, 60), p(30, 80), p(15, 60)]],
    boundaryCompletenessHint: "complete_visible",
  })];
  check(
    "Test 29b: complete_visible accepted when visible path closes explicitly",
    validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid,
  );
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    boundaryCompletenessHint: "complete_visible",
    wallBoundaryVertexPaths: [["v1", "v2", "v3", "v1"], ["v3", "v4"]],
    visibleBoundaryPathsImagePct: [],
  })];
  const result = validateGeometryObservationVNext(parseGeometryObservationVNext(raw));
  check("Test 29c: complete_visible rejects a closed path beside an open fragment", result.valid === false);
  check(
    "Test 29c: mixed closed/open paths report explicit-closure error",
    result.errors.some((e) => e.code === "FEATURE_COMPLETE_BOUNDARY_NOT_EXPLICITLY_CLOSED"),
  );
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    boundaryCompletenessHint: "complete_visible",
    wallBoundaryVertexPaths: [["v1", "v2", "v3", "v1"]],
    visibleBoundaryPathsImagePct: [[p(15, 60), p(45, 60), p(30, 80), p(15, 60)]],
  })];
  check(
    "Test 29d: complete_visible accepts when every existing path closes explicitly",
    validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid,
  );
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    boundaryCompletenessHint: "complete_visible",
    wallBoundaryVertexPaths: [],
    visibleBoundaryPathsImagePct: [],
  })];
  const result = validateGeometryObservationVNext(parseGeometryObservationVNext(raw));
  check("Test 29e: complete_visible rejects zero paths", result.valid === false);
  check(
    "Test 29e: zero paths report explicit-closure error",
    result.errors.some((e) => e.code === "FEATURE_COMPLETE_BOUNDARY_NOT_EXPLICITLY_CLOSED"),
  );
}
{
  const raw = baseValidGraph();
  raw.roomRegions[0].boundaryVertexIds.push("v_ghost");
  const result = validateGeometryObservationVNext(raw);
  check("Test 3b: dangling region boundary reference is invalid", result.valid === false);
  check(
    "Test 3b: REGION_REFERENCES_UNKNOWN_VERTEX reported",
    result.errors.some((e) => e.code === "REGION_REFERENCES_UNKNOWN_VERTEX"),
  );
}
{
  // A dangling opening onEdgeIdHint is a HINT, not proof — must be
  // DIAGNOSTIC ONLY, never fatal (unlike edge/region references above).
  const raw = baseValidGraph();
  raw.openings[0].onEdgeIdHint = "e_ghost";
  const result = validateGeometryObservationVNext(raw);
  check("Test 3c: dangling opening onEdgeIdHint does NOT invalidate the graph", result.valid === true);
  check(
    "Test 3c: DANGLING_OPENING_EDGE_HINT reported as diagnostic",
    result.diagnostics.some((d) => d.code === "DANGLING_OPENING_EDGE_HINT"),
  );
}

// ---------------------------------------------------------------------
// Test 4: duplicate ids — across every entity type, must be fatal and
// correctly coded.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.vertices.push({ id: "v1", evidenceState: "UNKNOWN", imagePct: p(30, 30), cornerAngleHint: null });
  const result = validateGeometryObservationVNext(raw);
  check("Test 4: duplicate vertex id is invalid", result.valid === false);
  check("Test 4: DUPLICATE_VERTEX_ID reported", result.errors.some((e) => e.code === "DUPLICATE_VERTEX_ID"));
}
{
  const raw = baseValidGraph();
  raw.edges.push({ ...raw.edges[0] });
  const result = validateGeometryObservationVNext(raw);
  check("Test 4b: duplicate edge id is invalid", result.valid === false);
  check("Test 4b: DUPLICATE_EDGE_ID reported", result.errors.some((e) => e.code === "DUPLICATE_EDGE_ID"));
}

// ---------------------------------------------------------------------
// Test 5: non-finite / out-of-range coordinates — both fatal, distinct
// codes.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.vertices[0].imagePct = { xPct: NaN, yPct: 10 };
  const result = validateGeometryObservationVNext(raw);
  check("Test 5: non-finite coordinate is invalid", result.valid === false);
  check("Test 5: MALFORMED_COORDINATE reported", result.errors.some((e) => e.code === "MALFORMED_COORDINATE"));
}
{
  const raw = baseValidGraph();
  raw.vertices[0].imagePct = { xPct: 5000, yPct: 10 };
  const result = validateGeometryObservationVNext(raw);
  check("Test 5b: grossly out-of-range coordinate is invalid", result.valid === false);
  check("Test 5b: OUT_OF_RANGE_COORDINATE reported", result.errors.some((e) => e.code === "OUT_OF_RANGE_COORDINATE"));
}
{
  // Within the deliberately generous tolerance band — must NOT fire.
  const raw = baseValidGraph();
  raw.vertices[0].imagePct = { xPct: -1, yPct: 101 };
  const result = validateGeometryObservationVNext(raw);
  check("Test 5c: coordinate within the tolerated bound is NOT flagged", result.valid === true);
}

// ---------------------------------------------------------------------
// Test 6: zero-length edge — fatal, matching envelope_topology_validators_v2.ts's
// precedent exactly.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.vertices.push({ id: "v5", evidenceState: "UNKNOWN", imagePct: p(10.001, 10), cornerAngleHint: "uncertain" });
  raw.edges.push({ id: "e5", evidenceState: "UNKNOWN", fromVertexId: "v1", toVertexId: "v5", axisHint: "horizontal", roleHint: "uncertain", drawingConventionHint: "uncertain" });
  const result = validateGeometryObservationVNext(raw);
  check("Test 6: near-zero-length edge is invalid", result.valid === false);
  check("Test 6: ZERO_LENGTH_EDGE reported", result.errors.some((e) => e.code === "ZERO_LENGTH_EDGE"));
}

// Empty geometry is an honest result for an unreadable image.
{
  const raw = {
    schemaVersion: "geometry_observation_vnext_v1",
    vertices: [], edges: [], roomRegions: [], openings: [], stairs: [],
    exteriorFeatures: [], perceptionNotes: null,
  };
  const parsed = parseGeometryObservationVNext(raw);
  check("Test 8: empty geometry parses and validates", validateGeometryObservationVNext(parsed).valid === true);
}

// Provenance is mandatory on every Geometry entity type.
{
  const entityCases = [
    ["vertex", (raw) => raw.vertices[0]],
    ["edge", (raw) => raw.edges[0]],
    ["roomRegion", (raw) => raw.roomRegions[0]],
    ["opening", (raw) => raw.openings[0]],
    ["stairs", (raw) => {
      raw.stairs = [{ id: "s1", evidenceState: "OBSERVED", typeHint: "straight", contextHint: "interior", anchorImagePct: p(20, 20), directionHint: null }];
      return raw.stairs[0];
    }],
    ["exteriorFeature", (raw) => {
      raw.exteriorFeatures = [exteriorFeature()];
      return raw.exteriorFeatures[0];
    }],
    ["perceptionNote", (raw) => {
      raw.perceptionNotes = [{ evidenceState: "OBSERVED", vertexId: "v1", edgeId: "e1", regionId: "r1", note: "visible" }];
      return raw.perceptionNotes[0];
    }],
  ];

  for (const [label, selectEntity] of entityCases) {
    for (const state of ["OBSERVED", "INFERRED", "UNKNOWN"]) {
      const raw = baseValidGraph();
      selectEntity(raw).evidenceState = state;
      let accepted = false;
      try { accepted = validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid; } catch { accepted = false; }
      check("Test 9: " + label + " accepts evidenceState " + state, accepted);
    }

    const resolved = baseValidGraph();
    selectEntity(resolved).evidenceState = "RESOLVED";
    let resolvedRejected = false;
    try { parseGeometryObservationVNext(resolved); } catch { resolvedRejected = true; }
    check("Test 9: " + label + " rejects RESOLVED", resolvedRejected);

    const missing = baseValidGraph();
    delete selectEntity(missing).evidenceState;
    let missingRejected = false;
    try { parseGeometryObservationVNext(missing); } catch { missingRejected = true; }
    check("Test 9: " + label + " rejects missing evidenceState", missingRejected);
  }
}

// Runtime schema completeness/additional-properties checks.
{
  const missing = baseValidGraph();
  delete missing.vertices[0].evidenceState;
  let missingRejected = false;
  try { parseGeometryObservationVNext(missing); } catch { missingRejected = true; }
  check("Test 10: missing required property rejected", missingRejected);

  const extra = baseValidGraph();
  extra.vertices[0].unexpected = true;
  let extraRejected = false;
  try { parseGeometryObservationVNext(extra); } catch { extraRejected = true; }
  check("Test 10b: additional property rejected", extraRejected);
}

{
  const raw = baseValidGraph();
  raw.openings[0].positionAlongEdgePctHint = 101;
  check("Test 11: positionAlongEdgePctHint outside [0,100] rejected", !validateGeometryObservationVNext(raw).valid);
}

{
  const raw = baseValidGraph();
  raw.perceptionNotes = [{ evidenceState: "OBSERVED", vertexId: "missing", edgeId: null, regionId: null, note: "occluded" }];
  check("Test 12: missing perceptionNotes reference rejected", !validateGeometryObservationVNext(raw).valid);
}

{
  const directionCases = [
    [0, true],
    [359.9999995, true],
    [360, false],
    [-0.000001, false],
    [null, true],
  ];
  for (const [directionHint, expectedValid] of directionCases) {
    const raw = baseValidGraph();
    raw.stairs = [{ id: "s1", evidenceState: "INFERRED", typeHint: "straight", contextHint: "interior", anchorImagePct: p(20, 20), directionHint }];
    let acceptedBySchemaAndValidator = false;
    try { acceptedBySchemaAndValidator = validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid; } catch { acceptedBySchemaAndValidator = false; }
    check("Test 13: directionHint=" + String(directionHint) + " acceptance is " + expectedValid, acceptedBySchemaAndValidator === expectedValid);
  }

  const raw = baseValidGraph();
  raw.stairs = [{ id: "s1", evidenceState: "INFERRED", typeHint: "straight", contextHint: "exterior", anchorImagePct: p(20, 20), directionHint: 90 }];
  raw.perceptionNotes = [{ evidenceState: "UNKNOWN", vertexId: "v1", edgeId: "e1", regionId: "r1", note: "partially occluded" }];
  check("Test 13b: valid direction and perceptionNotes references accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

// Duplicate ids are checked for every entity collection.
{
  const cases = [
    ["roomRegions", { ...baseValidGraph().roomRegions[0] }],
    ["openings", { ...baseValidGraph().openings[0] }],
    ["stairs", { id: "s1", evidenceState: "OBSERVED", typeHint: "straight", contextHint: "interior", anchorImagePct: p(20, 20), directionHint: null }],
    ["exteriorFeatures", exteriorFeature()],
  ];
  for (const [collection, entity] of cases) {
    const raw = baseValidGraph();
    raw[collection] = [entity, { ...entity }];
    check(`Test 14: duplicate ids rejected for ${collection}`, !validateGeometryObservationVNext(raw).valid);
  }
}

// Exterior-feature contract: all approved types and honest partial/open
// representations are accepted without inventing wall geometry.
{
  const cases = [
    ["balcony", "non_enclosed"],
    ["terrace", "partially_enclosed"],
    ["paving", "non_enclosed"],
    ["pergola", "non_enclosed"],
    ["canopy", "unknown"],
  ];
  for (const [typeHint, enclosureHint] of cases) {
    const raw = baseValidGraph();
    raw.exteriorFeatures = [exteriorFeature({ typeHint, enclosureHint })];
    check(`Test 15: ${typeHint} exterior feature accepted`, validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
  }
}

{
  const raw = baseValidGraph();
  raw.stairs = [{
    id: "s-exterior",
    evidenceState: "OBSERVED",
    typeHint: "straight",
    contextHint: "exterior",
    anchorImagePct: p(15, 75),
    directionHint: 180,
  }];
  check("Test 16: exterior stairs accepted under stairs", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
  check("Test 16: exterior stairs need no duplicate exteriorFeature", raw.exteriorFeatures.length === 0);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ wallBoundaryVertexPaths: [["v1", "v2"], ["v3", "v4"]] })];
  check("Test 17: separate visible wall fragments are accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    wallBoundaryVertexPaths: [],
    visibleBoundaryPathsImagePct: [[p(15, 60), p(30, 65), p(45, 60)]],
  })];
  check("Test 18: independent visible boundary path accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    wallBoundaryVertexPaths: [["v1", "v2"], ["v3", "v4"]],
    visibleBoundaryPathsImagePct: [[p(20, 60), p(30, 65)], [p(60, 65), p(70, 60)]],
    boundaryCompletenessHint: "partial_visible",
  })];
  check("Test 19: multiple separate partial fragments accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ wallBoundaryVertexPaths: [], visibleBoundaryPathsImagePct: [] })];
  check("Test 20: empty paths with a visible anchor accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    evidenceState: "UNKNOWN",
    typeHint: "uncertain",
    wallBoundaryVertexPaths: [],
    visibleBoundaryPathsImagePct: [],
    anchorImagePct: null,
    boundaryCompletenessHint: "unknown",
    enclosureHint: "unknown",
  })];
  check("Test 21: UNKNOWN feature with no paths or anchor accepted", validateGeometryObservationVNext(parseGeometryObservationVNext(raw)).valid);
}

// Exterior-feature negative controls.
{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ typeHint: "pool" })];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 22: invalid exterior typeHint rejected", rejected);
}

{
  const raw = baseValidGraph();
  raw.stairs = [{ id: "s1", evidenceState: "OBSERVED", typeHint: "straight", contextHint: "roof", anchorImagePct: p(20, 20), directionHint: null }];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 23: invalid stairs contextHint rejected", rejected);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ wallBoundaryVertexPaths: [["v1", "v-missing"]] })];
  const result = validateGeometryObservationVNext(raw);
  check("Test 24: missing wall vertex invalidates feature", result.valid === false);
  check("Test 24: FEATURE_REFERENCES_UNKNOWN_VERTEX reported", result.errors.some((e) => e.code === "FEATURE_REFERENCES_UNKNOWN_VERTEX"));
}

for (const [label, overrides] of [
  ["wall path", { wallBoundaryVertexPaths: [["v1"]] }],
  ["independent visible path", { wallBoundaryVertexPaths: [], visibleBoundaryPathsImagePct: [[p(10, 10)]] }],
]) {
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature(overrides)];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check(`Test 25: ${label} with fewer than two points rejected`, rejected);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    wallBoundaryVertexPaths: [],
    visibleBoundaryPathsImagePct: [[p(10, 10), p(103, 10)]],
  })];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 26: exterior path coordinate outside [-2,102] rejected", rejected);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ anchorImagePct: p(-3, 10) })];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 26b: exterior anchor coordinate outside [-2,102] rejected", rejected);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({ unexpected: true })];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 27: additional exterior feature field rejected", rejected);
}

{
  const raw = baseValidGraph();
  const feature = exteriorFeature();
  delete feature.enclosureHint;
  raw.exteriorFeatures = [feature];
  let rejected = false;
  try { parseGeometryObservationVNext(raw); } catch { rejected = true; }
  check("Test 28: missing required exterior feature field rejected", rejected);
}

{
  const raw = baseValidGraph();
  raw.exteriorFeatures = [exteriorFeature({
    boundaryCompletenessHint: "complete_visible",
    wallBoundaryVertexPaths: [["v1", "v2", "v3"]],
  })];
  const result = validateGeometryObservationVNext(parseGeometryObservationVNext(raw));
  check("Test 29: complete_visible cannot rely on implicit closure", result.valid === false);
  check(
    "Test 29: explicit-closure error reported",
    result.errors.some((e) => e.code === "FEATURE_COMPLETE_BOUNDARY_NOT_EXPLICITLY_CLOSED"),
  );
}

// ---------------------------------------------------------------------
// Test 7: honest partial output — null perceptionNotes, empty
// openings/stairs/exteriorFeatures arrays must all be accepted as valid,
// never forced/filled.
// ---------------------------------------------------------------------
{
  const raw = baseValidGraph();
  raw.openings = [];
  raw.perceptionNotes = null;
  const result = validateGeometryObservationVNext(raw);
  check("Test 7: empty openings + null perceptionNotes is still valid", result.valid === true);
}

const summary = {
  testFileId: TEST_FILE_ID,
  assertionsPassed,
  assertionsFailed: failures,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify(summary));
process.exit(failures === 0 ? 0 : 1);

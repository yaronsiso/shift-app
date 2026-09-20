// supabase/functions/_shared/geometry_observation_validators_vnext.ts
//
// Pure, side-effect-free validators for GeometryObservationVNext. No AI
// calls, no I/O — geometry-and-graph checks against image-space
// percentages only. Same fatal/diagnostic split precedent as
// envelope_topology_validators_v2.ts:
//   - FATAL errors gate `valid`. STRUCTURAL CORRUPTION only: duplicate ids
//     (any entity type), dangling REQUIRED references (edge->vertex,
//     region/feature boundary->vertex), non-finite or out-of-range
//     coordinates, and truly degenerate (zero/near-zero) edges. Never
//     semantic.
//   - DIAGNOSTICS never gate `valid`. Shape/hint-quality observations only
//     — including a dangling HINT reference (e.g. an opening's
//     onEdgeIdHint pointing nowhere), because a hint is explicitly
//     non-authoritative and "the AI's hint didn't resolve" is not the same
//     class of problem as "the graph itself is broken".
//
// DEVIATION FROM V1/V2 PRECEDENT, FLAGGED EXPLICITLY (see final report):
// V2's own validator deliberately does NOT bound-check imagePct against
// [0,100] ("no bound is enforced... if a bound is ever justified, it
// should be added deliberately and separately, not invented here by
// inference" — envelope_topology_validators_v2.ts). Checkpoint 1's spec
// explicitly requires test coverage for "non-finite/out-of-range image
// coordinates" as a fatal category, so this file DOES add an explicit,
// generously-tolerant bound (see IMAGE_PCT_BOUND_MIN/MAX_VNEXT below) —
// a deliberate, separate decision for this new schema, not a silent copy
// of V1/V2's choice and not a retroactive change to either of those files.

import type {
  GeometryObservationVNext,
  GeometryVertexVNext,
  ImagePctVNext,
} from "./geometry_observation_schema_vnext.ts";

export type FatalErrorCodeGeometryVNext =
  | "DUPLICATE_VERTEX_ID"
  | "DUPLICATE_EDGE_ID"
  | "DUPLICATE_REGION_ID"
  | "DUPLICATE_OPENING_ID"
  | "DUPLICATE_STAIRS_ID"
  | "DUPLICATE_FEATURE_ID"
  | "EDGE_REFERENCES_UNKNOWN_VERTEX"
  | "REGION_REFERENCES_UNKNOWN_VERTEX"
  | "FEATURE_REFERENCES_UNKNOWN_VERTEX"
  | "FEATURE_WALL_PATH_TOO_SHORT"
  | "FEATURE_VISIBLE_PATH_TOO_SHORT"
  | "FEATURE_COMPLETE_BOUNDARY_NOT_EXPLICITLY_CLOSED"
  | "NOTE_REFERENCES_UNKNOWN_ENTITY"
  | "INVALID_EVIDENCE_STATE"
  | "POSITION_ALONG_EDGE_OUT_OF_RANGE"
  | "INVALID_DIRECTION_HINT"
  | "MALFORMED_COORDINATE"
  | "OUT_OF_RANGE_COORDINATE"
  | "ZERO_LENGTH_EDGE";

export type DiagnosticCodeGeometryVNext =
  | "MULTIPLE_CONNECTED_COMPONENTS"
  | "OPEN_GRAPH_ENDPOINTS"
  | "AXIS_HINT_MISMATCH"
  | "UNCERTAIN_HINT_PRESENT"
  | "DANGLING_OPENING_EDGE_HINT"
  | "REGION_WITH_FEWER_THAN_THREE_VERTICES";

export interface FatalErrorGeometryVNext {
  code: FatalErrorCodeGeometryVNext;
  message: string;
  relatedIds: string[];
}

export interface DiagnosticGeometryVNext {
  code: DiagnosticCodeGeometryVNext;
  message: string;
  relatedIds: string[];
}

export interface ValidationResultGeometryVNext {
  valid: boolean;
  errors: FatalErrorGeometryVNext[];
  diagnostics: DiagnosticGeometryVNext[];
}

// ---- Tolerances -------------------------------------------------------

export const ZERO_LENGTH_EPSILON_PCT_GEOMETRY_VNEXT = 0.05;
export const AXIS_HINT_TOLERANCE_PCT_GEOMETRY_VNEXT = 3;
// Deliberately generous (not exactly [0,100]) to tolerate a vertex sitting
// fractionally outside the crop due to normal rounding at the crop edge
// itself, without silently accepting a genuinely broken coordinate (e.g. a
// stray 500 or -9999, which a malformed/garbled model response could
// produce). See file header for why this bound exists at all, unlike V2.
export const IMAGE_PCT_BOUND_MIN_VNEXT = -2;
export const IMAGE_PCT_BOUND_MAX_VNEXT = 102;

// ---- Helpers ------------------------------------------------------------

function dist(a: ImagePctVNext, b: ImagePctVNext): number {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function indexVertices(vertices: GeometryVertexVNext[]): Map<string, GeometryVertexVNext> {
  const map = new Map<string, GeometryVertexVNext>();
  for (const v of vertices) map.set(v.id, v);
  return map;
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function isFiniteCoordinate(p: ImagePctVNext | null | undefined): boolean {
  return !!p && Number.isFinite(p.xPct) && Number.isFinite(p.yPct);
}

function isInRangeCoordinate(p: ImagePctVNext): boolean {
  return (
    p.xPct >= IMAGE_PCT_BOUND_MIN_VNEXT &&
    p.xPct <= IMAGE_PCT_BOUND_MAX_VNEXT &&
    p.yPct >= IMAGE_PCT_BOUND_MIN_VNEXT &&
    p.yPct <= IMAGE_PCT_BOUND_MAX_VNEXT
  );
}

// ---- Fatal checks ---------------------------------------------------------

function checkDuplicateIds(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const errors: FatalErrorGeometryVNext[] = [];
  const push = (code: FatalErrorCodeGeometryVNext, ids: string[], label: string) => {
    if (ids.length) {
      errors.push({ code, message: `Duplicate ${label} id(s): ${ids.join(", ")}`, relatedIds: ids });
    }
  };
  push("DUPLICATE_VERTEX_ID", findDuplicates(topology.vertices.map((v) => v.id)), "vertex");
  push("DUPLICATE_EDGE_ID", findDuplicates(topology.edges.map((e) => e.id)), "edge");
  push("DUPLICATE_REGION_ID", findDuplicates(topology.roomRegions.map((r) => r.id)), "room region");
  push("DUPLICATE_OPENING_ID", findDuplicates(topology.openings.map((o) => o.id)), "opening");
  push("DUPLICATE_STAIRS_ID", findDuplicates(topology.stairs.map((s) => s.id)), "stairs");
  push("DUPLICATE_FEATURE_ID", findDuplicates(topology.exteriorFeatures.map((f) => f.id)), "exterior feature");
  return errors;
}

function checkEdgeVertexReferences(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const errors: FatalErrorGeometryVNext[] = [];
  for (const e of topology.edges) {
    const missing: string[] = [];
    if (!vertexIds.has(e.fromVertexId)) missing.push(e.fromVertexId);
    if (!vertexIds.has(e.toVertexId)) missing.push(e.toVertexId);
    if (missing.length) {
      errors.push({
        code: "EDGE_REFERENCES_UNKNOWN_VERTEX",
        message: `Edge ${e.id} references unknown vertex id(s): ${missing.join(", ")}`,
        relatedIds: [e.id, ...missing],
      });
    }
  }
  return errors;
}

function checkBoundaryVertexReferences(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const errors: FatalErrorGeometryVNext[] = [];
  for (const r of topology.roomRegions) {
    const missing = r.boundaryVertexIds.filter((id) => !vertexIds.has(id));
    if (missing.length) {
      errors.push({
        code: "REGION_REFERENCES_UNKNOWN_VERTEX",
        message: `Room region ${r.id} references unknown vertex id(s): ${missing.join(", ")}`,
        relatedIds: [r.id, ...missing],
      });
    }
  }
  for (const f of topology.exteriorFeatures) {
    const missing = f.wallBoundaryVertexPaths.flat().filter((id) => !vertexIds.has(id));
    if (missing.length) {
      errors.push({
        code: "FEATURE_REFERENCES_UNKNOWN_VERTEX",
        message: `Exterior feature ${f.id} references unknown vertex id(s): ${missing.join(", ")}`,
        relatedIds: [f.id, ...missing],
      });
    }
  }
  return errors;
}

function samePoint(a: ImagePctVNext, b: ImagePctVNext): boolean {
  return a.xPct === b.xPct && a.yPct === b.yPct;
}

function checkExteriorFeaturePaths(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const errors: FatalErrorGeometryVNext[] = [];
  for (const feature of topology.exteriorFeatures) {
    for (const path of feature.wallBoundaryVertexPaths) {
      if (path.length < 2) {
        errors.push({
          code: "FEATURE_WALL_PATH_TOO_SHORT",
          message: `Exterior feature ${feature.id} has a wall path with fewer than two vertex ids`,
          relatedIds: [feature.id],
        });
      }
    }
    for (const path of feature.visibleBoundaryPathsImagePct) {
      if (path.length < 2) {
        errors.push({
          code: "FEATURE_VISIBLE_PATH_TOO_SHORT",
          message: `Exterior feature ${feature.id} has a visible boundary path with fewer than two points`,
          relatedIds: [feature.id],
        });
      }
    }
    if (feature.boundaryCompletenessHint === "complete_visible") {
      const explicitWallClosures = feature.wallBoundaryVertexPaths.map(
        (path) => path.length >= 2 && path[0] === path[path.length - 1],
      );
      const explicitVisibleClosures = feature.visibleBoundaryPathsImagePct.map(
        (path) => path.length >= 2 && samePoint(path[0], path[path.length - 1]),
      );
      const closures = [...explicitWallClosures, ...explicitVisibleClosures];
      if (closures.length === 0 || closures.some((closed) => !closed)) {
        errors.push({
          code: "FEATURE_COMPLETE_BOUNDARY_NOT_EXPLICITLY_CLOSED",
          message:
            `Exterior feature ${feature.id} claims complete_visible without every visible path ` +
            `explicitly repeating its first point at the end`,
          relatedIds: [feature.id],
        });
      }
    }
  }
  return errors;
}

function checkPerceptionNoteReferences(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const edgeIds = new Set(topology.edges.map((e) => e.id));
  const regionIds = new Set(topology.roomRegions.map((r) => r.id));
  const errors: FatalErrorGeometryVNext[] = [];
  for (const [index, note] of (topology.perceptionNotes ?? []).entries()) {
    const missing = [
      note.vertexId !== null && !vertexIds.has(note.vertexId) ? note.vertexId : null,
      note.edgeId !== null && !edgeIds.has(note.edgeId) ? note.edgeId : null,
      note.regionId !== null && !regionIds.has(note.regionId) ? note.regionId : null,
    ].filter((id): id is string => id !== null);
    if (missing.length) {
      errors.push({
        code: "NOTE_REFERENCES_UNKNOWN_ENTITY",
        message: `Perception note ${index} references unknown entity id(s): ${missing.join(", ")}`,
        relatedIds: missing,
      });
    }
  }
  return errors;
}

function checkEvidenceStates(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const allowed = new Set(["OBSERVED", "INFERRED", "UNKNOWN"]);
  const entities: Array<{ id: string; evidenceState: string }> = [
    ...topology.vertices,
    ...topology.edges,
    ...topology.roomRegions,
    ...topology.openings,
    ...topology.stairs,
    ...topology.exteriorFeatures,
  ];
  const invalid = entities.filter((entity) => !allowed.has(entity.evidenceState)).map((entity) => entity.id);
  const invalidNotes = (topology.perceptionNotes ?? [])
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => !allowed.has(note.evidenceState))
    .map(({ index }) => `perceptionNote:${index}`);
  const ids = [...invalid, ...invalidNotes];
  return ids.length
    ? [{ code: "INVALID_EVIDENCE_STATE", message: `Invalid evidenceState on: ${ids.join(", ")}`, relatedIds: ids }]
    : [];
}

function checkNumericHints(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const errors: FatalErrorGeometryVNext[] = [];
  for (const opening of topology.openings) {
    const position = opening.positionAlongEdgePctHint;
    if (position !== null && (!Number.isFinite(position) || position < 0 || position > 100)) {
      errors.push({
        code: "POSITION_ALONG_EDGE_OUT_OF_RANGE",
        message: `Opening ${opening.id} positionAlongEdgePctHint must be within [0,100]`,
        relatedIds: [opening.id],
      });
    }
  }
  for (const stairs of topology.stairs) {
    const direction = stairs.directionHint;
    if (direction !== null && (!Number.isFinite(direction) || direction < 0 || direction >= 360)) {
      errors.push({
        code: "INVALID_DIRECTION_HINT",
        message: `Stairs ${stairs.id} directionHint must be within [0,360)`,
        relatedIds: [stairs.id],
      });
    }
  }
  return errors;
}

function collectAllCoordinates(
  topology: GeometryObservationVNext,
): Array<{ label: string; point: ImagePctVNext }> {
  const out: Array<{ label: string; point: ImagePctVNext }> = [];
  for (const v of topology.vertices) out.push({ label: `vertex ${v.id}`, point: v.imagePct });
  for (const o of topology.openings) out.push({ label: `opening ${o.id} anchor`, point: o.anchorImagePct });
  for (const s of topology.stairs) out.push({ label: `stairs ${s.id} anchor`, point: s.anchorImagePct });
  for (const f of topology.exteriorFeatures) {
    if (f.anchorImagePct) out.push({ label: `exterior feature ${f.id} anchor`, point: f.anchorImagePct });
    f.visibleBoundaryPathsImagePct.forEach((path, pathIndex) => {
      path.forEach((point, pointIndex) => {
        out.push({ label: `exterior feature ${f.id} path ${pathIndex} point ${pointIndex}`, point });
      });
    });
  }
  for (const r of topology.roomRegions) {
    if (r.nearestLabelHint) out.push({ label: `room region ${r.id} nearestLabelHint`, point: r.nearestLabelHint });
  }
  return out;
}

function checkFiniteCoordinates(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const errors: FatalErrorGeometryVNext[] = [];
  for (const { label, point } of collectAllCoordinates(topology)) {
    if (!isFiniteCoordinate(point)) {
      errors.push({
        code: "MALFORMED_COORDINATE",
        message: `${label} has non-finite coordinate (xPct=${point?.xPct}, yPct=${point?.yPct})`,
        relatedIds: [],
      });
    }
  }
  return errors;
}

function checkCoordinateRanges(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const errors: FatalErrorGeometryVNext[] = [];
  for (const { label, point } of collectAllCoordinates(topology)) {
    if (isFiniteCoordinate(point) && !isInRangeCoordinate(point)) {
      errors.push({
        code: "OUT_OF_RANGE_COORDINATE",
        message:
          `${label} is outside the tolerated image-percentage bound ` +
          `[${IMAGE_PCT_BOUND_MIN_VNEXT}, ${IMAGE_PCT_BOUND_MAX_VNEXT}] (xPct=${point.xPct}, yPct=${point.yPct})`,
        relatedIds: [],
      });
    }
  }
  return errors;
}

function checkNoZeroLengthEdges(topology: GeometryObservationVNext): FatalErrorGeometryVNext[] {
  const vmap = indexVertices(topology.vertices);
  const errors: FatalErrorGeometryVNext[] = [];
  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue; // already reported by checkEdgeVertexReferences
    if (!isFiniteCoordinate(from.imagePct) || !isFiniteCoordinate(to.imagePct)) continue; // already reported
    const length = dist(from.imagePct, to.imagePct);
    if (length < ZERO_LENGTH_EPSILON_PCT_GEOMETRY_VNEXT) {
      errors.push({
        code: "ZERO_LENGTH_EDGE",
        message: `Edge ${e.id} has near-zero image-space length (${length.toFixed(4)} pct)`,
        relatedIds: [e.id],
      });
    }
  }
  return errors;
}

// ---- Diagnostics (never fatal) ---------------------------------------------

export function computeConnectedComponents(topology: GeometryObservationVNext): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const v of topology.vertices) parent.set(v.id, v.id);
  for (const e of topology.edges) {
    if (parent.has(e.fromVertexId) && parent.has(e.toVertexId)) union(e.fromVertexId, e.toVertexId);
  }
  const groups = new Map<string, string[]>();
  for (const v of topology.vertices) {
    const root = find(v.id);
    const arr = groups.get(root) ?? [];
    arr.push(v.id);
    groups.set(root, arr);
  }
  return [...groups.values()];
}

function checkConnectedComponents(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const components = computeConnectedComponents(topology);
  if (components.length <= 1) return [];
  return [
    {
      code: "MULTIPLE_CONNECTED_COMPONENTS",
      message: `Graph has ${components.length} disconnected components (allowed — descriptive only)`,
      relatedIds: components.map((c) => c.join("+")),
    },
  ];
}

function checkOpenGraphEndpoints(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const degree = new Map<string, number>();
  for (const v of topology.vertices) degree.set(v.id, 0);
  for (const e of topology.edges) {
    if (degree.has(e.fromVertexId)) degree.set(e.fromVertexId, (degree.get(e.fromVertexId) ?? 0) + 1);
    if (degree.has(e.toVertexId)) degree.set(e.toVertexId, (degree.get(e.toVertexId) ?? 0) + 1);
  }
  const openEndpoints = [...degree.entries()].filter(([, d]) => d === 1).map(([id]) => id);
  if (openEndpoints.length === 0) return [];
  return [
    {
      code: "OPEN_GRAPH_ENDPOINTS",
      message: `Vertex/vertices with exactly one connected edge (allowed): ${openEndpoints.join(", ")}`,
      relatedIds: openEndpoints,
    },
  ];
}

function checkAxisHintCompatibility(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const vmap = indexVertices(topology.vertices);
  const diagnostics: DiagnosticGeometryVNext[] = [];
  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to || !isFiniteCoordinate(from.imagePct) || !isFiniteCoordinate(to.imagePct)) continue;
    const dx = Math.abs(to.imagePct.xPct - from.imagePct.xPct);
    const dy = Math.abs(to.imagePct.yPct - from.imagePct.yPct);
    if (e.axisHint === "horizontal" && dy > AXIS_HINT_TOLERANCE_PCT_GEOMETRY_VNEXT) {
      diagnostics.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} hinted "horizontal" but differs by ${dy.toFixed(2)} pct vertically (non-fatal)`,
        relatedIds: [e.id],
      });
    }
    if (e.axisHint === "vertical" && dx > AXIS_HINT_TOLERANCE_PCT_GEOMETRY_VNEXT) {
      diagnostics.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} hinted "vertical" but differs by ${dx.toFixed(2)} pct horizontally (non-fatal)`,
        relatedIds: [e.id],
      });
    }
  }
  return diagnostics;
}

function checkUncertainHints(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const ids: string[] = [
    ...topology.vertices.filter((v) => v.cornerAngleHint === "uncertain" || v.cornerAngleHint === null).map((v) => v.id),
    ...topology.edges.filter((e) => e.roleHint === "uncertain" || e.axisHint === "diagonal_or_unknown").map((e) => e.id),
    ...topology.openings.filter((o) => o.typeHint === "uncertain" || o.swingHint === "uncertain" || o.swingHint === null).map((o) => o.id),
    ...topology.roomRegions.filter((r) => r.roleHint === "uncertain").map((r) => r.id),
    ...topology.stairs.filter((s) => s.typeHint === "uncertain" || s.contextHint === "uncertain").map((s) => s.id),
    ...topology.exteriorFeatures
      .filter(
        (f) =>
          f.typeHint === "uncertain" ||
          f.boundaryCompletenessHint === "unknown" ||
          f.enclosureHint === "unknown",
      )
      .map((f) => f.id),
  ];
  if (ids.length === 0) return [];
  return [
    {
      code: "UNCERTAIN_HINT_PRESENT",
      message: `Uncertain hints present in perception evidence (descriptive only): [${ids.join(", ")}]`,
      relatedIds: ids,
    },
  ];
}

function checkDanglingOpeningEdgeHints(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const edgeIds = new Set(topology.edges.map((e) => e.id));
  const dangling = topology.openings
    .filter((o) => o.onEdgeIdHint !== null && !edgeIds.has(o.onEdgeIdHint))
    .map((o) => o.id);
  if (dangling.length === 0) return [];
  return [
    {
      code: "DANGLING_OPENING_EDGE_HINT",
      message:
        `Opening(s) with an onEdgeIdHint that does not match any edge id — a hint failing to ` +
        `resolve is expected and non-fatal, never proof: [${dangling.join(", ")}]`,
      relatedIds: dangling,
    },
  ];
}

function checkRegionsWithFewVertices(topology: GeometryObservationVNext): DiagnosticGeometryVNext[] {
  const thin = topology.roomRegions.filter((r) => r.boundaryVertexIds.length < 3).map((r) => r.id);
  if (thin.length === 0) return [];
  return [
    {
      code: "REGION_WITH_FEWER_THAN_THREE_VERTICES",
      message: `Room region(s) with fewer than 3 boundary vertices (not a closed area): [${thin.join(", ")}]`,
      relatedIds: thin,
    },
  ];
}

// ---- Orchestrator ---------------------------------------------------------

export function validateGeometryObservationVNext(
  topology: GeometryObservationVNext,
): ValidationResultGeometryVNext {
  const errors: FatalErrorGeometryVNext[] = [
    ...checkDuplicateIds(topology),
    ...checkEdgeVertexReferences(topology),
    ...checkBoundaryVertexReferences(topology),
    ...checkExteriorFeaturePaths(topology),
    ...checkPerceptionNoteReferences(topology),
    ...checkEvidenceStates(topology),
    ...checkNumericHints(topology),
    ...checkFiniteCoordinates(topology),
  ];

  const hasReferentialOrCoordinateErrors = errors.length > 0;
  if (hasReferentialOrCoordinateErrors) {
    // Same discipline as envelope_topology_validators_v2.ts: skip
    // geometry-dependent checks (range, zero-length, diagnostics) rather
    // than compute them against a graph that already failed structurally.
    return { valid: false, errors, diagnostics: [] };
  }

  errors.push(...checkCoordinateRanges(topology));
  errors.push(...checkNoZeroLengthEdges(topology));

  if (errors.length > 0) {
    return { valid: false, errors, diagnostics: [] };
  }

  const diagnostics: DiagnosticGeometryVNext[] = [
    ...checkConnectedComponents(topology),
    ...checkOpenGraphEndpoints(topology),
    ...checkAxisHintCompatibility(topology),
    ...checkUncertainHints(topology),
    ...checkDanglingOpeningEdgeHints(topology),
    ...checkRegionsWithFewVertices(topology),
  ];

  return { valid: errors.length === 0, errors, diagnostics };
}

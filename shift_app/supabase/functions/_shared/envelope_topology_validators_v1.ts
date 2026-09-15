// _shared/envelope_topology_validators_v1.ts
//
// Pure, side-effect-free validators for EnvelopeTopologyV1. No AI calls, no
// I/O, no metrics — geometry-and-graph checks against image-space percentages
// only. This is code, same discipline as dimension_chain_builder_v3.ts:
// deterministic, unit-testable, no hidden state.
//
// Phase 1 scope: these validators run against the AI's raw topology output
// BEFORE anything is persisted as the envelope_topology artifact, and before
// Phase 2 (witness promotion) ever sees the data. If validation fails, the
// artifact is written with status:"invalid" and the errors — never silently
// "fixed" or passed through.

import type {
  EnvelopeTopologyV1,
  EnvelopeTopologyVertexV1,
  EnvelopeTopologyEdgeV1,
  EdgeAxisHint,
} from "./envelope_topology_schema_v1.ts";

export type ValidationErrorCode =
  | "DUPLICATE_VERTEX_ID"
  | "DUPLICATE_EDGE_ID"
  | "EDGE_REFERENCES_UNKNOWN_VERTEX"
  | "POLYGON_ORDER_MISMATCH"
  | "POLYGON_ORDER_DUPLICATE"
  | "POLYGON_ORDER_MISSING_VERTEX"
  | "NOT_SINGLE_CLOSED_CYCLE"
  | "ZERO_LENGTH_EDGE"
  | "AXIS_HINT_MISMATCH"
  | "DUPLICATE_CONSECUTIVE_VERTEX"
  | "SELF_INTERSECTION";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  relatedIds: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---- Tolerances --------------------------------------------------------
// Percent-of-page units throughout, consistent with the rest of the
// pipeline's *_TOLERANCE_PCT constants (dimension_chain_builder_v3.ts etc).

export const ZERO_LENGTH_EPSILON_PCT = 0.05;
// An edge shorter than this (in image-space pct distance) is treated as a
// degenerate/zero-length edge, not a real wall segment.

export const AXIS_HINT_TOLERANCE_PCT = 3;
// For axisHint:"horizontal", the perpendicular (y) deviation between the two
// endpoints must be <= this many pct points relative to the edge's own
// dominant-axis span; symmetric rule for "vertical" on x. Mirrors
// ANCHOR_TOLERANCE_PCT / EDGE_TOLERANCE_PCT elsewhere in the pipeline.

export const DUPLICATE_CONSECUTIVE_VERTEX_EPSILON_PCT = 0.02;
// Two consecutive polygonOrder vertices whose imagePct distance is below
// this are treated as an accidental duplicate, not a real (near-)zero edge.

// ---- Helpers ------------------------------------------------------------

function dist(a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }): number {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function indexVertices(vertices: EnvelopeTopologyVertexV1[]): Map<string, EnvelopeTopologyVertexV1> {
  const map = new Map<string, EnvelopeTopologyVertexV1>();
  for (const v of vertices) map.set(v.id, v);
  return map;
}

// Segment intersection test (excluding shared endpoints), used only for
// non-adjacent edges. Standard orientation-based test.
function orientation(
  p: { xPct: number; yPct: number },
  q: { xPct: number; yPct: number },
  r: { xPct: number; yPct: number },
): number {
  const val = (q.yPct - p.yPct) * (r.xPct - q.xPct) - (q.xPct - p.xPct) * (r.yPct - q.yPct);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(
  p: { xPct: number; yPct: number },
  q: { xPct: number; yPct: number },
  r: { xPct: number; yPct: number },
): boolean {
  return (
    Math.min(p.xPct, r.xPct) - 1e-9 <= q.xPct &&
    q.xPct <= Math.max(p.xPct, r.xPct) + 1e-9 &&
    Math.min(p.yPct, r.yPct) - 1e-9 <= q.yPct &&
    q.yPct <= Math.max(p.yPct, r.yPct) + 1e-9
  );
}

function segmentsIntersect(
  p1: { xPct: number; yPct: number },
  q1: { xPct: number; yPct: number },
  p2: { xPct: number; yPct: number },
  q2: { xPct: number; yPct: number },
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

// ---- Individual checks ---------------------------------------------------

function checkUniqueVertexIds(topology: EnvelopeTopologyV1): ValidationError[] {
  const seen = new Map<string, number>();
  for (const v of topology.vertices) seen.set(v.id, (seen.get(v.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return dups.length
    ? [
        {
          code: "DUPLICATE_VERTEX_ID",
          message: `Duplicate vertex id(s): ${dups.join(", ")}`,
          relatedIds: dups,
        },
      ]
    : [];
}

function checkUniqueEdgeIds(topology: EnvelopeTopologyV1): ValidationError[] {
  const seen = new Map<string, number>();
  for (const e of topology.edges) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return dups.length
    ? [
        {
          code: "DUPLICATE_EDGE_ID",
          message: `Duplicate edge id(s): ${dups.join(", ")}`,
          relatedIds: dups,
        },
      ]
    : [];
}

function checkEdgeVertexReferences(topology: EnvelopeTopologyV1): ValidationError[] {
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const errors: ValidationError[] = [];
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

function checkPolygonOrder(topology: EnvelopeTopologyV1): ValidationError[] {
  const errors: ValidationError[] = [];
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const order = topology.polygonOrder;

  const unknown = order.filter((id) => !vertexIds.has(id));
  if (unknown.length) {
    errors.push({
      code: "POLYGON_ORDER_MISMATCH",
      message: `polygonOrder references unknown vertex id(s): ${unknown.join(", ")}`,
      relatedIds: unknown,
    });
  }

  const seen = new Map<string, number>();
  for (const id of order) seen.set(id, (seen.get(id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  if (dups.length) {
    errors.push({
      code: "POLYGON_ORDER_DUPLICATE",
      message: `polygonOrder contains duplicate vertex id(s): ${dups.join(", ")}`,
      relatedIds: dups,
    });
  }

  const missing = [...vertexIds].filter((id) => !seen.has(id));
  if (missing.length) {
    errors.push({
      code: "POLYGON_ORDER_MISSING_VERTEX",
      message: `polygonOrder is missing vertex id(s) declared in vertices[]: ${missing.join(", ")}`,
      relatedIds: missing,
    });
  }

  return errors;
}

/**
 * Verifies the edge set forms exactly one closed connected cycle whose
 * traversal order matches polygonOrder — not merely "some cycle exists
 * somewhere in the edge set". Each consecutive pair in polygonOrder
 * (including wraparound) must be connected by exactly one edge (in either
 * direction), and every edge must be used exactly once by that traversal.
 */
function checkSingleClosedCycle(topology: EnvelopeTopologyV1): ValidationError[] {
  const order = topology.polygonOrder;
  if (order.length < 3) {
    return [
      {
        code: "NOT_SINGLE_CLOSED_CYCLE",
        message: `polygonOrder has fewer than 3 vertices (${order.length})`,
        relatedIds: order,
      },
    ];
  }

  // Build undirected adjacency: pair key -> edge id(s)
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeByPair = new Map<string, string[]>();
  for (const e of topology.edges) {
    const key = pairKey(e.fromVertexId, e.toVertexId);
    const arr = edgeByPair.get(key) ?? [];
    arr.push(e.id);
    edgeByPair.set(key, arr);
  }

  const errors: ValidationError[] = [];
  const usedEdgeIds = new Set<string>();
  const missingConsecutivePairs: string[] = [];

  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    const b = order[(i + 1) % order.length];
    const key = pairKey(a, b);
    const edgeIds = edgeByPair.get(key);
    if (!edgeIds || edgeIds.length === 0) {
      missingConsecutivePairs.push(`${a}->${b}`);
      continue;
    }
    // If multiple edges connect the same pair, that's ambiguous topology —
    // flag it rather than silently picking one.
    if (edgeIds.length > 1) {
      errors.push({
        code: "NOT_SINGLE_CLOSED_CYCLE",
        message: `Multiple edges connect ${a} and ${b}: ${edgeIds.join(", ")} — ambiguous cycle`,
        relatedIds: edgeIds,
      });
    }
    edgeIds.forEach((id) => usedEdgeIds.add(id));
  }

  if (missingConsecutivePairs.length) {
    errors.push({
      code: "NOT_SINGLE_CLOSED_CYCLE",
      message: `No edge connects consecutive polygonOrder pair(s): ${missingConsecutivePairs.join(", ")}`,
      relatedIds: missingConsecutivePairs,
    });
  }

  const unusedEdges = topology.edges.filter((e) => !usedEdgeIds.has(e.id));
  if (unusedEdges.length) {
    errors.push({
      code: "NOT_SINGLE_CLOSED_CYCLE",
      message: `Edge(s) not part of the polygonOrder cycle (disconnected/extraneous): ${unusedEdges
        .map((e) => e.id)
        .join(", ")}`,
      relatedIds: unusedEdges.map((e) => e.id),
    });
  }

  return errors;
}

function checkNoZeroLengthEdges(topology: EnvelopeTopologyV1): ValidationError[] {
  const vmap = indexVertices(topology.vertices);
  const errors: ValidationError[] = [];
  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue; // already reported by checkEdgeVertexReferences
    const length = dist(from.imagePct, to.imagePct);
    if (length < ZERO_LENGTH_EPSILON_PCT) {
      errors.push({
        code: "ZERO_LENGTH_EDGE",
        message: `Edge ${e.id} has near-zero image-space length (${length.toFixed(4)} pct)`,
        relatedIds: [e.id],
      });
    }
  }
  return errors;
}

function checkAxisHintCompatibility(topology: EnvelopeTopologyV1): ValidationError[] {
  const vmap = indexVertices(topology.vertices);
  const errors: ValidationError[] = [];

  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue;

    const dx = Math.abs(to.imagePct.xPct - from.imagePct.xPct);
    const dy = Math.abs(to.imagePct.yPct - from.imagePct.yPct);

    if (e.axisHint === "horizontal" && dy > AXIS_HINT_TOLERANCE_PCT) {
      errors.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} is hinted "horizontal" but endpoints differ by ${dy.toFixed(
          2,
        )} pct vertically (tolerance ${AXIS_HINT_TOLERANCE_PCT})`,
        relatedIds: [e.id],
      });
    }
    if (e.axisHint === "vertical" && dx > AXIS_HINT_TOLERANCE_PCT) {
      errors.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} is hinted "vertical" but endpoints differ by ${dx.toFixed(
          2,
        )} pct horizontally (tolerance ${AXIS_HINT_TOLERANCE_PCT})`,
        relatedIds: [e.id],
      });
    }
    // diagonal_or_unknown: no compatibility check by definition.
  }

  return errors;
}

function checkNoDuplicateConsecutiveVertices(topology: EnvelopeTopologyV1): ValidationError[] {
  const vmap = indexVertices(topology.vertices);
  const order = topology.polygonOrder;
  const errors: ValidationError[] = [];

  for (let i = 0; i < order.length; i++) {
    const aId = order[i];
    const bId = order[(i + 1) % order.length];
    if (aId === bId) {
      errors.push({
        code: "DUPLICATE_CONSECUTIVE_VERTEX",
        message: `polygonOrder has the same vertex id twice in a row: ${aId}`,
        relatedIds: [aId],
      });
      continue;
    }
    const a = vmap.get(aId);
    const b = vmap.get(bId);
    if (!a || !b) continue;
    if (dist(a.imagePct, b.imagePct) < DUPLICATE_CONSECUTIVE_VERTEX_EPSILON_PCT) {
      errors.push({
        code: "DUPLICATE_CONSECUTIVE_VERTEX",
        message: `Consecutive vertices ${aId} and ${bId} are coincident in image space (distance < ${DUPLICATE_CONSECUTIVE_VERTEX_EPSILON_PCT} pct)`,
        relatedIds: [aId, bId],
      });
    }
  }

  return errors;
}

/**
 * Deterministic self-intersection test: checks every pair of non-adjacent
 * edges in the polygonOrder cycle for a crossing. This is only meaningful
 * once the edge set has already passed checkSingleClosedCycle — if the cycle
 * itself is malformed, self-intersection results would be misleading, so
 * this check is skipped in that case by the orchestrator below.
 */
function checkSelfIntersection(topology: EnvelopeTopologyV1): ValidationError[] {
  const vmap = indexVertices(topology.vertices);
  const order = topology.polygonOrder;
  const n = order.length;
  const errors: ValidationError[] = [];

  const segments: { a: { xPct: number; yPct: number }; b: { xPct: number; yPct: number }; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = vmap.get(order[i]);
    const b = vmap.get(order[(i + 1) % n]);
    if (!a || !b) return []; // referential errors already reported elsewhere
    segments.push({ a: a.imagePct, b: b.imagePct, i });
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue; // adjacent edges legitimately share an endpoint
      const s1 = segments[i];
      const s2 = segments[j];
      if (segmentsIntersect(s1.a, s1.b, s2.a, s2.b)) {
        errors.push({
          code: "SELF_INTERSECTION",
          message: `Polygon edges at positions ${i} (${order[i]}->${order[(i + 1) % n]}) and ${j} (${
            order[j]
          }->${order[(j + 1) % n]}) intersect in image space`,
          relatedIds: [order[i], order[(i + 1) % n], order[j], order[(j + 1) % n]],
        });
      }
    }
  }

  return errors;
}

// ---- Orchestrator ---------------------------------------------------------

export function validateEnvelopeTopologyV1(topology: EnvelopeTopologyV1): ValidationResult {
  const errors: ValidationError[] = [
    ...checkUniqueVertexIds(topology),
    ...checkUniqueEdgeIds(topology),
    ...checkEdgeVertexReferences(topology),
    ...checkPolygonOrder(topology),
  ];

  // The cycle check assumes vertex/edge referential integrity. If that's
  // already broken, skip cycle + downstream geometric checks rather than
  // produce noisy, misleading secondary errors.
  const hasReferentialErrors = errors.some(
    (e) =>
      e.code === "DUPLICATE_VERTEX_ID" ||
      e.code === "DUPLICATE_EDGE_ID" ||
      e.code === "EDGE_REFERENCES_UNKNOWN_VERTEX" ||
      e.code === "POLYGON_ORDER_MISMATCH" ||
      e.code === "POLYGON_ORDER_MISSING_VERTEX",
  );

  if (hasReferentialErrors) {
    return { valid: false, errors };
  }

  errors.push(...checkSingleClosedCycle(topology));
  errors.push(...checkNoZeroLengthEdges(topology));
  errors.push(...checkAxisHintCompatibility(topology));
  errors.push(...checkNoDuplicateConsecutiveVertices(topology));

  const cycleOk = !errors.some((e) => e.code === "NOT_SINGLE_CLOSED_CYCLE");
  if (cycleOk) {
    errors.push(...checkSelfIntersection(topology));
  }

  return { valid: errors.length === 0, errors };
}

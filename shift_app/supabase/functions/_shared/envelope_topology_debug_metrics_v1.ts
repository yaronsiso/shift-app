// _shared/envelope_topology_debug_metrics_v1.ts
//
// NON-BLOCKING debug metrics for EnvelopeTopologyV1 — deliberately separate
// from envelope_topology_validators_v1.ts, which stays untouched. Nothing
// in this file participates in validation.valid or gates anything. It
// exists because "structurally valid" and "visually correct" are different
// questions — session 24's first real run produced an 11-vertex polygon
// that passed every structural validator (closed cycle, no self-
// intersection, axis-hint compatibility, etc.) while still bridging over
// real jogs/recesses in the actual building outline. A structural pass
// cannot catch that; only a human comparing against the source image can.
//
// These metrics don't try to guess the "right" vertex count either — there
// is no target number here, on purpose (a hardcoded expected count would
// just be last run's answer encoded as a rule, biasing every future
// drawing toward whatever shape happened to run first). What they DO give
// a human reviewer is a quick, honest signal for "does this look like it
// might have over-simplified the boundary" — worth a glance before trusting
// the topology, not a verdict.

import type { EnvelopeTopologyV1 } from "./envelope_topology_schema_v1.ts";

export interface EdgeLengthStats {
  minPct: number;
  maxPct: number;
  meanPct: number;
}

export interface TopologyCoverageDebug {
  vertexCount: number;
  edgeCount: number;
  perimeterPct: number;
  polygonAreaPct2: number;
  boundingBoxAreaPct2: number;
  // 1.0 = the polygon exactly fills its own bounding box (i.e. it IS a
  // rectangle). Lower values mean the shape has real notches/jogs relative
  // to its own bounding box. This is informational only — a value close to
  // 1.0 is worth a manual look (it may mean the boundary got simplified
  // toward a bounding silhouette), but it is not proof of anything on its
  // own: a genuinely rectangular building would also score close to 1.0.
  boundingBoxFillRatio: number;
  edgeLengthStats: EdgeLengthStats;
  longestEdgeId: string;
  longestEdgePct: number;
  // What fraction of the total perimeter the single longest edge accounts
  // for. A high share (e.g. one edge is 60%+ of the whole perimeter) is
  // another "worth a look" signal — long unbroken runs are exactly where a
  // bridged-over jog or recess tends to hide — but again not a verdict by
  // itself; a genuinely long straight wall is also a high share.
  longestEdgeShareOfPerimeter: number;
}

function dist(a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }): number {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

/**
 * Pure function: image-space geometry in, descriptive metrics out. No I/O,
 * no AI calls, no assertions about correctness — same discipline as the
 * validators module, just explicitly non-judgmental about the result.
 */
export function computeTopologyCoverageDebug(topology: EnvelopeTopologyV1): TopologyCoverageDebug {
  const vmap = new Map(topology.vertices.map((v) => [v.id, v.imagePct]));

  const edgeLengths: { id: string; lengthPct: number }[] = [];
  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue; // malformed refs are the validators' job to report, not this one's
    edgeLengths.push({ id: e.id, lengthPct: dist(from, to) });
  }

  const perimeterPct = edgeLengths.reduce((sum, e) => sum + e.lengthPct, 0);
  const lengths = edgeLengths.map((e) => e.lengthPct);
  const minPct = lengths.length ? Math.min(...lengths) : 0;
  const maxPct = lengths.length ? Math.max(...lengths) : 0;
  const meanPct = lengths.length ? perimeterPct / lengths.length : 0;

  const longest = edgeLengths.reduce(
    (best, e) => (e.lengthPct > best.lengthPct ? e : best),
    { id: "", lengthPct: 0 },
  );

  // Shoelace formula for polygon area, following polygonOrder (not
  // topology.vertices' raw array order — the traversal order is what
  // actually defines the enclosed area).
  const orderedPts = topology.polygonOrder
    .map((id) => vmap.get(id))
    .filter((p): p is { xPct: number; yPct: number } => p !== undefined);

  let shoelaceSum = 0;
  for (let i = 0; i < orderedPts.length; i++) {
    const a = orderedPts[i];
    const b = orderedPts[(i + 1) % orderedPts.length];
    shoelaceSum += a.xPct * b.yPct - b.xPct * a.yPct;
  }
  const polygonAreaPct2 = Math.abs(shoelaceSum) / 2;

  const xs = orderedPts.map((p) => p.xPct);
  const ys = orderedPts.map((p) => p.yPct);
  const bboxAreaPct2 =
    xs.length && ys.length ? (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) : 0;

  return {
    vertexCount: topology.vertices.length,
    edgeCount: topology.edges.length,
    perimeterPct: round2(perimeterPct),
    polygonAreaPct2: round2(polygonAreaPct2),
    boundingBoxAreaPct2: round2(bboxAreaPct2),
    boundingBoxFillRatio: bboxAreaPct2 > 0 ? round4(polygonAreaPct2 / bboxAreaPct2) : 0,
    edgeLengthStats: { minPct: round2(minPct), maxPct: round2(maxPct), meanPct: round2(meanPct) },
    longestEdgeId: longest.id,
    longestEdgePct: round2(longest.lengthPct),
    longestEdgeShareOfPerimeter: perimeterPct > 0 ? round4(longest.lengthPct / perimeterPct) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

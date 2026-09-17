// _shared/envelope_topology_validators_v2.ts
//
// Pure, side-effect-free validators for EnvelopeTopologyV2. No AI calls, no
// I/O — geometry-and-graph checks against image-space percentages only.
// Kept as an independent copy of helpers from
// envelope_topology_validators_v1.ts (dist/indexVertices logic) rather than
// a shared import, for the same reason as the schema file: V1 and V2 must
// never share a code path that could let a future edit to one silently
// affect the other.
//
// ARCHITECTURAL SPLIT (locked this session, do not blur):
//   - FATAL errors gate `valid`. They are STRUCTURAL CORRUPTION only:
//     duplicate ids, dangling references, non-finite coordinates, and
//     truly degenerate (zero/near-zero) edges. Never semantic.
//   - DIAGNOSTICS never gate `valid`. They describe graph/geometry shape
//     only: multiple components, open endpoints, axis-hint disagreement,
//     uncertain hints already present in the data. They never decide
//     KEEP/REJECT, interior/exterior, dual-face, candidate/extraneous, or
//     gap/deferred status — those are Phase1C's job, not this file's.
//
// Explicitly, per the locked V2 design: "single closed cycle" is NEVER a
// structural (fatal) requirement here — NOT_SINGLE_CLOSED_CYCLE below is a
// diagnostic only, unlike V1's identically-named but FATAL check.
//
// Also explicitly NOT done here, matching V1's own actual behavior (checked
// against source at HEAD 3b83f10 — V1 has no imagePct bounds check either):
// no [0,100]-or-any-other bound is enforced on xPct/yPct. Only finiteness is
// checked. If a bound is ever justified for this contract, it should be
// added deliberately and separately, not invented here by inference.

import type {
  EnvelopeTopologyV2,
  EnvelopeTopologyVertexV2,
} from "./envelope_topology_schema_v2.ts";

export type FatalErrorCodeV2 =
  | "DUPLICATE_VERTEX_ID"
  | "DUPLICATE_EDGE_ID"
  | "EDGE_REFERENCES_UNKNOWN_VERTEX"
  | "MALFORMED_COORDINATE"
  | "ZERO_LENGTH_EDGE";

export type DiagnosticCodeV2 =
  | "MULTIPLE_CONNECTED_COMPONENTS"
  | "OPEN_GRAPH_ENDPOINTS"
  | "NOT_SINGLE_CLOSED_CYCLE"
  | "AXIS_HINT_MISMATCH"
  | "UNCERTAIN_HINT_PRESENT";

export interface FatalErrorV2 {
  code: FatalErrorCodeV2;
  message: string;
  relatedIds: string[];
}

export interface DiagnosticV2 {
  code: DiagnosticCodeV2;
  message: string;
  relatedIds: string[];
}

export interface ValidationResultV2 {
  valid: boolean;
  errors: FatalErrorV2[];
  diagnostics: DiagnosticV2[];
}

// ---- Tolerances --------------------------------------------------------
// Same constants/semantics as V1's own tolerances (kept as independent
// values, not imports, per the file-header no-shared-path rule).

export const ZERO_LENGTH_EPSILON_PCT_V2 = 0.05;
export const AXIS_HINT_TOLERANCE_PCT_V2 = 3;
// Diagnostic-only in V2 — an axis-hint/geometry mismatch NEVER invalidates
// here, unlike V1 where the identical tolerance is fatal. Do not change this
// value to "fix" a specific job; it is not gating anything in V2 regardless.

// ---- Helpers ------------------------------------------------------------

function dist(a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }): number {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function indexVertices(vertices: EnvelopeTopologyVertexV2[]): Map<string, EnvelopeTopologyVertexV2> {
  const map = new Map<string, EnvelopeTopologyVertexV2>();
  for (const v of vertices) map.set(v.id, v);
  return map;
}

// ---- Fatal checks ---------------------------------------------------------

function checkUniqueVertexIds(topology: EnvelopeTopologyV2): FatalErrorV2[] {
  const seen = new Map<string, number>();
  for (const v of topology.vertices) seen.set(v.id, (seen.get(v.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return dups.length
    ? [{ code: "DUPLICATE_VERTEX_ID", message: `Duplicate vertex id(s): ${dups.join(", ")}`, relatedIds: dups }]
    : [];
}

function checkUniqueEdgeIds(topology: EnvelopeTopologyV2): FatalErrorV2[] {
  const seen = new Map<string, number>();
  for (const e of topology.edges) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  return dups.length
    ? [{ code: "DUPLICATE_EDGE_ID", message: `Duplicate edge id(s): ${dups.join(", ")}`, relatedIds: dups }]
    : [];
}

function checkEdgeVertexReferences(topology: EnvelopeTopologyV2): FatalErrorV2[] {
  const vertexIds = new Set(topology.vertices.map((v) => v.id));
  const errors: FatalErrorV2[] = [];
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

function checkFiniteCoordinates(topology: EnvelopeTopologyV2): FatalErrorV2[] {
  const errors: FatalErrorV2[] = [];
  for (const v of topology.vertices) {
    if (!Number.isFinite(v.imagePct?.xPct) || !Number.isFinite(v.imagePct?.yPct)) {
      errors.push({
        code: "MALFORMED_COORDINATE",
        message: `Vertex ${v.id} has non-finite imagePct (xPct=${v.imagePct?.xPct}, yPct=${v.imagePct?.yPct})`,
        relatedIds: [v.id],
      });
    }
  }
  return errors;
}

function checkNoZeroLengthEdges(topology: EnvelopeTopologyV2): FatalErrorV2[] {
  const vmap = indexVertices(topology.vertices);
  const errors: FatalErrorV2[] = [];
  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue; // already reported by checkEdgeVertexReferences
    if (!Number.isFinite(from.imagePct?.xPct) || !Number.isFinite(to.imagePct?.xPct)) continue; // already reported
    const length = dist(from.imagePct, to.imagePct);
    if (length < ZERO_LENGTH_EPSILON_PCT_V2) {
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

function computeConnectedComponents(topology: EnvelopeTopologyV2): string[][] {
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
    if (parent.has(e.fromVertexId) && parent.has(e.toVertexId)) {
      union(e.fromVertexId, e.toVertexId);
    }
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

function checkConnectedComponents(topology: EnvelopeTopologyV2): DiagnosticV2[] {
  const components = computeConnectedComponents(topology);
  if (components.length <= 1) return [];
  return [
    {
      code: "MULTIPLE_CONNECTED_COMPONENTS",
      message: `Graph has ${components.length} disconnected components (allowed in V2 — this is descriptive only)`,
      relatedIds: components.map((c) => c.join("+")),
    },
  ];
}

function checkOpenGraphEndpoints(topology: EnvelopeTopologyV2): DiagnosticV2[] {
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
      message: `Vertex/vertices with exactly one connected edge (open chain endpoint, allowed in V2): ${openEndpoints.join(", ")}`,
      relatedIds: openEndpoints,
    },
  ];
}

function checkNotSingleClosedCycle(topology: EnvelopeTopologyV2): DiagnosticV2[] {
  // Purely graph-theoretic, non-fatal readout: does the edge set form
  // exactly one connected component where every vertex has degree exactly
  // 2 (i.e. could be traced as a single closed loop)? This makes no claim
  // about which loop is "the envelope" — that is Phase1C's job.
  const components = computeConnectedComponents(topology);
  const degree = new Map<string, number>();
  for (const v of topology.vertices) degree.set(v.id, 0);
  for (const e of topology.edges) {
    if (degree.has(e.fromVertexId)) degree.set(e.fromVertexId, (degree.get(e.fromVertexId) ?? 0) + 1);
    if (degree.has(e.toVertexId)) degree.set(e.toVertexId, (degree.get(e.toVertexId) ?? 0) + 1);
  }
  const allDegreeTwo = [...degree.values()].every((d) => d === 2);
  const isSingleClosedCycle = components.length === 1 && allDegreeTwo;
  if (isSingleClosedCycle) return [];
  return [
    {
      code: "NOT_SINGLE_CLOSED_CYCLE",
      message:
        "Graph does not form a single closed cycle (expected and allowed in V2 — RAW perception evidence may be open, disconnected, or contain extra candidate edges)",
      relatedIds: [],
    },
  ];
}

function checkAxisHintCompatibility(topology: EnvelopeTopologyV2): DiagnosticV2[] {
  const vmap = indexVertices(topology.vertices);
  const diagnostics: DiagnosticV2[] = [];

  for (const e of topology.edges) {
    const from = vmap.get(e.fromVertexId);
    const to = vmap.get(e.toVertexId);
    if (!from || !to) continue;
    if (!Number.isFinite(from.imagePct?.xPct) || !Number.isFinite(to.imagePct?.xPct)) continue;

    const dx = Math.abs(to.imagePct.xPct - from.imagePct.xPct);
    const dy = Math.abs(to.imagePct.yPct - from.imagePct.yPct);

    if (e.axisHint === "horizontal" && dy > AXIS_HINT_TOLERANCE_PCT_V2) {
      diagnostics.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} is hinted "horizontal" but endpoints differ by ${dy.toFixed(2)} pct vertically (tolerance ${AXIS_HINT_TOLERANCE_PCT_V2}, non-fatal in V2)`,
        relatedIds: [e.id],
      });
    }
    if (e.axisHint === "vertical" && dx > AXIS_HINT_TOLERANCE_PCT_V2) {
      diagnostics.push({
        code: "AXIS_HINT_MISMATCH",
        message: `Edge ${e.id} is hinted "vertical" but endpoints differ by ${dx.toFixed(2)} pct horizontally (tolerance ${AXIS_HINT_TOLERANCE_PCT_V2}, non-fatal in V2)`,
        relatedIds: [e.id],
      });
    }
    // diagonal_or_unknown: no compatibility check by definition, same as V1.
  }

  return diagnostics;
}

function checkUncertainHints(topology: EnvelopeTopologyV2): DiagnosticV2[] {
  // Purely a readout of explicit contract values already present in the
  // data (cornerAngleHint === "uncertain" | null, roleHint === "uncertain",
  // axisHint === "diagonal_or_unknown") — never an inference about what an
  // edge or vertex "really is".
  const uncertainVertexIds = topology.vertices
    .filter((v) => v.cornerAngleHint === "uncertain" || v.cornerAngleHint === null)
    .map((v) => v.id);
  const uncertainEdgeIds = topology.edges
    .filter((e) => e.roleHint === "uncertain" || e.axisHint === "diagonal_or_unknown")
    .map((e) => e.id);

  if (uncertainVertexIds.length === 0 && uncertainEdgeIds.length === 0) return [];

  return [
    {
      code: "UNCERTAIN_HINT_PRESENT",
      message:
        `Uncertain hints present in perception evidence (descriptive only): ` +
        `vertices=[${uncertainVertexIds.join(", ")}] edges=[${uncertainEdgeIds.join(", ")}]`,
      relatedIds: [...uncertainVertexIds, ...uncertainEdgeIds],
    },
  ];
}

// ---- Orchestrator ---------------------------------------------------------

export function validateEnvelopeTopologyV2(topology: EnvelopeTopologyV2): ValidationResultV2 {
  const errors: FatalErrorV2[] = [
    ...checkUniqueVertexIds(topology),
    ...checkUniqueEdgeIds(topology),
    ...checkEdgeVertexReferences(topology),
    ...checkFiniteCoordinates(topology),
  ];

  const hasReferentialErrors = errors.some(
    (e) =>
      e.code === "DUPLICATE_VERTEX_ID" ||
      e.code === "DUPLICATE_EDGE_ID" ||
      e.code === "EDGE_REFERENCES_UNKNOWN_VERTEX" ||
      e.code === "MALFORMED_COORDINATE",
  );

  if (hasReferentialErrors) {
    // Same discipline as V1: skip geometry-dependent checks (including the
    // zero-length-edge fatal check, which needs valid coordinates) rather
    // than produce noisy, misleading secondary errors. Diagnostics are also
    // skipped for the same reason — they'd be computed against a graph that
    // already failed referential integrity.
    return { valid: false, errors, diagnostics: [] };
  }

  errors.push(...checkNoZeroLengthEdges(topology));

  const diagnostics: DiagnosticV2[] = [
    ...checkConnectedComponents(topology),
    ...checkOpenGraphEndpoints(topology),
    ...checkNotSingleClosedCycle(topology),
    ...checkAxisHintCompatibility(topology),
    ...checkUncertainHints(topology),
  ];

  return { valid: errors.length === 0, errors, diagnostics };
}

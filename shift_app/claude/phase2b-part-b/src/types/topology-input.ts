// Read-only reconstruction of the Phase 1C-B CanonicalTopologyCandidate shape.
// This is NOT a new authority — it mirrors the already-delivered,
// user-verified Phase 1C-B package (phase1c-b-complete.zip). Phase 2 code
// in this package treats every type here as read-only input; nothing in
// src/ is permitted to construct or mutate a CanonicalTopologyCandidate.
//
// Only the fields Phase 2's deterministic infrastructure actually needs to
// read are reproduced (vertex/edge existence, ids). Fields specific to
// Phase 1C-B's own construction process (PLAN operations, AUDITED evidence,
// etc.) are intentionally omitted here — Phase 2 has no business touching
// them and must not depend on their shape.

export interface CanonicalVertex {
  readonly id: string;
  // Image-percent coordinate, 0-100, relative to cropped.jpg (the same
  // coordinate frame the closed VERIFIED_COMPATIBLE audit confirmed
  // PageDimensions' persisted geometry and EnvelopeTopologyV1 both share).
  // Read verbatim from Phase 1C-B's own CanonicalVertex.coordinate field
  // (construct.ts: `coordinate: { x: rv.xPct, y: rv.yPct }`) — never
  // recomputed, never invented. Present because Part B's AI call needs it
  // to relate canonical vertex ids to positions in the image it is shown;
  // Part A's own deterministic logic (anchor.ts/binding.ts/span.ts/
  // promotion.ts) never reads this field, confirmed by inspection — adding
  // it here does not change Part A's behavior in any way.
  readonly coordinate: { readonly x: number; readonly y: number };
}

export interface CanonicalEdge {
  readonly id: string;
  readonly fromVertexId: string;
  readonly toVertexId: string;
}

export interface CanonicalGap {
  readonly id: string;
}

export interface DeferredIssue {
  readonly id: string;
}

export interface CanonicalTopologyCandidate {
  readonly vertices: readonly CanonicalVertex[];
  readonly edges: readonly CanonicalEdge[];
  readonly gaps: readonly CanonicalGap[];
  readonly deferredIssues: readonly DeferredIssue[];
}

// ---- Lookup helpers -------------------------------------------------------
// Pure, read-only lookups against a specific CanonicalTopologyCandidate
// instance. This is the ONLY way anchor validation may confirm existence —
// per RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE, a RAW or AUDITED-only
// id must never satisfy these.

export function canonicalVertexExists(
  candidate: CanonicalTopologyCandidate,
  vertexId: string
): boolean {
  return candidate.vertices.some((v) => v.id === vertexId);
}

export function findCanonicalEdge(
  candidate: CanonicalTopologyCandidate,
  edgeId: string
): CanonicalEdge | undefined {
  return candidate.edges.find((e) => e.id === edgeId);
}

export function canonicalEdgeExists(
  candidate: CanonicalTopologyCandidate,
  edgeId: string
): boolean {
  return findCanonicalEdge(candidate, edgeId) !== undefined;
}

export function canonicalGapExists(
  candidate: CanonicalTopologyCandidate,
  gapId: string
): boolean {
  return candidate.gaps.some((g) => g.id === gapId);
}

export function canonicalDeferredIssueExists(
  candidate: CanonicalTopologyCandidate,
  issueId: string
): boolean {
  return candidate.deferredIssues.some((d) => d.id === issueId);
}

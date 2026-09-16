import { CanonicalTopologyCandidate } from "../types/topology-input";
import rawSnapshot from "./attempt3-actual-candidate.json";

// ============================================================================
// PROVENANCE — READ BEFORE EDITING
//
// The data below is loaded VERBATIM from attempt3-actual-candidate.json,
// which is the real, unmodified stdout of running the ORIGINAL,
// user-supplied phase1c-b-complete.zip's own construct.ts against its own
// fixtures/attempt3.ts (RAW input) and the approved PLAN — i.e. actually
// executing:
//
//   constructCanonicalTopology(attempt3Raw, attempt3ApprovedPlan, "attempt3-candidate")
//
// from the verified Phase 1C-B package, not a hand-reconstruction, not a
// memory-based summary, and not a corrected re-guess. The snapshot file
// captures the full CanonicalTopologyCandidate object (vertices, edges with
// fromCanonicalVertexId/toCanonicalVertexId, gaps, deferredIssues,
// connectedComponents, stateFlags, candidateState, validationResults).
//
// This corrects an earlier version of this fixture (now deleted) that
// fabricated vertex-pair endpoints for e1/e19/e20/e25/e26 by guessing from a
// prose summary in project memory, then mislabeled the guess as a mirror of
// verified runtime output. That was a real error, caught by the user, not a
// stylistic choice. This loader exists specifically so that mistake cannot
// recur silently: only the fields Part A actually needs are extracted below,
// each pulled directly from the JSON snapshot, none synthesized.
//
// To regenerate attempt3-actual-candidate.json from scratch: extract the
// original phase1c-b-complete.zip, add a one-line script that imports
// constructCanonicalTopology + attempt3Raw + attempt3ApprovedPlan from that
// package and JSON.stringify()'s the result, compile with tsc, run with node.
// Do not hand-edit the JSON file.
// ============================================================================

export const attempt3Canonical: CanonicalTopologyCandidate = {
  vertices: rawSnapshot.vertices.map((v) => ({ id: v.canonicalVertexId })),
  edges: rawSnapshot.edges.map((e) => ({
    // Strip the "canon-" prefix the original package uses for
    // canonicalEdgeId, so Part A's edge ids line up with the RAW/audit ids
    // already used throughout this project's memory and conversation
    // (e1, e19, ...) for readability. The from/to vertex ids are used
    // completely unmodified from the snapshot.
    id: e.canonicalEdgeId.replace(/^canon-/, ""),
    fromVertexId: e.fromCanonicalVertexId,
    toVertexId: e.toCanonicalVertexId,
  })),
  gaps: rawSnapshot.gaps.map((g) => ({ id: g.gapId })),
  deferredIssues: rawSnapshot.deferredIssues.map((d) => ({ id: d.issueId })),
};

// v4 is the concrete RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE proof
// case: confirmed absent from rawSnapshot.vertices (both its RAW edges e3/e4
// are REJECT_NOT_ENVELOPE and never construct a canonical vertex for v4).
// Verified directly against the snapshot at fixture-load time by the test in
// __tests__/anchor.test.ts, not asserted here without checking.
export const RAW_ONLY_VERTEX_ID_NOT_IN_CANONICAL = "v4";

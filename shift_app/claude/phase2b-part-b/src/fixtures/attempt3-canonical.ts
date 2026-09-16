import { CanonicalTopologyCandidate } from "../types/canonical_topology_v1";
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
// memory-based summary, and not a corrected re-guess.
//
// PHASE 1C CANONICAL CONTRACT IMPLEMENTATION (session 25/26) update: this
// fixture used to re-map the snapshot into a narrower, hand-maintained local
// shape (types/topology-input.ts) that renamed canonicalVertexId -> id,
// stripped the "canon-" prefix from canonicalEdgeId, and renamed
// fromCanonicalVertexId/toCanonicalVertexId -> fromVertexId/toVertexId. Per
// the FINAL CONTRACT VERIFICATION audit, none of that was faithful to the
// real producer contract: "canon-<rawEdgeId>" IS the real canonical edge id,
// and canonicalVertexId/fromCanonicalVertexId/toCanonicalVertexId are the
// real field names. types/topology-input.ts is deleted; this fixture now
// imports the shared, single-source-of-truth CanonicalTopologyCandidate
// contract (supabase/functions/_shared/canonical_topology_v1.ts, reached via
// the ../types/canonical_topology_v1 symlink) and re-types the JSON snapshot
// against it directly — zero field renaming, zero id stripping, zero
// re-mapping of any value (this also means Part B needs no separate step to
// "add" vertex coordinates: coordinate:{x,y} was always part of the real
// CanonicalVertex, it's simply no longer stripped out and re-added by a
// local projection). The `as unknown as CanonicalTopologyCandidate` cast
// exists ONLY because TypeScript's resolveJsonModule widens JSON string
// literals to `string` (e.g. "KEEP_ENVELOPE" -> string) instead of inferring
// the narrow union literal types the contract's interfaces require; it
// asserts the already-correct shape, it does not change or coerce any data.
//
// To regenerate attempt3-actual-candidate.json from scratch: extract the
// original phase1c-b-complete.zip, add a one-line script that imports
// constructCanonicalTopology + attempt3Raw + attempt3ApprovedPlan from that
// package and JSON.stringify()'s the result, compile with tsc, run with node.
// Do not hand-edit the JSON file.
// ============================================================================

export const attempt3Canonical: CanonicalTopologyCandidate =
  rawSnapshot as unknown as CanonicalTopologyCandidate;

// v4 is the concrete RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE proof
// case: confirmed absent from rawSnapshot.vertices (both its RAW edges e3/e4
// are REJECT_NOT_ENVELOPE and never construct a canonical vertex for v4).
// Verified directly against the snapshot at fixture-load time by the test in
// __tests__/sanitation.test.ts, not asserted here without checking. Vertex
// ids are never "canon-" prefixed — only canonicalEdgeId is — so this id is
// unchanged by the migration above.
export const RAW_ONLY_VERTEX_ID_NOT_IN_CANONICAL = "v4";

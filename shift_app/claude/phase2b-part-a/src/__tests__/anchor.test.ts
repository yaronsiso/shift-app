import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorExistsInCanonicalTopology,
  edgePointParamValid,
  anchorIsStructurallyValid,
  validateEndpointProof,
  resolveEndpoint,
} from "../anchor";
import {
  attempt3Canonical,
  RAW_ONLY_VERTEX_ID_NOT_IN_CANONICAL,
} from "../fixtures/attempt3-canonical";
import { CandidateAnchorProposal, TopologyAnchor } from "../types/model";

// ---- canonical anchor still requiring proof --------------------------------
test("VERTEX anchor on a real canonical vertex exists", () => {
  const anchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v12" };
  assert.equal(anchorExistsInCanonicalTopology(attempt3Canonical, anchor), true);
});

// ---- RAW-only vertex rejection ---------------------------------------------
test("RAW-only vertex (v4) does not exist in CanonicalTopologyCandidate", () => {
  const anchor: TopologyAnchor = {
    kind: "VERTEX",
    canonicalVertexId: RAW_ONLY_VERTEX_ID_NOT_IN_CANONICAL,
  };
  assert.equal(anchorExistsInCanonicalTopology(attempt3Canonical, anchor), false);
});

test("structural validity fails for RAW-only v4 even though it is a plausible-looking id", () => {
  const anchor: TopologyAnchor = {
    kind: "VERTEX",
    canonicalVertexId: RAW_ONLY_VERTEX_ID_NOT_IN_CANONICAL,
  };
  assert.equal(anchorIsStructurallyValid(attempt3Canonical, anchor), false);
});

// ---- EDGE_POINT valid/invalid paramT ---------------------------------------
test("EDGE_POINT with paramT in [0,1] on a real edge is valid", () => {
  const anchor: TopologyAnchor = {
    kind: "EDGE_POINT",
    canonicalEdgeId: "e12",
    paramT: 0.5,
  };
  assert.equal(edgePointParamValid(anchor), true);
  assert.equal(anchorIsStructurallyValid(attempt3Canonical, anchor), true);
});

test("EDGE_POINT with paramT out of [0,1] is invalid", () => {
  const anchorTooHigh: TopologyAnchor = {
    kind: "EDGE_POINT",
    canonicalEdgeId: "e12",
    paramT: 1.5,
  };
  const anchorNegative: TopologyAnchor = {
    kind: "EDGE_POINT",
    canonicalEdgeId: "e12",
    paramT: -0.1,
  };
  assert.equal(edgePointParamValid(anchorTooHigh), false);
  assert.equal(edgePointParamValid(anchorNegative), false);
  assert.equal(anchorIsStructurallyValid(attempt3Canonical, anchorTooHigh), false);
  assert.equal(anchorIsStructurallyValid(attempt3Canonical, anchorNegative), false);
});

test("EDGE_POINT on a nonexistent edge fails existence even with valid paramT", () => {
  const anchor: TopologyAnchor = {
    kind: "EDGE_POINT",
    canonicalEdgeId: "e3", // REJECT_NOT_ENVELOPE in Phase 1B, never canonical
    paramT: 0.5,
  };
  assert.equal(anchorExistsInCanonicalTopology(attempt3Canonical, anchor), false);
  assert.equal(anchorIsStructurallyValid(attempt3Canonical, anchor), false);
});

// ---- PROJECTED_INFERRED MEDIUM cap / OTHER_SPATIAL_INFERENCE LOW cap ------
test("EXTENSION_LINE_PROJECTION_INFERRED proof caps at MEDIUM", () => {
  const result = validateEndpointProof({
    anchorStructurallyValid: true,
    proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
    evidenceWellFormed: true,
  });
  assert.equal(result.proofStrength, "MEDIUM");
  assert.equal(result.proofStatus, "INFERRED_VALID");
});

test("OTHER_SPATIAL_INFERENCE proof caps at LOW", () => {
  const result = validateEndpointProof({
    anchorStructurallyValid: true,
    proposedProofType: "OTHER_SPATIAL_INFERENCE",
    evidenceWellFormed: true,
  });
  assert.equal(result.proofStrength, "LOW");
  assert.equal(result.proofStatus, "INFERRED_VALID");
});

test("EXTENSION_LINE_INTERSECTION_VERIFIED proof caps at HIGH when otherwise valid", () => {
  // The cap table entry is HIGH as a property of the proof type itself; no
  // caller in this codebase currently supplies this proof type from real
  // evidence (see audit conclusion), but the deterministic cap logic must
  // still be correct and tested in isolation.
  const result = validateEndpointProof({
    anchorStructurallyValid: true,
    proposedProofType: "EXTENSION_LINE_INTERSECTION_VERIFIED",
    evidenceWellFormed: true,
  });
  assert.equal(result.proofStrength, "HIGH");
  assert.equal(result.proofStatus, "VERIFIED");
});

test("structurally invalid anchor is CONTRADICTED regardless of proof type", () => {
  const result = validateEndpointProof({
    anchorStructurallyValid: false,
    proposedProofType: "EXTENSION_LINE_INTERSECTION_VERIFIED",
    evidenceWellFormed: true,
  });
  assert.equal(result.proofStatus, "CONTRADICTED");
  assert.equal(result.proofStrength, "NONE");
});

test("not-well-formed evidence is INSUFFICIENT even on a structurally valid anchor", () => {
  const result = validateEndpointProof({
    anchorStructurallyValid: true,
    proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
    evidenceWellFormed: false,
  });
  assert.equal(result.proofStatus, "INSUFFICIENT");
  assert.equal(result.proofStrength, "NONE");
});

// ---- resolveEndpoint: unique candidate + verified proof --------------------
test("unique candidate with verified proof resolves to selectedAnchor", () => {
  const anchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const candidates: CandidateAnchorProposal[] = [
    {
      anchor,
      proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
      proof: validateEndpointProof({
        anchorStructurallyValid: true,
        proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
        evidenceWellFormed: true,
      }),
    },
  ];
  const resolution = resolveEndpoint(candidates);
  assert.deepEqual(resolution.selectedAnchor, anchor);
  assert.equal(resolution.endpointConfidence, "MEDIUM");
  assert.equal(resolution.ambiguityReason, null);
});

// ---- unique candidate + insufficient proof ---------------------------------
test("unique candidate with insufficient proof does NOT resolve (UNIQUE_CANDIDATE_IS_NOT_PROOF)", () => {
  const anchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const candidates: CandidateAnchorProposal[] = [
    {
      anchor,
      proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
      proof: validateEndpointProof({
        anchorStructurallyValid: true,
        proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
        evidenceWellFormed: false, // insufficient
      }),
    },
  ];
  const resolution = resolveEndpoint(candidates);
  assert.equal(resolution.selectedAnchor, null);
  assert.equal(resolution.endpointConfidence, "NONE");
});

// ---- equal competing candidates --------------------------------------------
test("two candidates at equal top proofStrength resolve to AMBIGUOUS_COMPETING_CANDIDATES", () => {
  const anchorA: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const anchorB: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v10" };
  const proofMedium = () =>
    validateEndpointProof({
      anchorStructurallyValid: true,
      proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
      evidenceWellFormed: true,
    });
  const candidates: CandidateAnchorProposal[] = [
    { anchor: anchorA, proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED", proof: proofMedium() },
    { anchor: anchorB, proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED", proof: proofMedium() },
  ];
  const resolution = resolveEndpoint(candidates);
  assert.equal(resolution.selectedAnchor, null);
  assert.equal(resolution.ambiguityReason, "AMBIGUOUS_COMPETING_CANDIDATES");
});

// ---- stronger-vs-weaker candidate: no invented tie-break policy -----------
test("a stronger passing candidate alongside a weaker passing candidate is AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY (not auto-resolved)", () => {
  const strongAnchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const weakAnchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v10" };
  const candidates: CandidateAnchorProposal[] = [
    {
      anchor: strongAnchor,
      proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
      proof: validateEndpointProof({
        anchorStructurallyValid: true,
        proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
        evidenceWellFormed: true,
      }), // MEDIUM
    },
    {
      anchor: weakAnchor,
      proposedProofType: "OTHER_SPATIAL_INFERENCE",
      proof: validateEndpointProof({
        anchorStructurallyValid: true,
        proposedProofType: "OTHER_SPATIAL_INFERENCE",
        evidenceWellFormed: true,
      }), // LOW
    },
  ];
  const resolution = resolveEndpoint(candidates);
  // This is the explicitly-flagged open policy question: we do NOT pick the
  // MEDIUM candidate as a winner. No approved policy exists for this case.
  assert.equal(resolution.selectedAnchor, null);
  assert.equal(
    resolution.ambiguityReason,
    "AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY"
  );
});

test("no passing candidates at all resolves to null selectedAnchor, no ambiguity", () => {
  const anchor: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
  const candidates: CandidateAnchorProposal[] = [
    {
      anchor,
      proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
      proof: validateEndpointProof({
        anchorStructurallyValid: false,
        proposedProofType: "EXTENSION_LINE_PROJECTION_INFERRED",
        evidenceWellFormed: true,
      }),
    },
  ];
  const resolution = resolveEndpoint(candidates);
  assert.equal(resolution.selectedAnchor, null);
  assert.equal(resolution.ambiguityReason, null);
});

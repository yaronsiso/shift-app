import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeWitnessPerceptionResponse } from "../sanitation";
import { attempt3Canonical } from "../fixtures/attempt3-canonical";
import {
  KNOWN_MEASUREMENT_IDS,
  SAMPLE_VALID_RESPONSE,
  RESPONSE_WITH_UNKNOWN_MEASUREMENT_ID,
  RESPONSE_WITH_RAW_ONLY_VERTEX,
  RESPONSE_WITH_REJECTED_EDGE,
  RESPONSE_WITH_GAP_AS_ANCHOR,
  RESPONSE_WITH_PARAM_T_NEGATIVE,
  RESPONSE_WITH_PARAM_T_ABOVE_ONE,
  RESPONSE_WITH_SUGGESTED_NOT_IN_CANDIDATES,
  RESPONSE_WITH_EMPTY_CANDIDATES_AND_NULL_SUGGESTED,
  RESPONSE_WITH_DUPLICATE_MEASUREMENT_ID,
} from "../fixtures/sample-ai-responses";

// ---- canonical vertex candidate accepted -----------------------------------
test("a VERTEX candidate on a real canonical vertex is accepted", () => {
  const result = sanitizeWitnessPerceptionResponse(
    SAMPLE_VALID_RESPONSE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 2);
  const top_m1 = result.acceptedCandidates.find((c) => c.measurementId === "top_m1");
  assert.ok(top_m1);
  assert.equal(top_m1!.startEndpointProposal.suggestedAnchor?.kind, "VERTEX");
});

// ---- canonical edge-point accepted -----------------------------------------
test("an EDGE_POINT candidate on a real canonical edge with valid paramT is accepted", () => {
  const result = sanitizeWitnessPerceptionResponse(
    SAMPLE_VALID_RESPONSE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  const left_m19 = result.acceptedCandidates.find((c) => c.measurementId === "left_m19");
  assert.ok(left_m19);
  const edgePointCandidate = left_m19!.startEndpointProposal.candidateAnchors.find(
    (a) => a.kind === "EDGE_POINT"
  );
  assert.ok(edgePointCandidate);
});

// ---- RAW-only v4 rejected ---------------------------------------------------
test("a RAW-only vertex (v4) candidate is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_RAW_ONLY_VERTEX,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.equal(result.rejectedCandidates.length, 1);
  assert.ok(
    result.rejectedCandidates[0]!.issues.some((i) => i.code === "CANONICAL_VERTEX_NOT_FOUND")
  );
});

// ---- rejected edge candidate rejected ---------------------------------------
test("a rejected RAW edge (e3, never canonical) candidate is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_REJECTED_EDGE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(
    result.rejectedCandidates[0]!.issues.some((i) => i.code === "CANONICAL_EDGE_NOT_FOUND")
  );
});

// ---- gap/deferred reference cannot become anchor ---------------------------
test("a CanonicalGap id proposed as a VERTEX anchor is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_GAP_AS_ANCHOR,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(
    result.rejectedCandidates[0]!.issues.some((i) => i.code === "CANONICAL_VERTEX_NOT_FOUND")
  );
});

// ---- paramT < 0 rejected -----------------------------------------------------
test("paramT below 0 is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_PARAM_T_NEGATIVE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(result.rejectedCandidates[0]!.issues.some((i) => i.code === "PARAM_T_OUT_OF_RANGE"));
});

// ---- paramT > 1 rejected -----------------------------------------------------
test("paramT above 1 is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_PARAM_T_ABOVE_ONE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(result.rejectedCandidates[0]!.issues.some((i) => i.code === "PARAM_T_OUT_OF_RANGE"));
});

// ---- unknown measurementId rejected -----------------------------------------
test("an unknown measurementId is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_UNKNOWN_MEASUREMENT_ID,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(result.rejectedCandidates[0]!.issues.some((i) => i.code === "UNKNOWN_MEASUREMENT_ID"));
});

// ---- empty candidate list allowed / suggestedAnchor null allowed -----------
test("an empty candidateAnchors list with null suggestedAnchor is accepted (never forced hallucination)", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_EMPTY_CANDIDATES_AND_NULL_SUGGESTED,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 1);
  assert.equal(result.acceptedCandidates[0]!.startEndpointProposal.candidateAnchors.length, 0);
  assert.equal(result.acceptedCandidates[0]!.startEndpointProposal.suggestedAnchor, null);
});

// ---- suggestedAnchor must be one of candidateAnchors if non-null -----------
test("a suggestedAnchor not present in candidateAnchors is rejected", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_SUGGESTED_NOT_IN_CANDIDATES,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(result.acceptedCandidates.length, 0);
  assert.ok(
    result.rejectedCandidates[0]!.issues.some((i) => i.code === "SUGGESTED_ANCHOR_NOT_IN_CANDIDATES")
  );
});

// ---- multiple candidates preserved as ambiguity -----------------------------
test("multiple candidateAnchors with null suggestedAnchor are preserved as-is (ambiguity, not resolved)", () => {
  const result = sanitizeWitnessPerceptionResponse(
    SAMPLE_VALID_RESPONSE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  const left_m19 = result.acceptedCandidates.find((c) => c.measurementId === "left_m19");
  assert.ok(left_m19);
  assert.equal(left_m19!.startEndpointProposal.candidateAnchors.length, 2);
  assert.equal(left_m19!.startEndpointProposal.suggestedAnchor, null);
  // Sanitation must NOT pick a winner among the two candidates — that is
  // explicitly Part A's job (resolveEndpoint), not sanitation's.
});

// ---- duplicate measurementId flagged ----------------------------------------
test("a duplicate measurementId across two candidates is flagged", () => {
  const result = sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_DUPLICATE_MEASUREMENT_ID,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.ok(result.allIssues.some((i) => i.code === "DUPLICATE_MEASUREMENT_ID"));
});

// ---- numeric equality alone does not create a candidate --------------------
test("sanitation performs no numeric-value comparison anywhere (no such parameter exists)", () => {
  // Structural proof by signature: sanitizeWitnessPerceptionResponse takes
  // exactly 3 parameters (response, canonicalTopology, knownMeasurementIds)
  // — there is no channel for a measurement's rawNumeric/valueM to enter
  // sanitation logic, so it structurally cannot promote or reject a
  // candidate based on numeric similarity.
  assert.equal(sanitizeWitnessPerceptionResponse.length, 3);
});

// ---- chain membership alone does not create a candidate --------------------
test("sanitation performs no chain-membership check anywhere (no such parameter exists)", () => {
  // Same structural argument: no chainId/chain-membership field appears
  // anywhere in WitnessPerceptionCandidate (types/witness-perception.ts) or
  // in sanitizeWitnessPerceptionResponse's inputs — it cannot influence
  // acceptance.
  const result = sanitizeWitnessPerceptionResponse(
    SAMPLE_VALID_RESPONSE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  for (const c of result.acceptedCandidates) {
    assert.equal("chainId" in c, false);
    assert.equal("chainMembership" in c, false);
  }
});

// ---- lineStartPct/lineEndPct cannot produce DIRECT/EXTENSION_LINE_VERIFIED
// authority ---------------------------------------------------------------
test("EXTENSION_LINE_INTERSECTION_VERIFIED may be PROPOSED but sanitation assigns it no authority", () => {
  // Sanitation does not read proposedProofRelationType at all when deciding
  // accept/reject — it only checks anchor existence/paramT/measurementId.
  // This proves the AI's proof-type proposal has zero effect on sanitation
  // acceptance, which is the necessary (though not sufficient — Part A's
  // confidence cap is the sufficient mechanism) condition for "sanitation
  // itself grants no HIGH/VERIFIED authority".
  const responseWithVerifiedClaim = {
    candidates: [
      {
        measurementId: "top_m1",
        startEndpointProposal: {
          candidateAnchors: [{ kind: "VERTEX" as const, canonicalVertexId: "v1" }],
          suggestedAnchor: { kind: "VERTEX" as const, canonicalVertexId: "v1" },
          proposedProofRelationType: "EXTENSION_LINE_INTERSECTION_VERIFIED" as const,
          imageGeometryEvidence: null,
          evidenceRefs: [],
          proposalConfidence: "high" as const,
          notes: "",
        },
        endEndpointProposal: {
          candidateAnchors: [],
          suggestedAnchor: null,
          proposedProofRelationType: null,
          imageGeometryEvidence: null,
          evidenceRefs: [],
          proposalConfidence: "low" as const,
          notes: "",
        },
      },
    ],
    skipped: [],
  };
  const result = sanitizeWitnessPerceptionResponse(
    responseWithVerifiedClaim,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  // Accepted at the SANITATION layer (structurally valid) — but nothing
  // here computes or stores a proofStatus/proofStrength/endpointConfidence.
  // Those fields do not exist anywhere on the accepted candidate's type.
  assert.equal(result.acceptedCandidates.length, 1);
  const accepted = result.acceptedCandidates[0]!;
  assert.equal("proofStatus" in accepted.startEndpointProposal, false);
  assert.equal("proofStrength" in accepted.startEndpointProposal, false);
  assert.equal("endpointConfidence" in accepted.startEndpointProposal, false);
});

// ---- AI output cannot contain selectedAnchor/binding/promotion fields -----
test("WitnessPerceptionCandidate type has no field for selectedAnchor/bindingStatus/bindingConfidence/promotion", () => {
  const sample = SAMPLE_VALID_RESPONSE.candidates[0]!;
  const forbidden = [
    "selectedAnchor",
    "proofStatus",
    "proofStrength",
    "endpointConfidence",
    "bindingStatus",
    "bindingConfidence",
    "TopologySpan",
    "promotionEligible",
    "promotionStatus",
    "PromotedConstraintCandidate",
    "ConstraintEquation",
  ];
  for (const field of forbidden) {
    assert.equal(field in sample, false, `top-level candidate must not have "${field}"`);
    assert.equal(
      field in sample.startEndpointProposal,
      false,
      `startEndpointProposal must not have "${field}"`
    );
    assert.equal(
      field in sample.endEndpointProposal,
      false,
      `endEndpointProposal must not have "${field}"`
    );
  }
});

// ---- input CanonicalTopologyCandidate remains immutable --------------------
test("sanitizing a response does not mutate the input CanonicalTopologyCandidate", () => {
  const before = JSON.stringify(attempt3Canonical);
  sanitizeWitnessPerceptionResponse(SAMPLE_VALID_RESPONSE, attempt3Canonical, KNOWN_MEASUREMENT_IDS);
  sanitizeWitnessPerceptionResponse(
    RESPONSE_WITH_RAW_ONLY_VERTEX,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  const after = JSON.stringify(attempt3Canonical);
  assert.equal(before, after);
});

// ---- skipped measurements are preserved as-is, not converted into empty
// candidates ------------------------------------------------------------
test("a skipped measurement (area/elevation) is preserved with its reason, not forced into a candidate", () => {
  assert.equal(SAMPLE_VALID_RESPONSE.skipped.length, 1);
  assert.equal(SAMPLE_VALID_RESPONSE.skipped[0]!.measurementId, "m18");
  assert.ok(SAMPLE_VALID_RESPONSE.skipped[0]!.reason.length > 0);
  // Sanitation does not touch `skipped` at all — no candidateAnchors were
  // ever proposed for m18, and none are invented here.
  const result = sanitizeWitnessPerceptionResponse(
    SAMPLE_VALID_RESPONSE,
    attempt3Canonical,
    KNOWN_MEASUREMENT_IDS
  );
  assert.equal(
    result.acceptedCandidates.some((c) => c.measurementId === "m18"),
    false
  );
});

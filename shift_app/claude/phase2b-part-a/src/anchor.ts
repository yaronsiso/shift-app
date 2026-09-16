import {
  CanonicalTopologyCandidate,
  canonicalVertexExists,
  findCanonicalEdge,
} from "./types/canonical_topology_v1";
import {
  TopologyAnchor,
  ProofStatus,
  EndpointProofValidation,
  ConfidenceLevel,
  ProofType,
  PROOF_TYPE_CONFIDENCE_CAP,
  CandidateAnchorProposal,
  EndpointResolution,
  AmbiguityReason,
} from "./types/model";

// ---- ANCHOR_EXISTS_IN_CANONICAL_TOPOLOGY -----------------------------------
// A TopologyAnchor may reference ONLY an entity that actually exists in the
// current CanonicalTopologyCandidate artifact, checked by real lookup
// against that specific instance. Never RAW-only, never AUDITED-only.
// (RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE: this function has no
// access to and does not consult any RAW/AUDITED data — only the candidate.)

export function anchorExistsInCanonicalTopology(
  candidate: CanonicalTopologyCandidate,
  anchor: TopologyAnchor
): boolean {
  if (anchor.kind === "VERTEX") {
    return canonicalVertexExists(candidate, anchor.canonicalVertexId);
  }
  // EDGE_POINT
  return findCanonicalEdge(candidate, anchor.canonicalEdgeId) !== undefined;
}

// ---- EDGE_POINT_PARAM_VALID -------------------------------------------------
// paramT is a topological position in [0, 1], never a solved metric
// coordinate. Validity is purely range-based here; it does not imply the
// edge itself exists (that is anchorExistsInCanonicalTopology's job) — both
// must pass independently.

export function edgePointParamValid(anchor: TopologyAnchor): boolean {
  if (anchor.kind !== "EDGE_POINT") {
    // Not applicable to VERTEX anchors; treated as vacuously valid so callers
    // can call this uniformly without branching, but it never substitutes
    // for anchorExistsInCanonicalTopology.
    return true;
  }
  return (
    Number.isFinite(anchor.paramT) && anchor.paramT >= 0 && anchor.paramT <= 1
  );
}

// A candidate anchor is eligible to even be considered further only if BOTH
// existence and (for EDGE_POINT) paramT validity hold.
export function anchorIsStructurallyValid(
  candidate: CanonicalTopologyCandidate,
  anchor: TopologyAnchor
): boolean {
  return (
    anchorExistsInCanonicalTopology(candidate, anchor) &&
    edgePointParamValid(anchor)
  );
}

// ---- EndpointProofValidation (deterministic) -------------------------------
// The deterministic, code-computed verdict on an AI-proposed endpoint,
// separate from the AI's own proofType proposal. This function does NOT
// consult any AI output beyond the already-supplied proposedProofType and
// whatever raw signals the caller passes in imageGeometryEvidenceValid — it
// applies fixed rules only.
//
// CRITICAL (per current-source audit): no caller in this codebase may pass
// proposedProofType=EXTENSION_LINE_INTERSECTION_VERIFIED on the strength of
// lineStartPct/lineEndPct alone (NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT) —
// that is a caller-side responsibility (Part B's perception boundary, out of
// scope here) but this function still validates whatever proofType it is
// given, generically, exactly as construct.ts's engine in Phase 1C-B has no
// hardcoded per-id knowledge.

export interface ProofValidationInput {
  readonly anchorStructurallyValid: boolean;
  readonly proposedProofType: ProofType;
  /** Whether the caller-supplied geometric evidence for this proof type is
   * itself well-formed (e.g. a real coordinate, not NaN/missing). This
   * function does not interpret image content — only whether the evidence
   * shape is usable. */
  readonly evidenceWellFormed: boolean;
}

export function validateEndpointProof(
  input: ProofValidationInput
): EndpointProofValidation {
  const reasons: string[] = [];

  if (!input.anchorStructurallyValid) {
    reasons.push(
      "Anchor failed ANCHOR_EXISTS_IN_CANONICAL_TOPOLOGY or EDGE_POINT_PARAM_VALID."
    );
    return {
      proofStatus: "CONTRADICTED",
      proofStrength: "NONE",
      validationReasons: reasons,
    };
  }

  if (!input.evidenceWellFormed) {
    reasons.push("Supplied geometric evidence is not well-formed.");
    return {
      proofStatus: "INSUFFICIENT",
      proofStrength: "NONE",
      validationReasons: reasons,
    };
  }

  const cap = PROOF_TYPE_CONFIDENCE_CAP[input.proposedProofType];
  reasons.push(
    `Proof type ${input.proposedProofType} capped at ${cap} (ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION).`
  );

  const proofStatus: ProofStatus =
    input.proposedProofType === "EXTENSION_LINE_INTERSECTION_VERIFIED"
      ? "VERIFIED"
      : "INFERRED_VALID";

  return {
    proofStatus,
    proofStrength: cap,
    validationReasons: reasons,
  };
}

// ---- selectedAnchor resolution (UNIQUE_CANDIDATE_IS_NOT_PROOF) -------------
// Resolves one endpoint's set of candidate proposals down to (at most) one
// selectedAnchor. Requires ALL FOUR conditions per candidate:
//   1. candidate exists in CanonicalTopologyCandidate (+ paramT valid)
//   2. no competing candidate passes validation at equal-or-higher proofStrength
//   3. proofStatus in {VERIFIED, INFERRED_VALID}
//   4. proofType itself deterministically validated (not merely asserted)
//
// A single proposed candidate with no competitor is never sufficient ALONE —
// UNIQUE_CANDIDATE_IS_NOT_PROOF — meaning uniqueness is not itself one of the
// four conditions and grants no exemption from them: an unopposed candidate
// still must independently satisfy 1/3/4 above. "No competitor" only means
// condition 2 is vacuously satisfied, not that the others are relaxed.
//
// CRITICAL — tie-break policy: if this function finds two-or-more candidates
// passing validation at the SAME top proofStrength, the result is
// AMBIGUOUS_COMPETING_CANDIDATES (mandatory). If it finds a strictly
// stronger candidate and a strictly weaker one both passing validation, this
// function does NOT invent a "strongest wins" rule — no such rule is
// approved in Phase 2-A design docs. It returns
// AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY instead. This is a genuine open
// policy question, reported at the end of this audit, not resolved here.

export function resolveEndpoint(
  candidates: readonly CandidateAnchorProposal[]
): EndpointResolution {
  const passing = candidates.filter(
    (c) =>
      c.proof.proofStatus === "VERIFIED" ||
      c.proof.proofStatus === "INFERRED_VALID"
  );

  if (passing.length === 0) {
    return {
      selectedAnchor: null,
      selectedProofStrength: "NONE",
      endpointConfidence: "NONE",
      ambiguityReason: null,
    };
  }

  const strengthRank: Record<ConfidenceLevel, number> = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  };

  const maxStrength = passing.reduce(
    (max, c) => Math.max(max, strengthRank[c.proof.proofStrength]),
    0
  );
  const atMaxStrength = passing.filter(
    (c) => strengthRank[c.proof.proofStrength] === maxStrength
  );

  if (atMaxStrength.length > 1) {
    // Multiple candidates tied at the top strength: mandatory AMBIGUOUS,
    // regardless of how many weaker candidates also exist below them.
    const reason: AmbiguityReason = "AMBIGUOUS_COMPETING_CANDIDATES";
    return {
      selectedAnchor: null,
      selectedProofStrength: "NONE",
      endpointConfidence: "NONE",
      ambiguityReason: reason,
    };
  }

  if (passing.length > 1 && atMaxStrength.length === 1) {
    // Exactly one candidate at the top strength, but at least one other
    // (weaker) candidate ALSO passed validation. No approved policy exists
    // in Phase 2-A design docs for "strongest wins over a weaker passing
    // competitor" — do not invent one.
    const reason: AmbiguityReason = "AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY";
    return {
      selectedAnchor: null,
      selectedProofStrength: "NONE",
      endpointConfidence: "NONE",
      ambiguityReason: reason,
    };
  }

  // Exactly one passing candidate, no competitors at all.
  const winner = atMaxStrength[0]!;
  return {
    selectedAnchor: winner.anchor,
    selectedProofStrength: winner.proof.proofStrength,
    endpointConfidence: winner.proof.proofStrength,
    ambiguityReason: null,
  };
}

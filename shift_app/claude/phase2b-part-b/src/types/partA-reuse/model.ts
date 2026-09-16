// Phase 2-A data model, Part A (pure deterministic infrastructure only).
// Every type/function here implements the approved Phase 2-A design.
// No AI call, no orchestration, no PageDimensions/Phase 1C mutation.

// ---- TopologyAnchor --------------------------------------------------------
// A TopologyAnchor may reference ONLY an entity that exists in a specific
// CanonicalTopologyCandidate instance. CanonicalGap and DeferredIssue are
// NOT TopologyAnchor variants (enforced by this union having no such member).

export type TopologyAnchor =
  | { readonly kind: "VERTEX"; readonly canonicalVertexId: string }
  | {
      readonly kind: "EDGE_POINT";
      readonly canonicalEdgeId: string;
      readonly paramT: number;
    };

// ---- Proof types and confidence caps --------------------------------------
// Confidence caps are PER-ENDPOINT and are the source of truth (not a
// derived aggregate witnessType label).

export type ProofType =
  | "EXTENSION_LINE_INTERSECTION_VERIFIED"
  | "EXTENSION_LINE_PROJECTION_INFERRED"
  | "OTHER_SPATIAL_INFERENCE";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

// PROJECTED_INFERRED_CONFIDENCE_CAP + the two other proof-type caps, in one
// deterministic table. Per current-source audit: no input source in this
// codebase is presently authorized to yield EXTENSION_LINE_INTERSECTION_VERIFIED
// (lineStartPct/lineEndPct are DIMENSION_LINE endpoints, not extension-line
// witness feet) — but the HIGH cap is retained here because it is a property
// of the proof TYPE itself, independent of which callers currently supply it.
// Nothing in Part A constructs an EXTENSION_LINE_INTERSECTION_VERIFIED proof
// from lineStartPct/lineEndPct; that would violate NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT.
export const PROOF_TYPE_CONFIDENCE_CAP: Readonly<
  Record<ProofType, ConfidenceLevel>
> = {
  EXTENSION_LINE_INTERSECTION_VERIFIED: "HIGH",
  EXTENSION_LINE_PROJECTION_INFERRED: "MEDIUM",
  OTHER_SPATIAL_INFERENCE: "LOW",
};

export type ProofStatus =
  | "VERIFIED"
  | "INFERRED_VALID"
  | "INSUFFICIENT"
  | "CONTRADICTED";

export interface EndpointProofValidation {
  readonly proofStatus: ProofStatus;
  readonly proofStrength: ConfidenceLevel;
  readonly validationReasons: readonly string[];
}

// ---- Endpoint candidates (internal, deterministic-layer shape) -----------
// This is NOT the AI-facing WitnessPerceptionCandidate schema (that belongs
// to Part B / the perception boundary, out of scope here). This is the
// deterministic layer's own internal representation of one proposed anchor
// candidate for one endpoint, already carrying a proposed proofType — Part A
// consumes candidates in this shape; it does not define how they are produced.

export interface CandidateAnchorProposal {
  readonly anchor: TopologyAnchor;
  readonly proposedProofType: ProofType;
  /** Deterministic validation result for this specific candidate. Computed
   * by validateEndpointProof (this package), never asserted by a caller. */
  readonly proof: EndpointProofValidation;
}

// A validated endpoint's overall picture: all candidates considered for a
// single endpoint (start or end of one measurement), each with its own
// deterministic proof validation.
export interface EndpointCandidateSet {
  readonly candidates: readonly CandidateAnchorProposal[];
}

// The result of deterministically resolving ONE endpoint's selectedAnchor
// (if any) out of its candidate set.
export interface EndpointResolution {
  readonly selectedAnchor: TopologyAnchor | null;
  readonly selectedProofStrength: ConfidenceLevel;
  /** Endpoint-level confidence, already capped by the selected candidate's
   * proof type per PROOF_TYPE_CONFIDENCE_CAP. NONE if selectedAnchor is null. */
  readonly endpointConfidence: ConfidenceLevel;
  /** Set when resolution could not produce a unique selectedAnchor: either
   * two-or-more candidates tied at the top proofStrength (AMBIGUOUS_COMPETING_CANDIDATES),
   * or a stronger-vs-weaker case with no approved tie-break policy
   * (AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY, see resolveEndpoint doc). */
  readonly ambiguityReason: AmbiguityReason | null;
}

export type AmbiguityReason =
  | "AMBIGUOUS_COMPETING_CANDIDATES"
  | "AMBIGUOUS_NO_APPROVED_TIEBREAK_POLICY";

// ---- bindingStatus (derived, not AI-authored) ------------------------------

export type BindingStatus =
  | "UNBOUND"
  | "PARTIALLY_BOUND"
  | "BOUND"
  | "AMBIGUOUS";

// witnessType is descriptive/logging-only, zero authority over confidence.
export type WitnessType = "DIRECT_VERIFIED" | "PROJECTED" | "MIXED" | "OTHER_INFERENCE";

export interface MeasurementWitnessBinding {
  readonly start: EndpointResolution;
  readonly end: EndpointResolution;
  readonly bindingStatus: BindingStatus;
  /** MIN(start.endpointConfidence, end.endpointConfidence). NONE-safe. */
  readonly bindingConfidence: ConfidenceLevel;
  /** Descriptive only — see WitnessType doc. Never read by binding/promotion logic. */
  readonly witnessType: WitnessType;
}

// ---- TopologySpan -----------------------------------------------------------
// Only constructible once bindingStatus=BOUND (NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT:
// no code path may skip straight from a dimension-line reading to this).

export interface TopologySpan {
  readonly fromAnchor: TopologyAnchor;
  readonly toAnchor: TopologyAnchor;
  readonly bindingConfidence: ConfidenceLevel;
}

// ---- Promotion --------------------------------------------------------------

export type Axis = "X" | "Z";
export type SignConvention = "POSITIVE" | "NEGATIVE";

export interface PromotedConstraintCandidate {
  readonly constraintId: string;
  readonly sourceWitnessId: string;
  readonly constraintType: "AXIS_DISTANCE";
  readonly axis: Axis;
  readonly fromAnchor: TopologyAnchor;
  readonly toAnchor: TopologyAnchor;
  readonly distanceM: number;
  readonly signConvention: SignConvention;
  readonly confidence: ConfidenceLevel;
  readonly provenance: {
    readonly sourceWitnessId: string;
    readonly bindingConfidence: ConfidenceLevel;
  };
}

export type PromotionEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

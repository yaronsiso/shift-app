// Phase 2-B Part B — Witness Perception Candidate types.
//
// This is the ONLY schema exposed to the AI. It is a proposal layer:
// non-authoritative, advisory, never a decision. Every field here is
// something the AI may SUGGEST; nothing here is something the AI DECIDES.
//
// Explicitly, permanently FORBIDDEN from this file (per Phase 2-A design,
// reaffirmed for Part B): selectedAnchor, proofStatus, proofStrength,
// endpointConfidence, bindingStatus, bindingConfidence, TopologySpan,
// promotionEligible/promotionStatus, PromotedConstraintCandidate,
// ConstraintEquation, any metric/world coordinate. These belong to Part A's
// deterministic layer (anchor.ts/binding.ts/span.ts/promotion.ts) or later.
// Their absence here is structural, not just documented: the TypeScript
// types below have no field for any of them, and the JSON Schema (built
// from these types) has no property for any of them either —
// additionalProperties:false means the model cannot smuggle one in even if
// it tries.

import { TopologyAnchor } from "./partA-reuse/model";

// ---- Candidate anchors proposed by the AI ----------------------------------
// Re-exported from Part A's model so Part B never defines a second,
// possibly-divergent TopologyAnchor shape. Part B only ever proposes
// candidates in this shape; it never validates or selects among them —
// that stays Part A's job.
export type { TopologyAnchor } from "./partA-reuse/model";

// ---- proofRelationType (AI's own characterization, NOT authoritative) -----
// This is what the AI THINKS it is seeing — never what deterministic code
// has verified. Naming deliberately distinct from Part A's ProofType so the
// two are never confused: this is a proposal-layer field, Part A's is a
// validated-layer field. The values line up conceptually
// (EXTENSION_LINE_INTERSECTION_VERIFIED / EXTENSION_LINE_PROJECTION_INFERRED
// / OTHER_SPATIAL_INFERENCE) because Part A's confidence-cap table keys off
// them, but supplying "EXTENSION_LINE_INTERSECTION_VERIFIED" here is only
// ever a PROPOSAL — per the current PageDimensions contract (lineStartPct/
// lineEndPct are DimensionLineSpan endpoints, not witness feet), Part A's
// deterministic validation caps this at MEDIUM regardless of what the AI
// proposes here. Part B does not enforce that cap — Part A does.
export type ProposedProofRelationType =
  | "EXTENSION_LINE_INTERSECTION_VERIFIED"
  | "EXTENSION_LINE_PROJECTION_INFERRED"
  | "OTHER_SPATIAL_INFERENCE";

export type ProposalConfidence = "high" | "medium" | "low";

// ---- Image geometry evidence (what the AI says it saw) --------------------
// Free-form-ish but structured evidence describing WHAT was projected, FROM
// WHERE, IN WHICH direction/axis, TO WHICH candidate anchor, and on what
// visual basis — so Part A can later assess it as deterministically as
// possible, per the checkpoint's documentation requirement. This is
// descriptive evidence, not a verdict.
export interface ImageGeometryEvidence {
  // Which DimensionLineSpan endpoint (of the measurement itself) this
  // evidence concerns. "start" or "end" is redundant with the parent
  // EndpointPerceptionProposal it lives under, but the axis/direction of
  // the visual relation being described is not redundant, so it's captured
  // explicitly here.
  readonly sourceDimensionLineEndpoint: "lineStartPct" | "lineEndPct";
  readonly projectionAxis: "horizontal" | "vertical" | "diagonal" | "unknown";
  // Free-text (Hebrew or English) description of the visual relation the AI
  // is basing its proposal on — e.g. "the dimension line's left tick
  // appears to align with the top-left corner of this wall segment". This
  // is evidence FOR a human/Part A to assess, not itself a proof.
  readonly visualRelationDescription: string;
}

// ---- Per-endpoint proposal --------------------------------------------------

export interface EndpointPerceptionProposal {
  // May be empty — the AI is never forced to hallucinate a candidate when
  // it genuinely cannot see enough to propose one.
  readonly candidateAnchors: readonly TopologyAnchor[];
  // Must be one of candidateAnchors if non-null (checked in sanitation.ts),
  // or null if the AI has no single best guess (e.g. genuine ambiguity
  // between two visually-plausible candidates, or no candidate at all).
  readonly suggestedAnchor: TopologyAnchor | null;
  // Nullable as a whole: the AI may have no relation-type opinion at all
  // (e.g. when candidateAnchors is empty).
  readonly proposedProofRelationType: ProposedProofRelationType | null;
  readonly imageGeometryEvidence: ImageGeometryEvidence | null;
  readonly evidenceRefs: readonly string[];
  readonly proposalConfidence: ProposalConfidence;
  readonly notes: string;
}

// ---- Top-level candidate ----------------------------------------------------

export interface WitnessPerceptionCandidate {
  readonly measurementId: string;
  readonly startEndpointProposal: EndpointPerceptionProposal;
  readonly endEndpointProposal: EndpointPerceptionProposal;
}

export interface WitnessPerceptionResponse {
  readonly candidates: readonly WitnessPerceptionCandidate[];
  // Measurements the AI deliberately chose not to propose anything for
  // (e.g. area/elevation/textual measurements with no distance-witness
  // relevance to the envelope) — explicit skip with a reason, rather than
  // silence or a forced empty-candidate proposal, per the checkpoint's
  // explicit instruction not to force a proposal for every MeasurementEvidence.
  readonly skipped: readonly SkippedMeasurement[];
}

export interface SkippedMeasurement {
  readonly measurementId: string;
  readonly reason: string;
}

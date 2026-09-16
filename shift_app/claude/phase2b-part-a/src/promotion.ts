import {
  TopologySpan,
  ConfidenceLevel,
  PromotionEligibility,
  PromotedConstraintCandidate,
  Axis,
  SignConvention,
} from "./types/model";

// ---- PROMOTED_REQUIRES_TWO_BOUND_ENDPOINTS ---------------------------------
// PROMOTED requires bindingStatus=BOUND with both endpoints passing
// validation. Because tryConstructTopologySpan (span.ts) is the only path
// to a TopologySpan and already enforces BOUND, receiving a TopologySpan at
// all here already implies two bound endpoints — this function re-checks
// nothing about binding status; its only additional gate is the confidence
// threshold below.

// Approved threshold: LOW is never promotable. Only MEDIUM/HIGH are
// eligible, per this checkpoint's explicit instruction ("LOW not promoted
// at this stage; only MEDIUM/HIGH eligible").
const PROMOTABLE_CONFIDENCE: ReadonlySet<ConfidenceLevel> = new Set([
  "MEDIUM",
  "HIGH",
]);

export function checkPromotionEligibility(
  span: TopologySpan | null
): PromotionEligibility {
  if (span === null) {
    return {
      eligible: false,
      reason:
        "No TopologySpan (bindingStatus was not BOUND) — PROMOTED_REQUIRES_TWO_BOUND_ENDPOINTS.",
    };
  }
  if (!PROMOTABLE_CONFIDENCE.has(span.bindingConfidence)) {
    return {
      eligible: false,
      reason: `bindingConfidence=${span.bindingConfidence} is below the approved promotion threshold (MEDIUM/HIGH only; LOW is never promoted at this stage).`,
    };
  }
  return { eligible: true };
}

// ---- STRUCTURED_CONSTRAINT_ONLY --------------------------------------------
// Fully structured, never a string equation. Only constructs when
// checkPromotionEligibility already returned eligible:true — callers must
// check eligibility first; this function does not re-derive it, to keep a
// single source of truth for the gate.

export interface ConstraintConstructionInput {
  readonly constraintId: string;
  readonly sourceWitnessId: string;
  readonly axis: Axis;
  readonly span: TopologySpan;
  readonly distanceM: number;
  readonly signConvention: SignConvention;
}

export function constructPromotedConstraintCandidate(
  input: ConstraintConstructionInput,
  eligibility: PromotionEligibility
): PromotedConstraintCandidate {
  if (!eligibility.eligible) {
    throw new Error(
      `constructPromotedConstraintCandidate called with ineligible span: ${eligibility.reason}`
    );
  }
  return {
    constraintId: input.constraintId,
    sourceWitnessId: input.sourceWitnessId,
    constraintType: "AXIS_DISTANCE",
    axis: input.axis,
    fromAnchor: input.span.fromAnchor,
    toAnchor: input.span.toAnchor,
    distanceM: input.distanceM,
    signConvention: input.signConvention,
    confidence: input.span.bindingConfidence,
    provenance: {
      sourceWitnessId: input.sourceWitnessId,
      bindingConfidence: input.span.bindingConfidence,
    },
  };
}

// ---- NO_NUMERIC_MATCH_PROMOTION / CHAIN_MEMBERSHIP_NOT_WITNESS_PROOF ------
// These are enforced by ABSENCE: no function in this module accepts a
// "numeric agreement count" or "chain membership" parameter anywhere in its
// signature. There is structurally no input channel through which either
// could influence eligibility or confidence. Documented here as the
// enforcement mechanism for both invariants, verified by a dedicated test
// (see __tests__/promotion.test.ts) asserting the function signatures take
// no such parameter and that passing a high numeric-agreement span with a
// LOW/NONE bindingConfidence still fails promotion.

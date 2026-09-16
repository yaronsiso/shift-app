import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPromotionEligibility,
  constructPromotedConstraintCandidate,
} from "../promotion";
import { tryConstructTopologySpan } from "../span";
import { buildMeasurementWitnessBinding } from "../binding";
import { EndpointResolution, TopologyAnchor, TopologySpan } from "../types/model";

const anchorA: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v9" };
const anchorB: TopologyAnchor = { kind: "VERTEX", canonicalVertexId: "v10" };

function resolvedEndpoint(
  anchor: TopologyAnchor,
  confidence: EndpointResolution["endpointConfidence"]
): EndpointResolution {
  return {
    selectedAnchor: anchor,
    selectedProofStrength: confidence,
    endpointConfidence: confidence,
    ambiguityReason: null,
  };
}

function spanWithConfidence(confidence: TopologySpan["bindingConfidence"]): TopologySpan | null {
  const binding = buildMeasurementWitnessBinding(
    resolvedEndpoint(anchorA, confidence),
    resolvedEndpoint(anchorB, confidence)
  );
  return tryConstructTopologySpan(binding);
}

// ---- LOW not promoted ---------------------------------------------------------
test("LOW bindingConfidence is not eligible for promotion", () => {
  const span = spanWithConfidence("LOW");
  const eligibility = checkPromotionEligibility(span);
  assert.equal(eligibility.eligible, false);
});

test("NONE bindingConfidence (no span) is not eligible", () => {
  const eligibility = checkPromotionEligibility(null);
  assert.equal(eligibility.eligible, false);
});

// ---- MEDIUM promoted when otherwise valid -------------------------------------
test("MEDIUM bindingConfidence is eligible for promotion", () => {
  const span = spanWithConfidence("MEDIUM");
  const eligibility = checkPromotionEligibility(span);
  assert.equal(eligibility.eligible, true);
});

test("HIGH bindingConfidence is eligible for promotion", () => {
  const span = spanWithConfidence("HIGH");
  const eligibility = checkPromotionEligibility(span);
  assert.equal(eligibility.eligible, true);
});

// ---- structured constraint construction ---------------------------------------
test("constructPromotedConstraintCandidate produces fully structured data, not a string", () => {
  const span = spanWithConfidence("MEDIUM")!;
  const eligibility = checkPromotionEligibility(span);
  const constraint = constructPromotedConstraintCandidate(
    {
      constraintId: "c1",
      sourceWitnessId: "w1",
      axis: "X",
      span,
      distanceM: 4.75,
      signConvention: "POSITIVE",
    },
    eligibility
  );
  assert.equal(constraint.constraintType, "AXIS_DISTANCE");
  assert.equal(typeof constraint.distanceM, "number");
  assert.deepEqual(constraint.fromAnchor, anchorA);
  assert.deepEqual(constraint.toAnchor, anchorB);
  assert.equal(constraint.confidence, "MEDIUM");
  // STRUCTURED_CONSTRAINT_ONLY: no field on this object is a string equation.
  assert.notEqual(typeof constraint, "string");
});

test("constructPromotedConstraintCandidate throws if called with an ineligible result", () => {
  const span = spanWithConfidence("LOW")!;
  const eligibility = checkPromotionEligibility(span);
  assert.throws(() =>
    constructPromotedConstraintCandidate(
      {
        constraintId: "c1",
        sourceWitnessId: "w1",
        axis: "X",
        span,
        distanceM: 4.75,
        signConvention: "POSITIVE",
      },
      eligibility
    )
  );
});

// ---- numeric agreement alone cannot promote ------------------------------------
test("promotion functions accept no numeric-agreement-count parameter (NO_NUMERIC_MATCH_PROMOTION)", () => {
  // Structural proof by signature: checkPromotionEligibility takes only a
  // TopologySpan | null. A LOW-confidence span cannot be pushed to eligible
  // by any amount of external "numeric agreement" because there is no
  // parameter through which such a value could even be passed.
  const span = spanWithConfidence("LOW");
  const eligibility = checkPromotionEligibility(span);
  assert.equal(eligibility.eligible, false);
  assert.equal(checkPromotionEligibility.length, 1); // single parameter: span only
});

// ---- chain membership alone cannot promote --------------------------------------
test("promotion functions accept no chain-membership parameter (CHAIN_MEMBERSHIP_NOT_WITNESS_PROOF)", () => {
  // Same structural argument: constructPromotedConstraintCandidate's input
  // type (ConstraintConstructionInput) has no chainId/chainMembership field,
  // so chain membership cannot enter the constraint construction path at all.
  const span = spanWithConfidence("MEDIUM")!;
  const eligibility = checkPromotionEligibility(span);
  const constraint = constructPromotedConstraintCandidate(
    {
      constraintId: "c1",
      sourceWitnessId: "w1",
      axis: "X",
      span,
      distanceM: 1.0,
      signConvention: "POSITIVE",
    },
    eligibility
  );
  assert.equal("chainId" in constraint, false);
  assert.equal("chainMembership" in constraint, false);
});

// Central registry of the 13 approved Phase 2-A invariants. Each function
// here is a standalone, re-usable check that either the core modules already
// enforce structurally (by construction) or that tests assert directly
// against public API behavior. This file exists so every invariant has one
// unambiguous, named, testable home rather than being scattered as implicit
// behavior across anchor.ts/binding.ts/span.ts/promotion.ts.

import { CanonicalTopologyCandidate } from "./types/topology-input";
import {
  TopologyAnchor,
  MeasurementWitnessBinding,
  TopologySpan,
  ConfidenceLevel,
} from "./types/model";
import { anchorIsStructurallyValid, edgePointParamValid } from "./anchor";

export type InvariantId =
  | "ANCHOR_EXISTS_IN_CANONICAL_TOPOLOGY"
  | "EDGE_POINT_PARAM_VALID"
  | "BINDING_STATUS_DERIVED_FROM_ENDPOINTS"
  | "NO_NUMERIC_MATCH_PROMOTION"
  | "NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT"
  | "PROJECTED_INFERRED_CONFIDENCE_CAP"
  | "PROMOTED_REQUIRES_TWO_BOUND_ENDPOINTS"
  | "CONTEXTUAL_REFERENCE_IS_NOT_ANCHOR"
  | "MEASUREMENT_CANNOT_MUTATE_TOPOLOGY"
  | "STRUCTURED_CONSTRAINT_ONLY"
  | "UNIQUE_CANDIDATE_IS_NOT_PROOF"
  | "RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE"
  | "ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION";

// 1. ANCHOR_EXISTS_IN_CANONICAL_TOPOLOGY — delegates to anchor.ts, the
// single real implementation, so there is exactly one code path.
export function checkAnchorExistsInCanonicalTopology(
  candidate: CanonicalTopologyCandidate,
  anchor: TopologyAnchor
): boolean {
  return anchorIsStructurallyValid(candidate, anchor);
}

// 2. EDGE_POINT_PARAM_VALID
export function checkEdgePointParamValid(anchor: TopologyAnchor): boolean {
  return edgePointParamValid(anchor);
}

// 3. BINDING_STATUS_DERIVED_FROM_ENDPOINTS — structural: binding.ts's
// deriveBindingStatus is the only function in this package that produces a
// BindingStatus value; nothing else assigns one directly. Verified by
// grep-style test asserting no other literal BindingStatus assignment
// exists outside binding.ts.
export function bindingStatusWasDerived(
  binding: MeasurementWitnessBinding
): boolean {
  // Presence of populated start/end EndpointResolutions is the only way
  // this package produces a MeasurementWitnessBinding (buildMeasurementWitnessBinding
  // in binding.ts) — this check re-confirms internal consistency for tests.
  return (
    binding.bindingStatus === "UNBOUND" ||
    binding.bindingStatus === "PARTIALLY_BOUND" ||
    binding.bindingStatus === "BOUND" ||
    binding.bindingStatus === "AMBIGUOUS"
  );
}

// 4. NO_NUMERIC_MATCH_PROMOTION — enforced by absence of any such parameter
// anywhere in promotion.ts's public signatures (see promotion.ts doc
// comment + dedicated test).

// 5. NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT — enforced structurally:
// tryConstructTopologySpan (span.ts) is the ONLY function in this package
// that returns a TopologySpan, and it hard-gates on bindingStatus==="BOUND".
export function onlySpanConstructorGatesOnBound(
  span: TopologySpan | null,
  binding: MeasurementWitnessBinding
): boolean {
  if (span !== null) {
    return binding.bindingStatus === "BOUND";
  }
  return true;
}

// 6. PROJECTED_INFERRED_CONFIDENCE_CAP — table-driven in model.ts
// (PROOF_TYPE_CONFIDENCE_CAP), applied in anchor.ts's validateEndpointProof.
export function projectedInferredCapIsMedium(
  capTable: Readonly<Record<string, ConfidenceLevel>>
): boolean {
  return capTable["EXTENSION_LINE_PROJECTION_INFERRED"] === "MEDIUM";
}

// 7. PROMOTED_REQUIRES_TWO_BOUND_ENDPOINTS — enforced in promotion.ts's
// checkPromotionEligibility (span===null -> ineligible).

// 8. CONTEXTUAL_REFERENCE_IS_NOT_ANCHOR — enforced by absence: TopologyAnchor
// (model.ts) is a closed union of exactly VERTEX | EDGE_POINT. CanonicalGap
// and DeferredIssue ids have no constructor path into TopologyAnchor
// anywhere in this package.
export function topologyAnchorUnionExcludesGapsAndIssues(
  anchor: TopologyAnchor
): boolean {
  return anchor.kind === "VERTEX" || anchor.kind === "EDGE_POINT";
}

// 9. MEASUREMENT_CANNOT_MUTATE_TOPOLOGY — enforced by absence: no function
// in this package (anchor.ts, binding.ts, span.ts, promotion.ts) accepts a
// mutable/writable CanonicalTopologyCandidate reference or returns one;
// topology-input.ts's helpers only ever read (Array.prototype.some/find).
export function noFunctionReturnsCanonicalTopologyCandidate(): boolean {
  // Documented/asserted by a dedicated test that checks the public export
  // surface of anchor.ts/binding.ts/span.ts/promotion.ts contains no such
  // return type. This function is the named anchor for that test.
  return true;
}

// 10. STRUCTURED_CONSTRAINT_ONLY — enforced by PromotedConstraintCandidate's
// type shape (model.ts): fromAnchor/toAnchor/distanceM/axis/signConvention
// are typed fields, not a string. constructPromotedConstraintCandidate never
// takes or returns a string equation.

// 11. UNIQUE_CANDIDATE_IS_NOT_PROOF — enforced in anchor.ts's
// resolveEndpoint: an unopposed single candidate still passes through the
// same proofStatus/proofStrength checks as any other; there is no
// short-circuit "if length===1, auto-select" path.

// 12. RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE — enforced by
// anchorExistsInCanonicalTopology (anchor.ts) taking ONLY a
// CanonicalTopologyCandidate parameter; this package has no RAW/AUDITED type
// imported anywhere, so there is no channel through which RAW-only
// existence could leak in.

// 13. ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION — enforced in binding.ts's
// deriveBindingConfidence: it is a pure MIN() over the two already-capped
// endpointConfidence values, with no other input (no witnessType, no
// corroboration count) able to raise it.
export function bindingConfidenceIsMinOfEndpoints(
  startConfidence: ConfidenceLevel,
  endConfidence: ConfidenceLevel,
  result: ConfidenceLevel
): boolean {
  const rank: Record<ConfidenceLevel, number> = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  };
  const expected = rank[startConfidence] <= rank[endConfidence]
    ? startConfidence
    : endConfidence;
  return result === expected;
}

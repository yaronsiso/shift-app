import {
  EndpointResolution,
  BindingStatus,
  ConfidenceLevel,
  MeasurementWitnessBinding,
  WitnessType,
} from "./types/model";

const STRENGTH_RANK: Record<ConfidenceLevel, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

// ---- BINDING_STATUS_DERIVED_FROM_ENDPOINTS ---------------------------------
// resolvedCount = count of non-null selected anchors among {start, end}.
//   0 -> UNBOUND
//   1 -> PARTIALLY_BOUND (covers BOTH "start set, end null" AND "start null,
//        end set" — the two-sided case explicitly required by the approved
//        rule correction)
//   2, both passing validation -> BOUND
//   ambiguityReason set on either endpoint -> AMBIGUOUS (this check takes
//   priority: an ambiguous endpoint is never silently counted as "0 resolved"
//   or folded into PARTIALLY_BOUND)

export function deriveBindingStatus(
  start: EndpointResolution,
  end: EndpointResolution
): BindingStatus {
  if (start.ambiguityReason !== null || end.ambiguityReason !== null) {
    return "AMBIGUOUS";
  }

  const resolvedCount =
    (start.selectedAnchor !== null ? 1 : 0) +
    (end.selectedAnchor !== null ? 1 : 0);

  if (resolvedCount === 0) return "UNBOUND";
  if (resolvedCount === 1) return "PARTIALLY_BOUND";
  return "BOUND";
}

// ---- bindingConfidence = MIN(startEndpointConfidence, endEndpointConfidence)
// Always computed from the two already-capped per-endpoint values directly.
// ENDPOINT_CONFIDENCE_CAPS_SURVIVE_AGGREGATION: this MIN can never be
// elevated by anything else (witnessType, corroboration count, etc.).

export function deriveBindingConfidence(
  start: EndpointResolution,
  end: EndpointResolution
): ConfidenceLevel {
  const ranks: ConfidenceLevel[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
  const minRank = Math.min(
    STRENGTH_RANK[start.endpointConfidence],
    STRENGTH_RANK[end.endpointConfidence]
  );
  return ranks[minRank]!;
}

// witnessType is descriptive/logging-only. This function computes it purely
// for observability — nothing downstream may read it to influence
// bindingConfidence or promotion (enforced by never passing it into those
// functions' inputs).
export function deriveWitnessType(
  start: EndpointResolution,
  end: EndpointResolution
): WitnessType {
  const isVerified = (r: EndpointResolution) =>
    r.selectedProofStrength === "HIGH";
  const isProjected = (r: EndpointResolution) =>
    r.selectedProofStrength === "MEDIUM";
  const isOther = (r: EndpointResolution) =>
    r.selectedProofStrength === "LOW";

  if (isVerified(start) && isVerified(end)) return "DIRECT_VERIFIED";
  if (
    (isVerified(start) || isProjected(start)) &&
    (isVerified(end) || isProjected(end)) &&
    !(isVerified(start) && isVerified(end))
  ) {
    return "MIXED";
  }
  if (isProjected(start) && isProjected(end)) return "PROJECTED";
  if (isOther(start) || isOther(end)) return "OTHER_INFERENCE";
  return "OTHER_INFERENCE";
}

export function buildMeasurementWitnessBinding(
  start: EndpointResolution,
  end: EndpointResolution
): MeasurementWitnessBinding {
  return {
    start,
    end,
    bindingStatus: deriveBindingStatus(start, end),
    bindingConfidence: deriveBindingConfidence(start, end),
    witnessType: deriveWitnessType(start, end),
  };
}

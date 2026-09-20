// supabase/functions/_shared/evidence_observation_validators_vnext.ts
//
// Pure, side-effect-free validators for EvidenceObservationVNext. Same
// fatal/diagnostic split precedent as the geometry validators in this
// checkpoint and as envelope_topology_validators_v2.ts before it.
//
// FATAL here is deliberately narrow: duplicate ids, non-finite or
// out-of-range coordinates. An EMPTY rawText string is a DIAGNOSTIC, not
// fatal — "unknown remains unknown" means a low-quality or genuinely
// unreadable reading should not silently disappear, but it also should
// not fail the entire artifact; it's a quality signal for the (not yet
// built) resolver to weigh, same spirit as PageDimensions' own confidence
// levels.

import type {
  EvidenceObservationVNext,
  ImagePctEvidenceVNext,
} from "./evidence_observation_schema_vnext.ts";
import {
  IMAGE_PCT_BOUND_MIN_VNEXT,
  IMAGE_PCT_BOUND_MAX_VNEXT,
} from "./geometry_observation_validators_vnext.ts";

export type FatalErrorCodeEvidenceVNext =
  | "DUPLICATE_DIMENSION_EVIDENCE_ID"
  | "DUPLICATE_TEXT_LABEL_ID"
  | "MALFORMED_COORDINATE"
  | "OUT_OF_RANGE_COORDINATE"
  | "PARTIAL_DIMENSION_LINE";

export type DiagnosticCodeEvidenceVNext =
  | "EMPTY_RAW_TEXT"
  | "LOW_CONFIDENCE_DIMENSION"
  | "UNCERTAIN_LABEL_ROLE";

export interface FatalErrorEvidenceVNext {
  code: FatalErrorCodeEvidenceVNext;
  message: string;
  relatedIds: string[];
}

export interface DiagnosticEvidenceVNext {
  code: DiagnosticCodeEvidenceVNext;
  message: string;
  relatedIds: string[];
}

export interface ValidationResultEvidenceVNext {
  valid: boolean;
  errors: FatalErrorEvidenceVNext[];
  diagnostics: DiagnosticEvidenceVNext[];
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function isFiniteCoordinate(p: ImagePctEvidenceVNext | null | undefined): boolean {
  return !!p && Number.isFinite(p.xPct) && Number.isFinite(p.yPct);
}

function isInRangeCoordinate(p: ImagePctEvidenceVNext): boolean {
  return (
    p.xPct >= IMAGE_PCT_BOUND_MIN_VNEXT &&
    p.xPct <= IMAGE_PCT_BOUND_MAX_VNEXT &&
    p.yPct >= IMAGE_PCT_BOUND_MIN_VNEXT &&
    p.yPct <= IMAGE_PCT_BOUND_MAX_VNEXT
  );
}

function checkDuplicateIds(evidence: EvidenceObservationVNext): FatalErrorEvidenceVNext[] {
  const errors: FatalErrorEvidenceVNext[] = [];
  const dupDim = findDuplicates(evidence.dimensionEvidence.map((d) => d.id));
  if (dupDim.length) {
    errors.push({
      code: "DUPLICATE_DIMENSION_EVIDENCE_ID",
      message: `Duplicate dimensionEvidence id(s): ${dupDim.join(", ")}`,
      relatedIds: dupDim,
    });
  }
  const dupLabel = findDuplicates(evidence.textLabels.map((l) => l.id));
  if (dupLabel.length) {
    errors.push({
      code: "DUPLICATE_TEXT_LABEL_ID",
      message: `Duplicate textLabels id(s): ${dupLabel.join(", ")}`,
      relatedIds: dupLabel,
    });
  }
  return errors;
}

function checkCoordinates(evidence: EvidenceObservationVNext): FatalErrorEvidenceVNext[] {
  const errors: FatalErrorEvidenceVNext[] = [];
  const points: Array<{ label: string; point: ImagePctEvidenceVNext | null }> = [
    ...evidence.dimensionEvidence.flatMap((d) => [
      { label: `dimensionEvidence ${d.id} lineStartPct`, point: d.lineStartPct },
      { label: `dimensionEvidence ${d.id} lineEndPct`, point: d.lineEndPct },
    ]),
    ...evidence.textLabels.map((l) => ({ label: `textLabel ${l.id} anchorImagePct`, point: l.anchorImagePct as ImagePctEvidenceVNext | null })),
  ];
  for (const { label, point } of points) {
    if (point === null) continue; // null is valid for dimension line endpoints
    if (!isFiniteCoordinate(point)) {
      errors.push({
        code: "MALFORMED_COORDINATE",
        message: `${label} has non-finite coordinate (xPct=${point?.xPct}, yPct=${point?.yPct})`,
        relatedIds: [],
      });
      continue;
    }
    if (!isInRangeCoordinate(point)) {
      errors.push({
        code: "OUT_OF_RANGE_COORDINATE",
        message:
          `${label} is outside the tolerated image-percentage bound ` +
          `[${IMAGE_PCT_BOUND_MIN_VNEXT}, ${IMAGE_PCT_BOUND_MAX_VNEXT}] (xPct=${point.xPct}, yPct=${point.yPct})`,
        relatedIds: [],
      });
    }
  }
  return errors;
}

function checkPartialDimensionLines(evidence: EvidenceObservationVNext): FatalErrorEvidenceVNext[] {
  // Either BOTH endpoints are present (a real observed line) or BOTH are
  // null (no distinct line seen). One-sided is a malformed observation,
  // not a legitimate "partial" reading.
  const bad = evidence.dimensionEvidence
    .filter((d) => (d.lineStartPct === null) !== (d.lineEndPct === null))
    .map((d) => d.id);
  if (bad.length === 0) return [];
  return [
    {
      code: "PARTIAL_DIMENSION_LINE",
      message: `dimensionEvidence with exactly one of lineStartPct/lineEndPct set (must be both or neither): ${bad.join(", ")}`,
      relatedIds: bad,
    },
  ];
}

function checkEmptyRawText(evidence: EvidenceObservationVNext): DiagnosticEvidenceVNext[] {
  const emptyDim = evidence.dimensionEvidence.filter((d) => d.rawText.trim().length === 0).map((d) => d.id);
  const emptyLabel = evidence.textLabels.filter((l) => l.rawText.trim().length === 0).map((l) => l.id);
  const ids = [...emptyDim, ...emptyLabel];
  if (ids.length === 0) return [];
  return [
    {
      code: "EMPTY_RAW_TEXT",
      message: `Entries with empty rawText (should generally be omitted rather than emitted empty): [${ids.join(", ")}]`,
      relatedIds: ids,
    },
  ];
}

function checkLowConfidenceDimensions(evidence: EvidenceObservationVNext): DiagnosticEvidenceVNext[] {
  const low = evidence.dimensionEvidence.filter((d) => d.confidence === "low").map((d) => d.id);
  if (low.length === 0) return [];
  return [
    {
      code: "LOW_CONFIDENCE_DIMENSION",
      message: `Low-confidence dimension readings (descriptive only): [${low.join(", ")}]`,
      relatedIds: low,
    },
  ];
}

function checkUncertainLabelRoles(evidence: EvidenceObservationVNext): DiagnosticEvidenceVNext[] {
  const uncertain = evidence.textLabels.filter((l) => l.roleHint === "uncertain").map((l) => l.id);
  if (uncertain.length === 0) return [];
  return [
    {
      code: "UNCERTAIN_LABEL_ROLE",
      message: `Text labels with uncertain roleHint (descriptive only): [${uncertain.join(", ")}]`,
      relatedIds: uncertain,
    },
  ];
}

export function validateEvidenceObservationVNext(
  evidence: EvidenceObservationVNext,
): ValidationResultEvidenceVNext {
  const errors: FatalErrorEvidenceVNext[] = [
    ...checkDuplicateIds(evidence),
    ...checkCoordinates(evidence),
    ...checkPartialDimensionLines(evidence),
  ];

  if (errors.length > 0) {
    return { valid: false, errors, diagnostics: [] };
  }

  const diagnostics: DiagnosticEvidenceVNext[] = [
    ...checkEmptyRawText(evidence),
    ...checkLowConfidenceDimensions(evidence),
    ...checkUncertainLabelRoles(evidence),
  ];

  return { valid: true, errors, diagnostics };
}

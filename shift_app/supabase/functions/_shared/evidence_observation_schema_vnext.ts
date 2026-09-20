// supabase/functions/_shared/evidence_observation_schema_vnext.ts
//
// SHIFT VNext Checkpoint 1 — Pass B (Evidence Observation) schema.
import {
  assertMatchesCheckpointSchemaVNext,
  assertSafeIdVNext,
} from "./vnext_runtime_schema_validator.ts";
//
// LOCKED DECISIONS (per SHIFT VNext Checkpoint 1 authorization):
//   - `rawText` is the OBSERVED printed text, exactly as it appears.
//     NEVER an authoritative valueM, converted length, area, or scale —
//     see FORBIDDEN_FIELD_NAMES_EVIDENCE_VNEXT below for defense-in-depth
//     that actively blocks those field names from ever appearing here.
//   - This pass is NEVER asked to classify a dimension as "overall" vs
//     "local" — that field does not exist in this schema at all. Existing
//     deterministic logic (dimension_chain_builder_v3.ts /
//     dimension_extent_grouping_v3.ts / dimension_chain_resolver_v3.ts)
//     owns that decision later — out of scope for Checkpoint 1, but the
//     schema itself must never grow a shortcut around it.
//   - `unitHint` is an explicit, OPTIONAL, non-authoritative hint (the
//     model may have seen a "מ'"/"ס"מ" marker near the text) — never
//     itself a conversion, and downstream code must derive the actual
//     unit convention deterministically (matching the existing
//     document_unit_convention_resolver.ts precedent), not trust this
//     field as final.
//   - Room-label TEXT belongs exclusively here (`textLabels`, roleHint
//     "room_label") — geometry_observation_schema_vnext.ts's roomRegions
//     may only expose a location pointer, never OCR text. This is the
//     single ownership boundary the two schemas must never blur.
//   - `null`/absence and empty results are valid, honest answers. Nothing
//     here forces a reading of illegible text.

export interface ImagePctEvidenceVNext {
  xPct: number;
  yPct: number;
}

const IMAGE_PCT_SCHEMA_EVIDENCE_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["xPct", "yPct"],
  properties: {
    xPct: { type: "number", minimum: -2, maximum: 102 },
    yPct: { type: "number", minimum: -2, maximum: 102 },
  },
} as const;

export type UnitHintVNext = "m" | "cm" | "mm" | "uncertain" | null;
export type EvidenceConfidenceVNext = "high" | "medium" | "low";
export type TextLabelRoleHintVNext =
  | "room_label"
  | "height_note"
  | "wall_thickness_note"
  | "opening_note"
  | "general_note"
  | "uncertain";

export interface DimensionEvidenceVNext {
  id: string;
  // Exact printed text, digits/units/separators as shown. Never converted,
  // never normalized to a canonical numeric value here.
  rawText: string;
  // Endpoints of the dimension/extension line itself, if visible as a
  // distinct line in the drawing. null/null when the number is present
  // but no distinct line was visible (e.g. a bare label).
  lineStartPct: ImagePctEvidenceVNext | null;
  lineEndPct: ImagePctEvidenceVNext | null;
  unitHint: UnitHintVNext;
  confidence: EvidenceConfidenceVNext;
}

export interface TextLabelVNext {
  id: string;
  rawText: string;
  anchorImagePct: ImagePctEvidenceVNext;
  roleHint: TextLabelRoleHintVNext;
}

export interface EvidenceObservationVNext {
  schemaVersion: "evidence_observation_vnext_v1";
  dimensionEvidence: DimensionEvidenceVNext[];
  textLabels: TextLabelVNext[];
}

// ---- JSON Schema (OpenAI strict:true response_format) ----------------------

const DIMENSION_EVIDENCE_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "rawText", "lineStartPct", "lineEndPct", "unitHint", "confidence"],
  properties: {
    id: { type: "string" },
    rawText: { type: "string" },
    lineStartPct: { anyOf: [IMAGE_PCT_SCHEMA_EVIDENCE_VNEXT, { type: "null" }] },
    lineEndPct: { anyOf: [IMAGE_PCT_SCHEMA_EVIDENCE_VNEXT, { type: "null" }] },
    unitHint: { type: ["string", "null"], enum: ["m", "cm", "mm", "uncertain", null] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
} as const;

const TEXT_LABEL_SCHEMA_VNEXT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "rawText", "anchorImagePct", "roleHint"],
  properties: {
    id: { type: "string" },
    rawText: { type: "string" },
    anchorImagePct: IMAGE_PCT_SCHEMA_EVIDENCE_VNEXT,
    roleHint: {
      type: "string",
      enum: ["room_label", "height_note", "wall_thickness_note", "opening_note", "general_note", "uncertain"],
    },
  },
} as const;

export const EVIDENCE_OBSERVATION_VNEXT_JSON_SCHEMA = {
  name: "evidence_observation_vnext_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "dimensionEvidence", "textLabels"],
    properties: {
      schemaVersion: { type: "string", enum: ["evidence_observation_vnext_v1"] },
      dimensionEvidence: { type: "array", items: DIMENSION_EVIDENCE_SCHEMA_VNEXT },
      textLabels: { type: "array", items: TEXT_LABEL_SCHEMA_VNEXT },
    },
  },
} as const;

// ---- Forbidden-field defense-in-depth --------------------------------------

export const FORBIDDEN_FIELD_NAMES_EVIDENCE_VNEXT = [
  "valueM",
  "lengthM",
  "widthM",
  "heightM",
  "thicknessM",
  "areaM",
  "areaSqm",
  "totalAreaSqm",
  "scale",
  "metersPerPct",
  "isOverall",
  "overall",
  "classification",
  "chainId",
  "extentGroupId",
  "resolvedValueM",
  "polygonOrder",
] as const;

export class EvidenceObservationVNextForbiddenFieldError extends Error {
  constructor(public path: string, public field: string) {
    super(
      `EvidenceObservationVNext payload contains forbidden field "${field}" at ${path}. ` +
        `Pass B (evidence) must only ever return observed rawText/positions, never a ` +
        `converted metric value, area, scale, or an overall/local classification — those ` +
        `remain deterministic responsibilities, not part of this pass.`,
    );
    this.name = "EvidenceObservationVNextForbiddenFieldError";
  }
}

export function assertNoForbiddenFieldsEvidenceVNext(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenFieldsEvidenceVNext(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((FORBIDDEN_FIELD_NAMES_EVIDENCE_VNEXT as readonly string[]).includes(key)) {
        throw new EvidenceObservationVNextForbiddenFieldError(path, key);
      }
      assertNoForbiddenFieldsEvidenceVNext((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

export function parseEvidenceObservationVNext(raw: unknown): EvidenceObservationVNext {
  assertNoForbiddenFieldsEvidenceVNext(raw);
  assertMatchesCheckpointSchemaVNext(raw, EVIDENCE_OBSERVATION_VNEXT_JSON_SCHEMA.schema, "evidence");
  const observation = raw as EvidenceObservationVNext;
  observation.dimensionEvidence.forEach((item, index) =>
    assertSafeIdVNext(item.id, "evidence", `$.dimensionEvidence[${index}].id`)
  );
  observation.textLabels.forEach((item, index) =>
    assertSafeIdVNext(item.id, "evidence", `$.textLabels[${index}].id`)
  );
  return observation;
}

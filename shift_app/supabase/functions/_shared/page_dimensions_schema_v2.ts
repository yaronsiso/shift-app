// supabase/functions/_shared/page_dimensions_schema_v2.ts
//
// Canonical measurement-evidence schema for the SHIFT sketch pipeline —
// session 22, "Patch 01: Measurement Integrity". Origin: produced by an
// external architecture audit (ChatGPT, brought back by Yaron) of the
// pipeline as it stood after session 21, independently verified against
// the actual deployed code before being adopted here (the audit's core
// claim — that analyze-sketch-v2-envelope averaged disagreeing dimension
// chains — was confirmed by reading that file; see
// ../_shared/axis_extent_resolver.ts's header for that specific fix).
//
// Supersedes this session's own earlier, simpler page_dimensions_schema.ts
// (built before the audit) — not run/deployed, so nothing else depends on
// it; deleted rather than kept alongside this one.
//
// Principle: the model TRANSCRIBES + CLASSIFIES raw evidence only — never
// converts units, never sums, never decides what's authoritative. Two
// differences from the plainer schema it replaces:
//   1. Every measurement is its own record (RawMeasurement) with a stable
//      id, the raw printed text AND raw numeric value kept separately
//      (code does mm/cm/m -> m conversion, not the model), an explicit
//      unitEvidence field (was the unit actually printed, or assumed from
//      sheet context?), and a bboxPct so a later stage can associate the
//      number with actual geometry on the page.
//   2. A DimensionChain no longer embeds its segment values directly — it
//      references measurement ids (segmentMeasurementIds/
//      overallMeasurementId). This makes "this exact number, in this
//      exact spot on the page, is part of this chain" traceable, instead
//      of a chain being a disconnected copy of some numbers.
//
// See ../_shared/measurement_resolver.ts for the code-side logic that
// consumes this (unit conversion, chain-sum validation, and the
// never-average axis resolution).

export type Confidence = "high" | "medium" | "low";
export type Axis = "horizontal" | "vertical" | "diagonal" | "unknown";
export type LengthUnit = "mm" | "cm" | "m" | "unknown";
export type UnitEvidence = "explicit" | "sheet_context" | "inferred" | "unknown";

export type DimensionReferenceType =
  | "overall_building"
  | "building_segment"
  | "room_dimension"
  | "room_area"
  | "wall_length"
  | "opening_width"
  | "opening_height"
  | "stair_tread"
  | "stair_riser"
  | "stair_width"
  | "elevation_level"
  | "ceiling_height"
  | "setback"
  | "structural"
  | "unknown";

export interface BboxPct {
  xMinPct: number;
  yMinPct: number;
  xMaxPct: number;
  yMaxPct: number;
}

export interface RawMeasurement {
  id: string;
  rawText: string;
  rawNumeric: number | null;
  unit: LengthUnit;
  unitEvidence: UnitEvidence;
  referenceType: DimensionReferenceType;
  axis: Axis;
  bboxPct: BboxPct;
  label: string;
  confidence: Confidence;
}

export type DimensionChainLevel =
  | "overall"
  | "secondary"
  | "internal"
  | "openings"
  | "unknown";

export interface DimensionChain {
  id: string;
  axis: Axis;
  level: DimensionChainLevel;
  referenceType: DimensionReferenceType;
  bboxPct: BboxPct;
  locationLabel: string;
  segmentMeasurementIds: string[];
  overallMeasurementId: string | null;
  confidence: Confidence;
}

export interface PageDimensionEvidence {
  measurements: RawMeasurement[];
  chains: DimensionChain[];
  notes: string;
}

// ---- strict:true JSON schema ---------------------------------------------

const BBOX_SCHEMA = {
  type: "object",
  properties: {
    xMinPct: { type: "number" },
    yMinPct: { type: "number" },
    xMaxPct: { type: "number" },
    yMaxPct: { type: "number" },
  },
  required: ["xMinPct", "yMinPct", "xMaxPct", "yMaxPct"],
  additionalProperties: false,
} as const;

const RAW_MEASUREMENT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    rawText: { type: "string" },
    rawNumeric: { type: ["number", "null"] },
    unit: { type: "string", enum: ["mm", "cm", "m", "unknown"] },
    unitEvidence: {
      type: "string",
      enum: ["explicit", "sheet_context", "inferred", "unknown"],
    },
    referenceType: {
      type: "string",
      enum: [
        "overall_building",
        "building_segment",
        "room_dimension",
        "room_area",
        "wall_length",
        "opening_width",
        "opening_height",
        "stair_tread",
        "stair_riser",
        "stair_width",
        "elevation_level",
        "ceiling_height",
        "setback",
        "structural",
        "unknown",
      ],
    },
    axis: {
      type: "string",
      enum: ["horizontal", "vertical", "diagonal", "unknown"],
    },
    bboxPct: BBOX_SCHEMA,
    label: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "id",
    "rawText",
    "rawNumeric",
    "unit",
    "unitEvidence",
    "referenceType",
    "axis",
    "bboxPct",
    "label",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const CHAIN_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    axis: {
      type: "string",
      enum: ["horizontal", "vertical", "diagonal", "unknown"],
    },
    level: {
      type: "string",
      enum: ["overall", "secondary", "internal", "openings", "unknown"],
    },
    referenceType: {
      type: "string",
      enum: [
        "overall_building",
        "building_segment",
        "room_dimension",
        "room_area",
        "wall_length",
        "opening_width",
        "opening_height",
        "stair_tread",
        "stair_riser",
        "stair_width",
        "elevation_level",
        "ceiling_height",
        "setback",
        "structural",
        "unknown",
      ],
    },
    bboxPct: BBOX_SCHEMA,
    locationLabel: { type: "string" },
    segmentMeasurementIds: { type: "array", items: { type: "string" } },
    overallMeasurementId: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "id",
    "axis",
    "level",
    "referenceType",
    "bboxPct",
    "locationLabel",
    "segmentMeasurementIds",
    "overallMeasurementId",
    "confidence",
  ],
  additionalProperties: false,
} as const;

export const PAGE_DIMENSION_EVIDENCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    measurements: { type: "array", items: RAW_MEASUREMENT_SCHEMA },
    chains: { type: "array", items: CHAIN_SCHEMA },
    notes: { type: "string" },
  },
  required: ["measurements", "chains", "notes"],
  additionalProperties: false,
} as const;

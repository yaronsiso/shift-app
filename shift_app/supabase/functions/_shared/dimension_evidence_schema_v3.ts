// supabase/functions/_shared/dimension_evidence_schema_v3.ts
//
// Session 23 rewrite of Pass 1's evidence schema, per Yaron's explicit
// instruction (itself relaying a second ChatGPT architecture note): the
// model must stop being the authority that decides which dimension chain
// is "the overall building measurement". That decision — and the grouping
// of individual numbers into chains at all — moves entirely into code.
//
// What changed vs. page_dimensions_schema_v2.ts (deleted, this replaces it
// completely — nothing else in the repo depended on it):
//   1. The model no longer returns `chains` at all. Session 22's data showed
//      why: 44 measurements were transcribed well, but only 2 chains were
//      built by the model — it is decent at reading/classifying individual
//      numbers and unreliable at grouping them. So grouping is now a pure,
//      testable, deterministic function (dimension_chain_builder_v3.ts)
//      driven by each measurement's own position on the page.
//   2. The model no longer outputs "overall_building" as a classification.
//      `referenceType` (14-way enum, including the overall/segment
//      distinction) is replaced by `referenceTypeHint` — a much smaller,
//      purely descriptive 7-way enum (what kind of thing is this number
//      measuring), with NO "this is the overall total" option. Whether a
//      code-built chain qualifies as the building's overall extent is
//      decided by geometry (does its span cover ~the full page width/
//      height that Stage 0 already cropped down to the main floor plan) —
//      see dimension_chain_builder_v3.ts's isOverallCandidate.
//   3. Two new fields, lineStartPct / lineEndPct: the endpoints of the
//      actual drawn dimension line (arrows/ticks), if visible — separate
//      from bboxPct (which just locates the printed number/text). This is
//      the geometric data the chain-builder needs; bboxPct alone (the
//      text's own small box) is too imprecise for span/coverage math.
//      Nullable because not every dimension line is unambiguously visible
//      (e.g. cramped/overlapping annotations) — the model must not guess.
//   4. New top-level `convention`: DocumentMeasurementConvention. The model
//      may report a page-wide unit convention it noticed (e.g. a printed
//      note "all dimensions in cm", or a consistent pattern of bare
//      numbers) as EVIDENCE, not as a decision — code decides whether/how
//      to use it (see dimension_chain_resolver_v3.ts's toMetersV3: it is
//      only ever used to fill in a per-measurement `unit: "unknown"`, and
//      only for measurements whose referenceTypeHint is an actual length,
//      never for "area" or "elevation" — see that file's header for why).
//
// Principle carried over unchanged from Patch 01: the model transcribes
// and classifies raw evidence only. It never converts units, never sums,
// never decides what's authoritative. That is 100% code's job.

export type Confidence = "high" | "medium" | "low";
export type Axis = "horizontal" | "vertical" | "diagonal" | "unknown";
export type LengthUnit = "mm" | "cm" | "m" | "unknown";

// Deliberately small and purely descriptive — no "overall"/"segment"
// distinction here. That distinction is a geometric fact about a GROUP of
// measurements (a chain), decided by code, never a property an individual
// measurement can claim about itself.
export type ReferenceTypeHint =
  | "building" // this number measures the building/envelope itself (a wall run, a facade length) — candidate raw material for an overall chain, not a self-declared overall total
  | "room"
  | "wall"
  | "opening"
  | "elevation" // a level/height marker (e.g. "+304.50"), not a length
  | "area" // an area value (e.g. "13.20" m²) — never a length, never enters length conversion
  | "unknown";

export interface Point2DPct {
  xPct: number;
  yPct: number;
}

export interface BboxPct {
  xMinPct: number;
  yMinPct: number;
  xMaxPct: number;
  yMaxPct: number;
}

export interface DimensionEvidence {
  id: string;
  rawText: string;
  rawNumeric: number | null;
  unit: LengthUnit;
  axis: Axis;
  bboxPct: BboxPct;
  lineStartPct: Point2DPct | null;
  lineEndPct: Point2DPct | null;
  referenceTypeHint: ReferenceTypeHint;
  confidence: Confidence;
}

export interface DocumentMeasurementConvention {
  detectedUnit: LengthUnit;
  confidence: Confidence;
  evidence: string[];
}

export interface PageDimensionEvidenceV3 {
  measurements: DimensionEvidence[];
  convention: DocumentMeasurementConvention;
  notes: string;
}

// ---- strict:true JSON schema ---------------------------------------------

// Nullable object: `type` is an array including "null", same pattern this
// codebase already uses for nullable primitives (rawNumeric, etc.) — when
// the instance is null, `properties`/`required` simply aren't evaluated.
const NULLABLE_POINT_SCHEMA = {
  type: ["object", "null"],
  properties: {
    xPct: { type: "number" },
    yPct: { type: "number" },
  },
  required: ["xPct", "yPct"],
  additionalProperties: false,
} as const;

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

const REFERENCE_TYPE_HINT_ENUM = [
  "building",
  "room",
  "wall",
  "opening",
  "elevation",
  "area",
  "unknown",
] as const;

const DIMENSION_EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    rawText: { type: "string" },
    rawNumeric: { type: ["number", "null"] },
    unit: { type: "string", enum: ["mm", "cm", "m", "unknown"] },
    axis: { type: "string", enum: ["horizontal", "vertical", "diagonal", "unknown"] },
    bboxPct: BBOX_SCHEMA,
    lineStartPct: NULLABLE_POINT_SCHEMA,
    lineEndPct: NULLABLE_POINT_SCHEMA,
    referenceTypeHint: { type: "string", enum: REFERENCE_TYPE_HINT_ENUM },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "id",
    "rawText",
    "rawNumeric",
    "unit",
    "axis",
    "bboxPct",
    "lineStartPct",
    "lineEndPct",
    "referenceTypeHint",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const CONVENTION_SCHEMA = {
  type: "object",
  properties: {
    detectedUnit: { type: "string", enum: ["mm", "cm", "m", "unknown"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: ["detectedUnit", "confidence", "evidence"],
  additionalProperties: false,
} as const;

export const PAGE_DIMENSION_EVIDENCE_V3_JSON_SCHEMA = {
  type: "object",
  properties: {
    measurements: { type: "array", items: DIMENSION_EVIDENCE_SCHEMA },
    convention: CONVENTION_SCHEMA,
    notes: { type: "string" },
  },
  required: ["measurements", "convention", "notes"],
  additionalProperties: false,
} as const;

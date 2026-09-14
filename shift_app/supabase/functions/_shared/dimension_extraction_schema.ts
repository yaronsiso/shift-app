// supabase/functions/_shared/dimension_extraction_schema.ts
//
// NEW schema for Pass 0.5 ("measurements") of the v2 pipeline — session 21
// (continued), built in direct response to a real accuracy bug found in
// Stage 1 (envelope): given a synthetic test drawing with large, explicit,
// unambiguous printed dimensions (16.00m x 10.00m), analyze-sketch-v2-envelope
// still returned a polygon measuring 17.80m x 10.25m — an 11% error on the
// long axis. The model performed a visual/proportional estimate instead of
// reading and using the printed numbers, even though its own `notes` field
// claimed it had used them. See claude/00_HANDOFF and the chat transcript
// this session started from for the full before/after numbers.
//
// Root-cause take (independently reached, then cross-checked against a
// ChatGPT architecture review Yaron brought back — same conclusion): a
// single "look at the image and both read the numbers AND construct
// geometry" call conflates two different jobs (OCR/extraction vs.
// geometric reasoning) inside one non-deterministic step. Splitting them
// into two separate, narrower calls — this one extracts ONLY the written
// numbers, nothing else — and letting Stage 1 (envelope) consume this
// pass's output as ground truth (and, when possible, compute the final
// polygon in CODE instead of asking the model to do arithmetic) is the
// fix being implemented across this file + analyze-sketch-v2-measurements
// + the updated analyze-sketch-v2-envelope.
//
// Deliberately independent of floor_plan_schema.ts / floor_plan_schema_v2.ts
// — this is a new, narrow concern (dimension-chain text extraction), not a
// geometry representation. Nothing else imports or is affected by this file
// changing.

export interface DimensionSegment {
  // Value already converted to meters (the model is instructed to do the
  // unit conversion, e.g. cm -> m, but MUST NOT estimate/derive a value
  // that isn't explicitly printed).
  valueM: number;
  // The exact text as printed in the drawing (e.g. "5.20", "520",
  // "5.20 m") — kept verbatim so a human (or later code) can sanity-check
  // the conversion against the original.
  text: string;
}

export type DimensionAxis = "horizontal" | "vertical";

// One continuous dimension line ("kav mida") along one edge of the
// building's OUTER envelope — e.g. the full top edge, broken into its
// individual wall-segment numbers. Internal/room dimension chains are
// explicitly out of scope for this pass (see the system prompt) — Stage 1
// only needs the outer envelope, not room layout.
export interface DimensionChain {
  id: string;
  axis: DimensionAxis;
  // Free-text description of which edge this chain measures, in the
  // model's own words (e.g. "top exterior edge", "right exterior edge") —
  // for human debugging, not machine-parsed.
  location: string;
  // The individual segment numbers along this chain, in the order they
  // appear (left-to-right for a horizontal chain, top-to-bottom for a
  // vertical one). Code sums these when no explicit overall number exists.
  segments: DimensionSegment[];
  // A single number that explicitly labels the WHOLE chain's total span
  // (e.g. "16.00 m" printed once, spanning several smaller numbers below
  // it) — null when the drawing only shows the individual segments and no
  // separate total. The model must NEVER compute this itself by summing
  // segments — either it's explicitly printed, or this stays null.
  overallValueM: number | null;
  overallText: string | null;
  confidence: "high" | "medium" | "low";
}

export interface DimensionExtraction {
  chains: DimensionChain[]; // [] when no legible written envelope dimensions exist at all
  notes: string;
}

// --- JSON Schema (strict:true response_format) ---------------------------

const DIMENSION_SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    valueM: { type: "number" },
    text: { type: "string" },
  },
  required: ["valueM", "text"],
  additionalProperties: false,
} as const;

const DIMENSION_CHAIN_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    axis: { type: "string", enum: ["horizontal", "vertical"] },
    location: { type: "string" },
    segments: { type: "array", items: DIMENSION_SEGMENT_SCHEMA },
    overallValueM: { type: ["number", "null"] },
    overallText: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "id",
    "axis",
    "location",
    "segments",
    "overallValueM",
    "overallText",
    "confidence",
  ],
  additionalProperties: false,
} as const;

export const DIMENSION_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    chains: { type: "array", items: DIMENSION_CHAIN_SCHEMA },
    notes: { type: "string" },
  },
  required: ["chains", "notes"],
  additionalProperties: false,
} as const;

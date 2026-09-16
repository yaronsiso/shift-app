// Phase 2-B Part B — AI call wrapper.
//
// One focused call. No retry loop, no solver, no multi-step orchestration —
// per the checkpoint's explicit scope limit. Mirrors the same
// callOpenAiJsonSchema shape already used in the real codebase
// (analyze-sketch-v2-page-dimensions/index.ts,
// analyze-sketch-v2-envelope-topology/index.ts) so this integrates the same
// way once wired into a real Edge Function — but this file itself makes no
// network call in this sandbox (no network access here); it only defines
// the request-shaping contract precisely.

import { WITNESS_PERCEPTION_SYSTEM_PROMPT } from "./witness-perception-prompt";
import { WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA } from "./witness-perception-schema";
import { CanonicalTopologyCandidate } from "./types/topology-input";

// Minimal shape of a persisted DimensionEvidence measurement, as consumed
// here — mirrors dimension_evidence_schema_v3.ts's DimensionEvidence
// (read-only reference; that file is not reproduced in full here since
// Part B does not modify PageDimensions or its types).
export interface WitnessInputMeasurement {
  readonly id: string;
  readonly rawText: string;
  readonly axis: "horizontal" | "vertical" | "diagonal" | "unknown";
  readonly bboxPct: { xMinPct: number; yMinPct: number; xMaxPct: number; yMaxPct: number };
  readonly lineStartPct: { xPct: number; yPct: number } | null;
  readonly lineEndPct: { xPct: number; yPct: number } | null;
  readonly referenceTypeHint: string;
}

export interface WitnessPerceptionCallInput {
  readonly canonicalTopology: CanonicalTopologyCandidate;
  readonly measurements: readonly WitnessInputMeasurement[];
  // Signed URL of the SAME cropped.jpg PageDimensions and EnvelopeTopology
  // already use — per the closed coordinate-contract audit. This wrapper
  // does not fetch or validate the URL itself; that's the caller's (Edge
  // Function's) responsibility, matching the pattern of every existing
  // stage in this codebase.
  readonly croppedImageUrl: string;
}

// Compact, textual description of the canonical topology for the prompt's
// user message — vertices/edges only (never gaps/deferredIssues, which are
// not valid anchor targets and must not even be suggested as available
// options to anchor against). Each vertex includes its canonical
// image-percent coordinate (xPct/yPct, 0-100, relative to cropped.jpg —
// the same coordinate frame closed as VERIFIED_COMPATIBLE) so the AI can
// actually relate canonicalVertexId values to positions in the image it is
// shown; without this the AI has ids but no way to locate them. Edge
// descriptions carry only fromVertexId/toVertexId (which resolve to their
// own listed coordinates above) — no new edge-level geometry authority is
// introduced here, matching the checkpoint's explicit instruction that the
// AI can infer an edge's image position from its two endpoints' already-
// canonical coordinates alone.
function describeCanonicalTopologyForPrompt(candidate: CanonicalTopologyCandidate): string {
  const vertexLines = candidate.vertices
    .map(
      (v) =>
        `- VERTEX ${v.id}: xPct=${v.coordinate.x}, yPct=${v.coordinate.y}`
    )
    .join("\n");
  const edgeLines = candidate.edges
    .map((e) => `- EDGE ${e.id} (${e.fromVertexId} -> ${e.toVertexId})`)
    .join("\n");
  return [
    "Canonical vertices (valid VERTEX anchor targets; xPct/yPct are 0-100 image-percent coordinates relative to the SAME cropped.jpg image attached below):",
    vertexLines || "(none)",
    "",
    "Canonical edges (valid EDGE_POINT anchor targets, paramT in [0,1] along the line between the two vertex coordinates listed above):",
    edgeLines || "(none)",
  ].join("\n");
}

function describeMeasurementsForPrompt(measurements: readonly WitnessInputMeasurement[]): string {
  return measurements
    .map((m) => {
      const lineDesc =
        m.lineStartPct && m.lineEndPct
          ? `lineStartPct=(${m.lineStartPct.xPct.toFixed(2)},${m.lineStartPct.yPct.toFixed(2)}) lineEndPct=(${m.lineEndPct.xPct.toFixed(2)},${m.lineEndPct.yPct.toFixed(2)})`
          : "lineStartPct/lineEndPct=null (dimension line not clearly visible)";
      return `- measurementId=${m.id} rawText="${m.rawText}" axis=${m.axis} referenceTypeHint=${m.referenceTypeHint} ${lineDesc}`;
    })
    .join("\n");
}

export interface WitnessPerceptionRequest {
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
  readonly schemaName: string;
  readonly schema: unknown;
}

/**
 * Builds the exact request this stage would send to OpenAI's structured
 * outputs endpoint (response_format.json_schema). Pure function — no
 * network call. The actual fetch() call, when wired into a real Edge
 * Function, follows the same callOpenAiJsonSchema pattern already used
 * throughout this codebase (single call, no retry loop, per this
 * checkpoint's explicit scope).
 */
export function buildWitnessPerceptionRequest(
  input: WitnessPerceptionCallInput
): WitnessPerceptionRequest {
  const userText =
    "הצע/י WitnessPerceptionCandidate עבור כל מידה רלוונטית, לפי הכללים שקיבלת.\n\n" +
    describeCanonicalTopologyForPrompt(input.canonicalTopology) +
    "\n\nMeasurements:\n" +
    describeMeasurementsForPrompt(input.measurements);

  return {
    messages: [
      { role: "system", content: WITNESS_PERCEPTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: input.croppedImageUrl, detail: "high" } },
        ],
      },
    ],
    schemaName: WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA.name,
    schema: WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA.schema,
  };
}

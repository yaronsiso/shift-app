// supabase/functions/_shared/dimension_measurement_merge_v3.ts
//
// Session 23, follow-up #2. Pure, deterministic helpers for the new
// "dimension strips" feature: alongside the full cropped floor-plan image,
// Pass 1 can now also be given up to four extra, tightly-zoomed images —
// top/bottom/left/right strips taken from just outside each edge of the
// main floor-plan bbox — specifically so a real outer dimension line (e.g.
// Yaron's real drawing's vertical "1099", which the model kept missing in
// the full-page image) gets a clear, high-resolution, uncluttered image of
// its own to be read from.
//
// Each strip is its OWN separate OpenAI call, using the exact same prompt/
// schema as the main crop (see analyze-sketch-v2-page-dimensions/index.ts)
// — nothing about how the model reads a single image changes. What DOES
// need code: every DimensionEvidence a strip call returns has its
// bboxPct/lineStartPct/lineEndPct in THAT STRIP'S OWN 0-100 coordinate
// space, not the main crop's. Before a strip's measurements can be merged
// into the same list buildDimensionChains works on, their coordinates must
// be remapped into the main crop's coordinate space — this file does that
// remap (pure arithmetic, using the known original-image-percent bbox each
// strip was cut from, and the main crop's own original-image-percent bbox)
// — and then removes near-duplicate measurements that likely describe the
// same real dimension line as seen in more than one image (e.g. a number
// visible near the edge of both the full crop and a strip).
//
// A remapped point can legitimately fall outside [0,100] (negative, or
// above 100) — that is not a bug. Strips are deliberately cropped with
// some padding BEYOND the main bbox specifically to catch a dimension line
// that sits just outside it; remapping such a point back into crop-space
// correctly produces a small negative/over-100 value, and
// dimension_chain_builder_v3.ts's pure arithmetic (span/coverage/union)
// handles that with no special-casing needed.

import type { BboxPct, DimensionEvidence, Point2DPct } from "./dimension_evidence_schema_v3.ts";

export type StripName = "top" | "bottom" | "left" | "right";

/**
 * Maps one local percentage value (0-100, relative to a strip image's own
 * width/height) into the crop's own percentage space, by composing two
 * linear maps: strip-local -> original-image-percent (using the strip's
 * own bbox, in original-image-percent terms) -> crop-percent (using the
 * main floor-plan bbox, also in original-image-percent terms).
 */
export function remapLocalPctToCropPct(
  localPct: number,
  stripMinPct: number,
  stripMaxPct: number,
  cropMinPct: number,
  cropMaxPct: number,
): number {
  const stripWidth = stripMaxPct - stripMinPct;
  const cropWidth = cropMaxPct - cropMinPct;
  if (!Number.isFinite(stripWidth) || !Number.isFinite(cropWidth) || stripWidth === 0 || cropWidth === 0) {
    // Degenerate bbox (shouldn't happen with real Stage 0/strip data) —
    // fall back to the strip's own local value rather than throwing, so a
    // single bad bbox can't crash the whole Pass 1 call.
    return localPct;
  }
  const originalPct = stripMinPct + (localPct / 100) * stripWidth;
  return ((originalPct - cropMinPct) / cropWidth) * 100;
}

function remapBboxPct(bbox: BboxPct, stripBbox: BboxPct, cropBbox: BboxPct): BboxPct {
  return {
    xMinPct: remapLocalPctToCropPct(bbox.xMinPct, stripBbox.xMinPct, stripBbox.xMaxPct, cropBbox.xMinPct, cropBbox.xMaxPct),
    xMaxPct: remapLocalPctToCropPct(bbox.xMaxPct, stripBbox.xMinPct, stripBbox.xMaxPct, cropBbox.xMinPct, cropBbox.xMaxPct),
    yMinPct: remapLocalPctToCropPct(bbox.yMinPct, stripBbox.yMinPct, stripBbox.yMaxPct, cropBbox.yMinPct, cropBbox.yMaxPct),
    yMaxPct: remapLocalPctToCropPct(bbox.yMaxPct, stripBbox.yMinPct, stripBbox.yMaxPct, cropBbox.yMinPct, cropBbox.yMaxPct),
  };
}

function remapPointPct(point: Point2DPct, stripBbox: BboxPct, cropBbox: BboxPct): Point2DPct {
  return {
    xPct: remapLocalPctToCropPct(point.xPct, stripBbox.xMinPct, stripBbox.xMaxPct, cropBbox.xMinPct, cropBbox.xMaxPct),
    yPct: remapLocalPctToCropPct(point.yPct, stripBbox.yMinPct, stripBbox.yMaxPct, cropBbox.yMinPct, cropBbox.yMaxPct),
  };
}

/**
 * Remaps every measurement a single strip's OpenAI call returned from that
 * strip's own local percentage space into the main crop's percentage
 * space, and prefixes each id with `${stripName}_` so it can never collide
 * with an id from the main crop's own call or another strip's.
 */
export function remapStripMeasurements(
  measurements: DimensionEvidence[],
  stripName: StripName,
  stripBboxOriginalPct: BboxPct,
  mainFloorPlanBboxOriginalPct: BboxPct,
): DimensionEvidence[] {
  return measurements.map((m) => ({
    ...m,
    id: `${stripName}_${m.id}`,
    bboxPct: remapBboxPct(m.bboxPct, stripBboxOriginalPct, mainFloorPlanBboxOriginalPct),
    lineStartPct: m.lineStartPct ? remapPointPct(m.lineStartPct, stripBboxOriginalPct, mainFloorPlanBboxOriginalPct) : null,
    lineEndPct: m.lineEndPct ? remapPointPct(m.lineEndPct, stripBboxOriginalPct, mainFloorPlanBboxOriginalPct) : null,
  }));
}

// How close two measurements' representative positions (in crop-percent
// space) must be, on top of matching number/axis, to be treated as the
// same real dimension line seen twice (once in the full crop, once in a
// strip — or in two overlapping strips) rather than two distinct
// measurements that merely happen to share a value.
const DEDUP_DISTANCE_TOLERANCE_PCT = 8;
const DEDUP_NUMERIC_EPSILON = 1e-6;

function representativePosition(m: DimensionEvidence): { x: number; y: number } {
  if (m.lineStartPct && m.lineEndPct) {
    return {
      x: (m.lineStartPct.xPct + m.lineEndPct.xPct) / 2,
      y: (m.lineStartPct.yPct + m.lineEndPct.yPct) / 2,
    };
  }
  return {
    x: (m.bboxPct.xMinPct + m.bboxPct.xMaxPct) / 2,
    y: (m.bboxPct.yMinPct + m.bboxPct.yMaxPct) / 2,
  };
}

function confidenceRank(c: DimensionEvidence["confidence"]): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

/** Higher is "more worth keeping" when two measurements are duplicates. */
function keepScore(m: DimensionEvidence): number {
  const hasLine = m.lineStartPct && m.lineEndPct ? 1 : 0;
  return hasLine * 10 + confidenceRank(m.confidence);
}

function looksLikeDuplicate(a: DimensionEvidence, b: DimensionEvidence): boolean {
  if (a.axis !== b.axis) return false;
  if (a.rawNumeric == null || b.rawNumeric == null) return false;
  if (Math.abs(a.rawNumeric - b.rawNumeric) > DEDUP_NUMERIC_EPSILON) return false;
  if (a.unit !== "unknown" && b.unit !== "unknown" && a.unit !== b.unit) return false;
  if (
    a.referenceTypeHint !== "unknown" &&
    b.referenceTypeHint !== "unknown" &&
    a.referenceTypeHint !== b.referenceTypeHint
  ) {
    return false;
  }
  const posA = representativePosition(a);
  const posB = representativePosition(b);
  const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
  return dist <= DEDUP_DISTANCE_TOLERANCE_PCT;
}

/**
 * Collapses measurements that most likely describe the SAME real printed
 * dimension line, as seen (and independently transcribed) in more than one
 * image — e.g. a number visible near the edge of both the full crop and a
 * strip. Without this, such a duplicate would enter the same dimension
 * chain as a second member and get erroneously SUMMED by
 * resolveAuthoritativeExtentV3 (which adds up every member of a chain) —
 * silently doubling a real measurement. Keeps the more informative/
 * confident copy (prefers one with real line-endpoint data, then higher
 * confidence, then whichever was seen first) and preserves the original
 * relative order of the measurements that remain.
 */
export function dedupMeasurementsV3(measurements: DimensionEvidence[]): DimensionEvidence[] {
  const kept: DimensionEvidence[] = [];
  for (const m of measurements) {
    const dupIndex = kept.findIndex((k) => looksLikeDuplicate(k, m));
    if (dupIndex === -1) {
      kept.push(m);
      continue;
    }
    if (keepScore(m) > keepScore(kept[dupIndex])) {
      kept[dupIndex] = m;
    }
    // else: existing kept copy is at least as good — drop `m`.
  }
  return kept;
}

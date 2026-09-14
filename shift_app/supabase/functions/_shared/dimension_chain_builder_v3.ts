// supabase/functions/_shared/dimension_chain_builder_v3.ts
//
// Session 23. Pure, deterministic, code-side replacement for what the
// model used to do (badly — 44 measurements but only 2 chains on the real
// test drawing in session 22): grouping individual DimensionEvidence
// records into dimension chains, and deciding which chain is a candidate
// for "the building's overall extent" on its axis.
//
// The core idea, straight from Yaron's instruction: the AI never decides
// "this is the overall measurement". Geometry decides. Stage 0 already
// cropped the image down to just the main floor plan (mainFloorPlanBboxPct
// — see analyze-sketch-v2-scope), and Pass 1 runs on that exact crop, so
// within Pass 1's own image the crop's 0-100 extent on each axis already
// *is* "the main building's bbox" as far as the pipeline can tell without
// doing actual wall/room geometry detection (explicitly not being built
// yet). A dimension chain whose span covers nearly the full 0-100 width
// (horizontal) or height (vertical) of that crop, right out to both edges,
// is geometrically an overall/envelope chain. A chain that only covers a
// small fraction (the "274" case) is a local segment — regardless of what
// the model might have guessed about it.
//
// Algorithm:
//   1. Only "horizontal" and "vertical" measurements participate (a
//      "diagonal"/"unknown"-axis measurement can't be placed in a chain by
//      this logic and is left unclustered).
//   2. Each measurement's position is read from its own drawn dimension
//      line (lineStartPct/lineEndPct) when the model provided one — that's
//      the actual geometry. When it didn't (not clearly visible), we fall
//      back to the measurement's bboxPct, which is far less precise (it
//      locates the printed *text*, not the line) but better than nothing.
//   3. Measurements on the same axis are clustered into strips by their
//      CROSS-axis position (the row/column the dimension line sits on):
//      single-linkage clustering with a tolerance, so a few measurements
//      a few percentage points apart in Y (for a horizontal chain) still
//      group into one row.
//   4. Within a strip, measurements are ordered along the axis (left to
//      right / top to bottom) to form the chain.
//   5. A chain's coverage is (max end - min start) along its axis, out of
//      the full 0-100 page. isOverallCandidate requires BOTH wide coverage
//      AND that the chain actually reaches close to both edges (guards
//      against, e.g., an 80%-wide chain that stops well short of the true
//      far edge because more building continues past it).
//
// Known limitation, documented rather than silently ignored: this does not
// detect or correct overlapping/misaligned measurements within a strip —
// if the model's bbox/line data is noisy, a chain's span can be thrown off.
// That's a real risk to watch for in results, not something this file
// tries to paper over.

import type { DimensionEvidence } from "./dimension_evidence_schema_v3.ts";

export const STRIP_TOLERANCE_PCT = 4;
export const OVERALL_COVERAGE_THRESHOLD_PCT = 80;
export const EDGE_TOLERANCE_PCT = 12;

export type ChainAxis = "horizontal" | "vertical";

export interface BuiltDimensionChain {
  id: string;
  axis: ChainAxis;
  measurementIds: string[]; // ordered along the axis
  spanStartPct: number;
  spanEndPct: number;
  coveragePct: number;
  crossStripPct: number;
  isOverallCandidate: boolean;
  dominantReferenceTypeHint: string;
  usedLineEndpointsCount: number; // how many members had real line data vs. bbox fallback
}

interface MeasurementSpan {
  measurement: DimensionEvidence;
  alongStart: number;
  alongEnd: number;
  cross: number;
  usedLineEndpoints: boolean;
}

/**
 * Reads one measurement's position along `axis`, preferring its own drawn
 * dimension-line endpoints and falling back to its text bbox when the line
 * wasn't visible/provided.
 */
export function measurementSpan(m: DimensionEvidence, axis: ChainAxis): MeasurementSpan {
  if (m.lineStartPct && m.lineEndPct) {
    const a = axis === "horizontal" ? m.lineStartPct.xPct : m.lineStartPct.yPct;
    const b = axis === "horizontal" ? m.lineEndPct.xPct : m.lineEndPct.yPct;
    const crossA = axis === "horizontal" ? m.lineStartPct.yPct : m.lineStartPct.xPct;
    const crossB = axis === "horizontal" ? m.lineEndPct.yPct : m.lineEndPct.xPct;
    return {
      measurement: m,
      alongStart: Math.min(a, b),
      alongEnd: Math.max(a, b),
      cross: (crossA + crossB) / 2,
      usedLineEndpoints: true,
    };
  }
  const alongStart = axis === "horizontal" ? m.bboxPct.xMinPct : m.bboxPct.yMinPct;
  const alongEnd = axis === "horizontal" ? m.bboxPct.xMaxPct : m.bboxPct.yMaxPct;
  const cross = axis === "horizontal"
    ? (m.bboxPct.yMinPct + m.bboxPct.yMaxPct) / 2
    : (m.bboxPct.xMinPct + m.bboxPct.xMaxPct) / 2;
  return { measurement: m, alongStart, alongEnd, cross, usedLineEndpoints: false };
}

function clusterByCross(spans: MeasurementSpan[]): MeasurementSpan[][] {
  const sorted = [...spans].sort((a, b) => a.cross - b.cross);
  const clusters: MeasurementSpan[][] = [];
  for (const span of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && span.cross - current[current.length - 1].cross <= STRIP_TOLERANCE_PCT) {
      current.push(span);
    } else {
      clusters.push([span]);
    }
  }
  return clusters;
}

function dominantReferenceTypeHint(spans: MeasurementSpan[]): string {
  const counts = new Map<string, number>();
  for (const s of spans) {
    counts.set(s.measurement.referenceTypeHint, (counts.get(s.measurement.referenceTypeHint) ?? 0) + 1);
  }
  let best: string = spans[0].measurement.referenceTypeHint;
  let bestCount = -1;
  for (const s of spans) {
    const c = counts.get(s.measurement.referenceTypeHint)!;
    if (c > bestCount) {
      bestCount = c;
      best = s.measurement.referenceTypeHint;
    }
  }
  return best;
}

function buildChainsForAxis(measurements: DimensionEvidence[], axis: ChainAxis): BuiltDimensionChain[] {
  const spans = measurements
    .filter((m) => m.axis === axis)
    .map((m) => measurementSpan(m, axis));

  const clusters = clusterByCross(spans);

  // Order strips deterministically (top-to-bottom for horizontal chains,
  // left-to-right for vertical chains) so chain ids are stable across runs.
  clusters.sort((a, b) => (a[0]?.cross ?? 0) - (b[0]?.cross ?? 0));

  return clusters.map((cluster, idx) => {
    const ordered = [...cluster].sort((a, b) => a.alongStart - b.alongStart);
    const spanStartPct = Math.min(...ordered.map((s) => s.alongStart));
    const spanEndPct = Math.max(...ordered.map((s) => s.alongEnd));
    const coveragePct = spanEndPct - spanStartPct;
    const crossStripPct = ordered.reduce((sum, s) => sum + s.cross, 0) / ordered.length;
    const isOverallCandidate =
      coveragePct >= OVERALL_COVERAGE_THRESHOLD_PCT &&
      spanStartPct <= EDGE_TOLERANCE_PCT &&
      spanEndPct >= 100 - EDGE_TOLERANCE_PCT;

    return {
      id: `chain_${String(idx + 1).padStart(2, "0")}_${axis[0]}`,
      axis,
      measurementIds: ordered.map((s) => s.measurement.id),
      spanStartPct,
      spanEndPct,
      coveragePct,
      crossStripPct,
      isOverallCandidate,
      dominantReferenceTypeHint: dominantReferenceTypeHint(ordered),
      usedLineEndpointsCount: ordered.filter((s) => s.usedLineEndpoints).length,
    };
  });
}

/** Builds chains for both axes from the full measurement list. */
export function buildDimensionChains(measurements: DimensionEvidence[]): BuiltDimensionChain[] {
  return [
    ...buildChainsForAxis(measurements, "horizontal"),
    ...buildChainsForAxis(measurements, "vertical"),
  ];
}

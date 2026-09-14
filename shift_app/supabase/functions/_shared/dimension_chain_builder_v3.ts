// supabase/functions/_shared/dimension_chain_builder_v3.ts
//
// Session 23. Pure, deterministic, code-side replacement for what the
// model used to do (badly — 44 measurements but only 2 chains on the real
// test drawing in session 22): grouping individual DimensionEvidence
// records into dimension chains, and deciding which chain is a candidate
// for "the building's overall extent" on its axis.
//
// The core idea, straight from Yaron's instruction: the AI never decides
// "this is the overall measurement". Geometry decides.
//
// SESSION 23 FOLLOW-UP #2 (Yaron's second real-drawing test): the first
// version of this file decided "overall candidate" by checking whether a
// chain's span reached close to the literal 0/100 edges of the cropped
// PAGE — reasoning that Stage 0 already cropped the image down to just the
// main floor plan, so the crop's own 0-100 extent "is" the building's bbox.
// That assumption turned out to be too tight in practice: a real crop can
// carry a margin, a legend strip, or unrelated site-plan annotations (e.g.
// a "קו בניין"/setback line) that sit inside the crop but outside the
// actual dimensioned building, so the true overall dimension line does not
// reach all the way to the crop's own edges. Widening the page-edge
// tolerance (12->16) only patched the specific case observed once; it does
// not generalize to a drawing with a different margin.
//
// THE FIX: instead of comparing a chain's span to the fixed page extent
// [0,100], compare it to the SPAN OF ALL DIMENSION EVIDENCE COMBINED on
// that axis — i.e. the union of every chain's own span. This is "how far
// out does ANY measurement on this axis reach, in total" — a much better
// proxy for "the building's actual dimensioned extent" than the raw page
// boundary, because it adapts to whatever margin a given drawing/crop
// happens to have. A chain still needs BOTH:
//   1. absolute coverage >= OVERALL_COVERAGE_THRESHOLD_PCT of the full page
//      (unchanged, still checked against the literal 100-point page width/
//      height) — this is what stops the fix from being circular: a single
//      isolated local segment (e.g. "274") is, by definition, the only
//      chain on its axis in a case with no other evidence, so the
//      union-of-all-chains span trivially equals its own span — but its
//      absolute page coverage is tiny, so it still correctly fails here.
//   2. both of its own edges within EDGE_TOLERANCE_PCT of the union span's
//      edges (replaces the old "within EDGE_TOLERANCE_PCT of the literal
//      page 0/100" check).
//
// Known, documented limitation (unchanged in spirit from before): this
// still does not distinguish "real building dimension evidence" from
// unrelated annotations that happen to carry a referenceTypeHint the model
// got wrong (e.g. a site-plan "קו בניין" setback line mis-tagged as
// "building") — such a stray measurement would still enter the
// union-of-all-chains span and could skew it. Not solved here; would need
// actual room/wall geometry reconstruction (explicitly out of scope, see
// Yaron's "אל תבנה Rooms" instruction) to fix properly.
//
// SESSION 23 FOLLOW-UP #3 (real-drawing regression with dimension strips
// live): once strip-sourced measurements started flowing in (see
// dimension_measurement_merge_v3.ts), Yaron's actual test run showed chains
// with coveragePct of 111%, 120%, even 124% — nonsensical for a percentage.
// Root cause: a strip's remapped lineStartPct/lineEndPct is INTENTIONALLY
// allowed to fall outside [0,100] (that's the whole point of a strip's
// padding — it can see a bit past the main crop's own edge), and this
// file's span/coverage math used those raw along-axis positions directly.
// A chain built mostly from strip evidence could therefore have a raw span
// like [-12.7, 98.0] — width 110.7, "coverage" 111%.
//
// THE FIX: spanStartPct/spanEndPct/coveragePct below are now the
// INTERSECTION of the chain's raw span with the canonical main-crop
// coordinate space [0,100] — i.e. clamped independently at each end, so
// coveragePct can never exceed 100 and is 0 for a chain whose raw span
// doesn't overlap [0,100] at all. The raw (unclamped, possibly negative or
// >100) span is preserved separately as rawSpanStartPct/rawSpanEndPct for
// diagnostics — per Yaron's explicit instruction, an out-of-bounds mapped
// coordinate may be kept for visibility but must never inflate an
// overall-envelope candidacy decision. The union-of-all-chains reference
// span (used by the edge-tolerance check above) is likewise computed from
// the CLAMPED per-chain spans, so one wild raw coordinate can no longer
// drag the whole reference span outward either.
//
// Algorithm (unchanged from the first version):
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
//   5. isOverallCandidate — see the session-23-follow-up-#2 comment above.

import type { DimensionEvidence } from "./dimension_evidence_schema_v3.ts";

export const STRIP_TOLERANCE_PCT = 4;
export const OVERALL_COVERAGE_THRESHOLD_PCT = 80;
// How close a chain's own edges must be to the union-of-all-chains
// reference span's edges (see file header) to still count as "reaching
// the edge". Session 23 real-drawing test #1: the true overall horizontal
// chain (1669) reached 84% coverage but its span started at 14.0% of the
// page — a couple of points past the original value of 12. Widened to 16
// (margin above the observed 14.0) so a few points of run-to-run jitter in
// the model's own line-endpoint reading doesn't re-break this. Kept at 16
// after the follow-up #2 fix above, now applied against the adaptive
// union-of-all-chains span rather than the fixed page edges.
export const EDGE_TOLERANCE_PCT = 16;

export type ChainAxis = "horizontal" | "vertical";

// The canonical main-crop coordinate space every measurement is ultimately
// expressed in (see dimension_measurement_merge_v3.ts) — coveragePct is the
// intersection of a chain's raw span with this range, never the raw span
// itself. See the session-23-follow-up-#3 file-header comment above.
const CANONICAL_MIN_PCT = 0;
const CANONICAL_MAX_PCT = 100;

function clampToCanonical(v: number): number {
  return Math.min(CANONICAL_MAX_PCT, Math.max(CANONICAL_MIN_PCT, v));
}

export interface BuiltDimensionChain {
  id: string;
  axis: ChainAxis;
  measurementIds: string[]; // ordered along the axis
  // Clamped to the canonical [0,100] main-crop space (intersection with
  // it) — this is what coveragePct/isOverallCandidate are computed from.
  spanStartPct: number;
  spanEndPct: number;
  // The raw, UNCLAMPED span — can be <0 or >100 for a chain built mostly
  // from strip evidence (see file header). Diagnostic only: never used for
  // coverage/candidacy math.
  rawSpanStartPct: number;
  rawSpanEndPct: number;
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

  // First pass: each cluster's own span/coverage, independent of any
  // overall-candidate decision. spanStartPct/spanEndPct are the RAW
  // (possibly <0 or >100) endpoints; spanStartPct/spanEndPct used for
  // candidacy math are clamped to the canonical [0,100] space immediately
  // below (session 23 follow-up #3 — see file header).
  const partial = clusters.map((cluster, idx) => {
    const ordered = [...cluster].sort((a, b) => a.alongStart - b.alongStart);
    const rawSpanStartPct = Math.min(...ordered.map((s) => s.alongStart));
    const rawSpanEndPct = Math.max(...ordered.map((s) => s.alongEnd));
    // Intersection with the canonical main-crop space — never negative,
    // never exceeds 100. A chain whose raw span doesn't overlap [0,100] at
    // all (e.g. entirely off one edge) correctly collapses to 0 coverage.
    const spanStartPct = clampToCanonical(rawSpanStartPct);
    const spanEndPct = clampToCanonical(rawSpanEndPct);
    const coveragePct = Math.max(0, spanEndPct - spanStartPct);
    const crossStripPct = ordered.reduce((sum, s) => sum + s.cross, 0) / ordered.length;
    return { idx, ordered, spanStartPct, spanEndPct, rawSpanStartPct, rawSpanEndPct, coveragePct, crossStripPct };
  });

  // Reference span (see file header): the union of every chain's own
  // CLAMPED span on this axis. Deliberately NOT the raw 0-100 page extent,
  // and deliberately NOT the unclamped raw spans either — one wild
  // strip-derived coordinate must not be able to drag this reference
  // outward and loosen the edge-tolerance check for every other chain.
  const referenceStartPct = partial.length ? Math.min(...partial.map((p) => p.spanStartPct)) : 0;
  const referenceEndPct = partial.length ? Math.max(...partial.map((p) => p.spanEndPct)) : 0;

  return partial.map(
    ({ idx, ordered, spanStartPct, spanEndPct, rawSpanStartPct, rawSpanEndPct, coveragePct, crossStripPct }) => {
      const isOverallCandidate =
        coveragePct >= OVERALL_COVERAGE_THRESHOLD_PCT &&
        spanStartPct <= referenceStartPct + EDGE_TOLERANCE_PCT &&
        spanEndPct >= referenceEndPct - EDGE_TOLERANCE_PCT;

      return {
        id: `chain_${String(idx + 1).padStart(2, "0")}_${axis[0]}`,
        axis,
        measurementIds: ordered.map((s) => s.measurement.id),
        spanStartPct,
        spanEndPct,
        rawSpanStartPct,
        rawSpanEndPct,
        coveragePct,
        crossStripPct,
        isOverallCandidate,
        dominantReferenceTypeHint: dominantReferenceTypeHint(ordered),
        usedLineEndpointsCount: ordered.filter((s) => s.usedLineEndpoints).length,
      };
    },
  );
}

/** Builds chains for both axes from the full measurement list. */
export function buildDimensionChains(measurements: DimensionEvidence[]): BuiltDimensionChain[] {
  return [
    ...buildChainsForAxis(measurements, "horizontal"),
    ...buildChainsForAxis(measurements, "vertical"),
  ];
}

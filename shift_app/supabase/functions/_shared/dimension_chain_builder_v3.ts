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
// SESSION 23 FOLLOW-UP #4 (Yaron's real-drawing review of the follow-up #3
// run): a measurement with no lineStartPct/lineEndPct (the model could not
// locate its drawn dimension line) is no longer eligible to join ANY
// additive chain, ever -- not even via a bbox-position proximity fallback.
// Reasoning: bboxPct locates the printed TEXT, not the drawn dimension
// line; two numbers can print close together on the page while belonging
// to two unrelated, non-adjacent dimension lines. Such a measurement is
// pulled into its own single-member STANDALONE chain instead -- never
// merged with anything else -- and still evaluated as a possible overall
// candidate on its own (using its bboxPct-derived span), but against a
// reference span computed ONLY from geometry-known (additive) chains, so
// an unreliable bbox-derived span can never seed or distort the yardstick.
// If an axis has zero geometry-known chains at all, the reference span
// collapses to [0,0] and no standalone candidate can qualify either --
// a deliberately conservative dead end (lose the chain, never guess).
//
// SESSION 23 FOLLOW-UP #5 (Yaron's review of the follow-up #4 run): same
// baseline/lane is necessary but NOT sufficient for two measurements to be
// additively summed. The real-drawing run showed a chain wrongly summing
// 96.5+254+920+62+495+1669 = 34.965m -- but 1669 is ITSELF the building's
// overall horizontal dimension line (also correctly detected, completely
// independently, as its own single-member chain = 16.69m). The other five
// numbers are shorter measurements that sit *inside* the span 1669 already
// covers -- they are not "the next segment after 1669", they're a
// different, more granular reading of (part of) the same physical
// distance. Summing them together double-counts that distance.
//
// THE FIX (Yaron's explicit instruction, still purely geometric, no
// heuristic "pick the more plausible number"): being on the same baseline
// is only the first filter. Two more conditions must hold before members
// are allowed to sum together into one additive chain:
//
//   1. CONTAINMENT: if one measurement's own span already covers (within
//      CONTAINMENT_TOLERANCE_PCT) the combined extent of at least
//      MIN_CONTAINED_SIBLINGS other measurements on the same baseline, it
//      is pulled OUT of that baseline's pool entirely and evaluated as its
//      own single-member "single_overall" candidate -- never summed with
//      the measurements nested inside it. This is exactly the 1669 case.
//
//   2. CONTIGUITY (partition, not overlap): among what's left after
//      containment extraction, only measurements that form a genuine
//      end-to-end partition -- each one's end sits within
//      ADJACENCY_GAP_TOLERANCE_PCT / ADJACENCY_OVERLAP_TOLERANCE_PCT of
//      the next one's start -- are grouped into one additive chain. A
//      baseline that turns out to hold two unrelated clusters of numbers
//      (a gap too large to be "the next segment") is split into separate
//      chains rather than silently spanned/summed across the gap.
//
// Every resulting chain (whether built this way or a standalone
// missing-geometry one from follow-up #4) now carries:
//   - candidateType: "single_overall" | "segmented_chain" | "local_dimension"
//     ("single_overall" = a container extracted by rule 1, or a
//     missing-geometry standalone that qualifies on its own;
//     "segmented_chain" = >=2 members that passed the contiguity check;
//     "local_dimension" = a single measurement that is neither a
//     container nor part of a valid partition -- e.g. a room/wall/opening
//     reading with no siblings on its baseline.)
//   - continuity: "contiguous" for segmented_chain, "n/a" otherwise.
//   - excludedContainerIds: ids of sibling measurements on the SAME
//     baseline that were pulled out as containers (rule 1) before this
//     chain was built -- so the debug screen can show, right next to
//     "96.5+254+920+62+495", exactly which measurement (1669) was excluded
//     from that sum and why.
//   - chainNotes: human-readable diagnostics, populated only for
//     single_overall chains produced by containment extraction (explains
//     what it was found to contain).
//
// Every chain (additive or standalone) also still carries, from follow-up
// #4:
//   - chainMembership: "additive" | "standalone"
//   - excludedFromAdditiveChain: "missing_line_geometry" | null
//
// No proximity-based fallback clustering exists for the geometry-missing
// population (Yaron: explicitly rejected in follow-up #4 -- would
// reintroduce the same failure mode). Still never averages, still never
// guesses a unit, still never lets the model decide any of this.

import type { DimensionEvidence } from "./dimension_evidence_schema_v3.ts";

export const STRIP_TOLERANCE_PCT = 4;
export const OVERALL_COVERAGE_THRESHOLD_PCT = 80;
export const EDGE_TOLERANCE_PCT = 16;

// Session 23 follow-up #5:
export const CONTAINMENT_TOLERANCE_PCT = 3;
export const MIN_CONTAINED_SIBLINGS = 2;
export const ADJACENCY_GAP_TOLERANCE_PCT = 3;
export const ADJACENCY_OVERLAP_TOLERANCE_PCT = 2;

export type ChainAxis = "horizontal" | "vertical";
export type ChainMembership = "additive" | "standalone";
export type ChainExclusionReason = "missing_line_geometry";
export type ChainCandidateType = "single_overall" | "segmented_chain" | "local_dimension";
export type ChainContinuity = "contiguous" | "n/a";

const CANONICAL_MIN_PCT = 0;
const CANONICAL_MAX_PCT = 100;

function clampToCanonical(v: number): number {
  return Math.min(CANONICAL_MAX_PCT, Math.max(CANONICAL_MIN_PCT, v));
}

export interface BuiltDimensionChain {
  id: string;
  axis: ChainAxis;
  measurementIds: string[];
  spanStartPct: number;
  spanEndPct: number;
  rawSpanStartPct: number;
  rawSpanEndPct: number;
  coveragePct: number;
  crossStripPct: number;
  isOverallCandidate: boolean;
  dominantReferenceTypeHint: string;
  usedLineEndpointsCount: number;
  chainMembership: ChainMembership;
  excludedFromAdditiveChain: ChainExclusionReason | null;
  candidateType: ChainCandidateType;
  continuity: ChainContinuity;
  excludedContainerIds: string[];
  chainNotes: string[];
}

interface MeasurementSpan {
  measurement: DimensionEvidence;
  alongStart: number;
  alongEnd: number;
  cross: number;
  usedLineEndpoints: boolean;
}

function hasLineGeometry(m: DimensionEvidence): boolean {
  return m.lineStartPct != null && m.lineEndPct != null;
}

/**
 * Reads one measurement's position along `axis` from its own drawn
 * dimension-line endpoints. Only ever called on measurements that already
 * passed hasLineGeometry() -- see file header, follow-up #4.
 */
function measurementSpanFromLine(m: DimensionEvidence, axis: ChainAxis): MeasurementSpan {
  const a = axis === "horizontal" ? m.lineStartPct!.xPct : m.lineStartPct!.yPct;
  const b = axis === "horizontal" ? m.lineEndPct!.xPct : m.lineEndPct!.yPct;
  const crossA = axis === "horizontal" ? m.lineStartPct!.yPct : m.lineStartPct!.xPct;
  const crossB = axis === "horizontal" ? m.lineEndPct!.yPct : m.lineEndPct!.xPct;
  return {
    measurement: m,
    alongStart: Math.min(a, b),
    alongEnd: Math.max(a, b),
    cross: (crossA + crossB) / 2,
    usedLineEndpoints: true,
  };
}

/** bbox-derived span for a geometry-missing measurement's OWN standalone
 * candidacy check only -- never used to cluster it with anything else. */
function standaloneSpanFromBbox(m: DimensionEvidence, axis: ChainAxis): MeasurementSpan {
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

/**
 * Rule 1 (session 23 follow-up #5): pulls out, one at a time, any
 * measurement on this baseline whose own span already covers (within
 * CONTAINMENT_TOLERANCE_PCT) at least MIN_CONTAINED_SIBLINGS *other*
 * measurements' spans. Repeats until no more containers are found --
 * covers the (rare but possible) case of more than one nested "overall"
 * reading on the same baseline.
 */
function extractContainers(
  spans: MeasurementSpan[],
): { containers: MeasurementSpan[]; remaining: MeasurementSpan[]; notesByContainerId: Map<string, string> } {
  let remaining = [...spans];
  const containers: MeasurementSpan[] = [];
  const notesByContainerId = new Map<string, string>();

  let foundOne = true;
  while (foundOne && remaining.length >= MIN_CONTAINED_SIBLINGS + 1) {
    foundOne = false;
    let best: MeasurementSpan | null = null;
    let bestContainedCount = 0;
    let bestOthersMin = 0;
    let bestOthersMax = 0;

    for (const candidate of remaining) {
      const others = remaining.filter((s) => s !== candidate);
      if (others.length < MIN_CONTAINED_SIBLINGS) continue;
      const othersMin = Math.min(...others.map((o) => o.alongStart));
      const othersMax = Math.max(...others.map((o) => o.alongEnd));
      const envelopsAll =
        candidate.alongStart <= othersMin + CONTAINMENT_TOLERANCE_PCT &&
        candidate.alongEnd >= othersMax - CONTAINMENT_TOLERANCE_PCT;
      if (!envelopsAll) continue;

      const containedCount = others.filter(
        (o) =>
          o.alongStart >= candidate.alongStart - CONTAINMENT_TOLERANCE_PCT &&
          o.alongEnd <= candidate.alongEnd + CONTAINMENT_TOLERANCE_PCT,
      ).length;

      if (containedCount >= MIN_CONTAINED_SIBLINGS && containedCount > bestContainedCount) {
        best = candidate;
        bestContainedCount = containedCount;
        bestOthersMin = othersMin;
        bestOthersMax = othersMax;
      }
    }

    if (best) {
      containers.push(best);
      notesByContainerId.set(
        best.measurement.id,
        `Span [${best.alongStart.toFixed(1)},${best.alongEnd.toFixed(1)}] envelops ${bestContainedCount} ` +
        `other measurement(s) on the same baseline spanning [${bestOthersMin.toFixed(1)},${bestOthersMax.toFixed(1)}] -- ` +
        `evaluated as a single_overall candidate, never summed with what it contains.`,
      );
      remaining = remaining.filter((s) => s !== best);
      foundOne = true;
    }
  }

  return { containers, remaining, notesByContainerId };
}

/**
 * Rule 2 (session 23 follow-up #5): groups the (already container-free)
 * remainder of a baseline into maximal runs where each measurement's end
 * sits within tolerance of the next one's start -- a genuine end-to-end
 * partition. A gap too large to be "the next segment" starts a new group
 * instead of silently spanning across it.
 */
function partitionContiguous(spans: MeasurementSpan[]): MeasurementSpan[][] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.alongStart - b.alongStart);
  const groups: MeasurementSpan[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prevGroup = groups[groups.length - 1];
    const prev = prevGroup[prevGroup.length - 1];
    const cur = sorted[i];
    const gap = cur.alongStart - prev.alongEnd; // >0 gap, <0 overlap
    const isAdjacent = gap >= -ADJACENCY_OVERLAP_TOLERANCE_PCT && gap <= ADJACENCY_GAP_TOLERANCE_PCT;
    if (isAdjacent) {
      prevGroup.push(cur);
    } else {
      groups.push([cur]);
    }
  }
  return groups;
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

interface RawGroup {
  ordered: MeasurementSpan[];
  candidateType: ChainCandidateType;
  excludedContainerIds: string[];
  chainNotes: string[];
}

function buildChainsForAxis(measurements: DimensionEvidence[], axis: ChainAxis): BuiltDimensionChain[] {
  const axisMeasurements = measurements.filter((m) => m.axis === axis);
  const geometryKnown = axisMeasurements.filter(hasLineGeometry);
  const geometryMissing = axisMeasurements.filter((m) => !hasLineGeometry(m));

  const knownSpans = geometryKnown.map((m) => measurementSpanFromLine(m, axis));
  const crossClusters = clusterByCross(knownSpans);
  crossClusters.sort((a, b) => (a[0]?.cross ?? 0) - (b[0]?.cross ?? 0));

  const rawGroups: RawGroup[] = [];
  for (const cluster of crossClusters) {
    const { containers, remaining, notesByContainerId } = extractContainers(cluster);
    const excludedContainerIds = containers.map((c) => c.measurement.id);

    for (const c of containers) {
      rawGroups.push({
        ordered: [c],
        candidateType: "single_overall",
        excludedContainerIds: [],
        chainNotes: [notesByContainerId.get(c.measurement.id)!],
      });
    }

    const partitions = partitionContiguous(remaining);
    for (const p of partitions) {
      rawGroups.push({
        ordered: p,
        candidateType: p.length >= 2 ? "segmented_chain" : "local_dimension",
        excludedContainerIds,
        chainNotes: [],
      });
    }
  }

  rawGroups.sort((a, b) => {
    const crossA = a.ordered[0]?.cross ?? 0;
    const crossB = b.ordered[0]?.cross ?? 0;
    if (crossA !== crossB) return crossA - crossB;
    return (a.ordered[0]?.alongStart ?? 0) - (b.ordered[0]?.alongStart ?? 0);
  });

  const partial = rawGroups.map((g, idx) => {
    const ordered = [...g.ordered].sort((a, b) => a.alongStart - b.alongStart);
    const rawSpanStartPct = Math.min(...ordered.map((s) => s.alongStart));
    const rawSpanEndPct = Math.max(...ordered.map((s) => s.alongEnd));
    const spanStartPct = clampToCanonical(rawSpanStartPct);
    const spanEndPct = clampToCanonical(rawSpanEndPct);
    const coveragePct = Math.max(0, spanEndPct - spanStartPct);
    const crossStripPct = ordered.reduce((sum, s) => sum + s.cross, 0) / ordered.length;
    return {
      idx,
      ordered,
      spanStartPct,
      spanEndPct,
      rawSpanStartPct,
      rawSpanEndPct,
      coveragePct,
      crossStripPct,
      candidateType: g.candidateType,
      excludedContainerIds: g.excludedContainerIds,
      chainNotes: g.chainNotes,
    };
  });

  // Reference span: union of ALL additive chains' (single_overall +
  // segmented_chain + local_dimension) clamped spans -- unchanged in
  // spirit from follow-up #4: standalone (missing-geometry) chains still
  // never seed this.
  const referenceStartPct = partial.length ? Math.min(...partial.map((p) => p.spanStartPct)) : 0;
  const referenceEndPct = partial.length ? Math.max(...partial.map((p) => p.spanEndPct)) : 0;

  const additiveChains: BuiltDimensionChain[] = partial.map(
    ({
      idx,
      ordered,
      spanStartPct,
      spanEndPct,
      rawSpanStartPct,
      rawSpanEndPct,
      coveragePct,
      crossStripPct,
      candidateType,
      excludedContainerIds,
      chainNotes,
    }) => {
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
        chainMembership: "additive",
        excludedFromAdditiveChain: null,
        candidateType,
        continuity: candidateType === "segmented_chain" ? "contiguous" : "n/a",
        excludedContainerIds,
        chainNotes,
      };
    },
  );

  const standaloneChains: BuiltDimensionChain[] = geometryMissing.map((m) => {
    const span = standaloneSpanFromBbox(m, axis);
    const rawSpanStartPct = span.alongStart;
    const rawSpanEndPct = span.alongEnd;
    const spanStartPct = clampToCanonical(rawSpanStartPct);
    const spanEndPct = clampToCanonical(rawSpanEndPct);
    const coveragePct = Math.max(0, spanEndPct - spanStartPct);

    const isOverallCandidate =
      partial.length > 0 &&
      coveragePct >= OVERALL_COVERAGE_THRESHOLD_PCT &&
      spanStartPct <= referenceStartPct + EDGE_TOLERANCE_PCT &&
      spanEndPct >= referenceEndPct - EDGE_TOLERANCE_PCT;

    return {
      id: `standalone_${m.id}_${axis[0]}`,
      axis,
      measurementIds: [m.id],
      spanStartPct,
      spanEndPct,
      rawSpanStartPct,
      rawSpanEndPct,
      coveragePct,
      crossStripPct: span.cross,
      isOverallCandidate,
      dominantReferenceTypeHint: m.referenceTypeHint,
      usedLineEndpointsCount: 0,
      chainMembership: "standalone",
      excludedFromAdditiveChain: "missing_line_geometry",
      candidateType: isOverallCandidate ? "single_overall" : "local_dimension",
      continuity: "n/a",
      excludedContainerIds: [],
      chainNotes: [],
    };
  });

  return [...additiveChains, ...standaloneChains];
}

/** Builds chains for both axes from the full measurement list. */
export function buildDimensionChains(measurements: DimensionEvidence[]): BuiltDimensionChain[] {
  return [
    ...buildChainsForAxis(measurements, "horizontal"),
    ...buildChainsForAxis(measurements, "vertical"),
  ];
}


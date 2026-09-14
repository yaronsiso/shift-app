// supabase/functions/_shared/dimension_chain_builder_v3.ts
//
// [Sessions 23 follow-ups #1-#4 header comments unchanged -- carried in
// full in the real delivered file. Summary: geometry (never the model)
// decides chain grouping and overall-candidate status; measurements with
// no drawn line geometry never join an additive chain and are evaluated
// standalone instead.]
//
// SESSION 23 FOLLOW-UP #5: same baseline is not sufficient to sum two
// measurements. A measurement whose own span already envelops >= 2 other
// measurements on the same baseline is pulled out as its own
// "single_overall" candidate (CONTAINMENT). What's left is only grouped
// into one additive chain if it forms a genuine end-to-end partition, no
// large gaps (CONTIGUITY, via ADJACENCY_GAP_TOLERANCE_PCT /
// ADJACENCY_OVERLAP_TOLERANCE_PCT).
//
// SESSION 23 FOLLOW-UP #7 (Yaron's follow-up to the extent-equivalence
// grouping in dimension_chain_resolver_v3.ts / dimension_extent_grouping_v3.ts):
// passing the per-pair adjacency check in rule 2 above is NOT the same as
// being a genuinely complete reading of the physical extent it claims to
// span. ADJACENCY_GAP_TOLERANCE_PCT (3) is deliberately lenient per PAIR
// (to tolerate a wall-thickness tick or a slightly-imprecise endpoint
// reading) -- but a chain with many members can accumulate several such
// "just barely OK" gaps in a row, each individually small enough to pass,
// while the TOTAL unaccounted space adds up to a real, meaningful
// shortfall. Yaron's real-drawing example: an explicit "1669" overall
// dimension line was independently corroborated by a *different*,
// completely gapless 15-segment chain that sums to exactly 1669 -- while a
// *separate* 13-segment chain on another baseline, which LOOKS full-span
// (same projected [start,end] as the 1669 readings), only sums to 1476.5.
// Both chains passed the old per-pair adjacency check; only one of them
// is actually a complete, trustworthy reading of the full extent it
// claims to cover.
//
// THE FIX: every chain now reports:
//   - geometricFillRatio: what fraction of its own raw span is actually
//     covered by its members' own drawn widths (sum of each member's own
//     |end-start|, divided by the chain's raw span width) -- 100% for a
//     single-member chain (nothing else to account for); less than 100%
//     when the members' own segments don't add up to fully cover the
//     space between the chain's first start and last end.
//   - gapCount: how many of the (already adjacency-tolerant) consecutive
//     member pairs have ANY positive gap above a small rounding epsilon
//     (COMPLETENESS_GAP_EPSILON_PCT) -- so even gaps that were small
//     enough to pass the per-pair contiguity check in rule 2 still get
//     counted and reported here.
//   - totalGapPct: the sum of all those gaps.
//   - isCompletePartition: true only when gapCount === 0 AND
//     geometricFillRatio >= COMPLETENESS_FILL_THRESHOLD_PCT (97). Always
//     true for a single-member chain (single_overall or local_dimension)
//     -- there's no internal partition to be incomplete about.
//
// This file only COMPUTES and reports these fields. Whether an incomplete
// segmented_chain is allowed to compete against (create a conflict with)
// an explicit overall reading is decided in dimension_chain_resolver_v3.ts
// / dimension_extent_grouping_v3.ts, not here -- this file stays a pure,
// geometry-only measurement of completeness, same discipline as every
// other field here (candidateType, coveragePct, etc.).

import type { DimensionEvidence } from "./dimension_evidence_schema_v3.ts";

export const STRIP_TOLERANCE_PCT = 4;
export const OVERALL_COVERAGE_THRESHOLD_PCT = 80;
export const EDGE_TOLERANCE_PCT = 16;

export const CONTAINMENT_TOLERANCE_PCT = 3;
export const MIN_CONTAINED_SIBLINGS = 2;
export const ADJACENCY_GAP_TOLERANCE_PCT = 3;
export const ADJACENCY_OVERLAP_TOLERANCE_PCT = 2;

// Session 23 follow-up #7:
export const COMPLETENESS_GAP_EPSILON_PCT = 0.5;
export const COMPLETENESS_FILL_THRESHOLD_PCT = 97;

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
  // NEW (session 23 follow-up #7):
  geometricFillRatio: number;
  gapCount: number;
  totalGapPct: number;
  isCompletePartition: boolean;
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

/**
 * Session 23 follow-up #7: measures how completely a chain's own members
 * account for the space between its first start and last end -- see file
 * header. Trivially complete for a single-member chain.
 */
function computeCompleteness(
  ordered: MeasurementSpan[],
  rawSpanStartPct: number,
  rawSpanEndPct: number,
): { geometricFillRatio: number; gapCount: number; totalGapPct: number; isCompletePartition: boolean } {
  if (ordered.length <= 1) {
    return { geometricFillRatio: 100, gapCount: 0, totalGapPct: 0, isCompletePartition: true };
  }
  let gapCount = 0;
  let totalGapPct = 0;
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].alongStart - ordered[i - 1].alongEnd;
    if (gap > COMPLETENESS_GAP_EPSILON_PCT) {
      gapCount++;
      totalGapPct += gap;
    }
  }
  const memberWidthSum = ordered.reduce((sum, s) => sum + Math.max(0, s.alongEnd - s.alongStart), 0);
  const totalSpan = rawSpanEndPct - rawSpanStartPct;
  const geometricFillRatio = totalSpan > 0 ? Math.min(100, (memberWidthSum / totalSpan) * 100) : 100;
  const isCompletePartition = gapCount === 0 && geometricFillRatio >= COMPLETENESS_FILL_THRESHOLD_PCT;
  return { geometricFillRatio, gapCount, totalGapPct, isCompletePartition };
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
    const completeness = computeCompleteness(ordered, rawSpanStartPct, rawSpanEndPct);
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
      ...completeness,
    };
  });

  const referenceStartPct = partial.length ? Math.min(...partial.map((p) => p.spanStartPct)) : 0;
  const referenceEndPct = partial.length ? Math.max(...partial.map((p) => p.spanEndPct)) : 0;

  const additiveChains: BuiltDimensionChain[] = partial.map((p) => {
    const isOverallCandidate =
      p.coveragePct >= OVERALL_COVERAGE_THRESHOLD_PCT &&
      p.spanStartPct <= referenceStartPct + EDGE_TOLERANCE_PCT &&
      p.spanEndPct >= referenceEndPct - EDGE_TOLERANCE_PCT;

    return {
      id: `chain_${String(p.idx + 1).padStart(2, "0")}_${axis[0]}`,
      axis,
      measurementIds: p.ordered.map((s) => s.measurement.id),
      spanStartPct: p.spanStartPct,
      spanEndPct: p.spanEndPct,
      rawSpanStartPct: p.rawSpanStartPct,
      rawSpanEndPct: p.rawSpanEndPct,
      coveragePct: p.coveragePct,
      crossStripPct: p.crossStripPct,
      isOverallCandidate,
      dominantReferenceTypeHint: dominantReferenceTypeHint(p.ordered),
      usedLineEndpointsCount: p.ordered.filter((s) => s.usedLineEndpoints).length,
      chainMembership: "additive",
      excludedFromAdditiveChain: null,
      candidateType: p.candidateType,
      continuity: p.candidateType === "segmented_chain" ? "contiguous" : "n/a",
      excludedContainerIds: p.excludedContainerIds,
      chainNotes: p.chainNotes,
      geometricFillRatio: p.geometricFillRatio,
      gapCount: p.gapCount,
      totalGapPct: p.totalGapPct,
      isCompletePartition: p.isCompletePartition,
    };
  });

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
      geometricFillRatio: 100,
      gapCount: 0,
      totalGapPct: 0,
      isCompletePartition: true,
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


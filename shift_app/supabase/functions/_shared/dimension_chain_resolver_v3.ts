// supabase/functions/_shared/dimension_chain_resolver_v3.ts
//
// Session 23. Code-side unit conversion + never-average axis resolution,
// built on top of dimension_chain_builder_v3.ts's geometry-based chains.
//
// toMetersV3 -- unit conversion, unchanged from earlier sessions: a
// measurement's own `unit` is used when known; only "length"
// referenceTypeHints (building/room/wall/opening) are ever converted;
// "area"/"elevation" never are.
//
// SESSION 23 FOLLOW-UP #6 (Yaron's review of the follow-up #5 run):
// resolveAuthoritativeExtentV3 no longer treats every isOverallCandidate
// chain as directly comparable to every other one on its axis. Two
// candidates can only corroborate or conflict with each other if they
// measure the SAME physical extent -- decided purely geometrically (their
// projected spans match within tolerance), via
// dimension_extent_grouping_v3.ts's groupOverallCandidatesByExtent. See
// that file's header for the full reasoning (the real-drawing run showed
// "1669" read twice, independently, from two different strip crops --
// that should corroborate to one strengthened 16.69m reading, not create
// ambiguity; while a *different* candidate at a *different* projected
// extent must never block that resolution just because it also happens
// to reach high page coverage).
//
// A group of geometrically-equivalent candidates that all agree
// numerically resolves (and gets a confidence boost from having >=2
// independent readings). A group that disagrees numerically is a genuine
// conflict -- valueM: null, same as before, still never averaged. Groups
// at different (non-equivalent) extents never interact: one group
// resolving does not require every other group to also agree, and one
// group conflicting does not block a different, agreeing group.
//
// If more than one DISTINCT extent group both resolve (agree) with
// different values, that is reported as unresolved rather than silently
// picking one -- there is no geometric basis to prefer one extent over
// another as "the" building envelope without further evidence.

// SESSION 23 FOLLOW-UP #7 (Yaron's follow-up): a candidate chain reaching
// the coverage/edge bar (isOverallCandidate) is still not automatically
// eligible to compete for/against an extent group. Only a chain that is a
// COMPLETE partition (dimension_chain_builder_v3.ts's isCompletePartition
// -- always true for a single measurement, only sometimes true for a
// multi-member segmented_chain) may join grouping at all. An incomplete
// one (many small, individually-tolerated gaps whose sum is a real
// shortfall) is reported in candidateDebug as ineligible, with its own
// fill-ratio/gap diagnostics, but never allowed to drag a genuine,
// complete reading into a false conflict.

import type {
  Confidence,
  DimensionEvidence,
  DocumentMeasurementConvention,
  ReferenceTypeHint,
} from "./dimension_evidence_schema_v3.ts";
import {
  buildDimensionChains,
  COMPLETENESS_FILL_THRESHOLD_PCT,
  EDGE_TOLERANCE_PCT,
  OVERALL_COVERAGE_THRESHOLD_PCT,
  type BuiltDimensionChain,
} from "./dimension_chain_builder_v3.ts";
import {
  groupOverallCandidatesByExtent,
  type ExtentGroup,
  type OverallCandidateForGrouping,
} from "./dimension_extent_grouping_v3.ts";

export interface NormalizedMeasurementV3 extends DimensionEvidence {
  valueM: number | null;
}

export interface OverallCandidateDebug {
  chainId: string;
  candidateType: string;
  valueM: number | null;
  projectedStart: number;
  projectedEnd: number;
  coveragePct: number;
  evidenceChainIds: string[];
  extentGroupId: string;
  extentRelation: "same" | "different" | "unknown";
  accepted: boolean;
  reason: string;
  // NEW (session 23 follow-up #7):
  geometricFillRatio: number;
  gapCount: number;
  totalGapPct: number;
  isCompletePartition: boolean;
}

export interface ResolvedExtentV3 {
  axis: "horizontal" | "vertical";
  valueM: number | null;
  confidence: Confidence;
  sourceChainIds: string[];
  status: "resolved" | "conflict" | "missing" | "unresolved";
  diagnostics: string[];
  // NEW (session 23 follow-up #6):
  extentGroups: ExtentGroup[];
  candidateDebug: OverallCandidateDebug[];
}

export function isLengthType(hint: ReferenceTypeHint): boolean {
  return hint === "building" || hint === "room" || hint === "wall" || hint === "opening";
}

export function toMetersV3(
  m: DimensionEvidence,
  convention: DocumentMeasurementConvention,
): number | null {
  if (m.rawNumeric == null || !Number.isFinite(m.rawNumeric)) return null;
  if (!isLengthType(m.referenceTypeHint)) return null;

  const unit = m.unit !== "unknown" ? m.unit : convention.detectedUnit;
  if (unit === "unknown") return null;

  switch (unit) {
    case "mm":
      return m.rawNumeric / 1000;
    case "cm":
      return m.rawNumeric / 100;
    case "m":
      return m.rawNumeric;
  }
}

export function normalizeMeasurementsV3(
  measurements: DimensionEvidence[],
  convention: DocumentMeasurementConvention,
): NormalizedMeasurementV3[] {
  return measurements.map((m) => ({ ...m, valueM: toMetersV3(m, convention) }));
}

function confidenceRank(c: Confidence): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

function chainConfidence(
  chain: BuiltDimensionChain,
  byId: Map<string, DimensionEvidence>,
): Confidence {
  let worst: Confidence = "high";
  let worstRank = 3;
  for (const id of chain.measurementIds) {
    const m = byId.get(id);
    if (!m) continue;
    const rank = confidenceRank(m.confidence);
    if (rank < worstRank) {
      worstRank = rank;
      worst = m.confidence;
    }
  }
  return worst;
}

function chainValueM(
  chain: BuiltDimensionChain,
  byId: Map<string, DimensionEvidence>,
  convention: DocumentMeasurementConvention,
): number | null {
  const values = chain.measurementIds.map((id) => {
    const m = byId.get(id);
    return m ? toMetersV3(m, convention) : null;
  });
  const allConvertible = values.every((v): v is number => v != null && Number.isFinite(v));
  return allConvertible ? (values.reduce((a, b) => (a as number) + (b as number), 0) as number) : null;
}

/**
 * Resolves ONE building-wide extent for an axis. See file header
 * (session 23 follow-up #6): candidates are first grouped by projected
 * extent, and only compared for agreement/conflict WITHIN a group.
 */
export function resolveAuthoritativeExtentV3(
  measurements: DimensionEvidence[],
  convention: DocumentMeasurementConvention,
  axis: "horizontal" | "vertical",
): ResolvedExtentV3 {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  const allChains = buildDimensionChains(measurements).filter((c) => c.axis === axis);
  const allCandidateChains = allChains.filter((c) => c.isOverallCandidate);
  // Session 23 follow-up #7: passing the coverage/edge test is not enough
  // to compete against another candidate for the same extent -- only a
  // COMPLETE partition (or a trivially-complete single measurement) may.
  // An incomplete segmented_chain (small tolerated gaps adding up to a
  // real shortfall -- see dimension_chain_builder_v3.ts's file header) is
  // still reported, but never allowed to create a conflict or dilute an
  // agreeing group.
  const candidateChains = allCandidateChains.filter((c) => c.isCompletePartition);
  const incompleteChains = allCandidateChains.filter((c) => !c.isCompletePartition);

  if (candidateChains.length === 0) {
    return {
      axis,
      valueM: null,
      confidence: "low",
      sourceChainIds: [],
      status: "missing",
      diagnostics: [
        `No ${axis} chain reached overall-envelope coverage as a COMPLETE partition ` +
        `(needs >= ${OVERALL_COVERAGE_THRESHOLD_PCT}% of the page, both ends within ` +
        `${EDGE_TOLERANCE_PCT}% of the far edges of the combined dimensioned extent, and ` +
        `>= ${COMPLETENESS_FILL_THRESHOLD_PCT}% geometric fill with no internal gaps).`,
        ...allChains.map((c) =>
          `${c.id}: coverage=${c.coveragePct.toFixed(1)}% span=[${c.spanStartPct.toFixed(1)},${
            c.spanEndPct.toFixed(1)
          }] fillRatio=${c.geometricFillRatio.toFixed(1)}% gaps=${c.gapCount} members=${c.measurementIds.join(",")}${
            c.excludedFromAdditiveChain ? ` (excluded_from_additive_chain: ${c.excludedFromAdditiveChain})` : ""
          }${c.isOverallCandidate && !c.isCompletePartition ? " (INCOMPLETE partition -- not eligible)" : ""}`
        ),
      ],
      extentGroups: [],
      candidateDebug: [],
    };
  }

  const forGrouping: OverallCandidateForGrouping[] = candidateChains.map((c) => ({
    chainId: c.id,
    candidateType: c.candidateType,
    valueM: chainValueM(c, byId, convention),
    spanStartPct: c.spanStartPct,
    spanEndPct: c.spanEndPct,
    coveragePct: c.coveragePct,
    confidence: chainConfidence(c, byId),
  }));

  const groups = groupOverallCandidatesByExtent(forGrouping, axis);
  const groupByChainId = new Map<string, ExtentGroup>();
  for (const g of groups) for (const cid of g.memberChainIds) groupByChainId.set(cid, g);

  const conflictGroups = groups.filter((g) => g.agreement === "conflict");
  // "Strength" ranks candidate groups so a lone, uncorroborated candidate
  // at some other extent (e.g. a large internal chain that happens to
  // reach high coverage without ever being compared/contained against the
  // real overall line -- follow-up #5's containment check only applies
  // within a single baseline) can never silently outrank or block a
  // properly corroborated (>=2 independent, agreeing) reading. It's still
  // never silently discarded either: it only loses when something
  // stronger exists; two equally-strong, differently-valued groups still
  // correctly produce "unresolved" rather than a guess.
  function strength(g: ExtentGroup): number {
    if (g.agreement === "agree") return g.independentObservationCount;
    if (g.agreement === "single" && g.resolvedValueM != null) return 1;
    return 0;
  }
  const rankedGroups = groups.filter((g) => strength(g) > 0);
  const maxStrength = rankedGroups.length ? Math.max(...rankedGroups.map(strength)) : 0;
  const topGroups = rankedGroups.filter((g) => strength(g) === maxStrength);

  let status: ResolvedExtentV3["status"];
  let valueM: number | null = null;
  let confidence: Confidence = "low";
  let sourceChainIds: string[] = [];
  const diagnostics: string[] = [];
  let winningGroupId: string | null = null;

  if (topGroups.length === 1) {
    const g = topGroups[0];
    status = "resolved";
    valueM = g.resolvedValueM;
    confidence = g.confidence;
    sourceChainIds = g.memberChainIds;
    winningGroupId = g.groupId;
    diagnostics.push(
      `Resolved ${axis} extent from extent group ${g.groupId} (${g.memberChainIds.join(",")}): ${valueM!.toFixed(4)}m, ` +
      `${g.independentObservationCount} independent observation(s) agreeing. No averaging used.`,
    );
    for (const other of groups) {
      if (other.groupId === g.groupId) continue;
      diagnostics.push(
        `Note: extent group ${other.groupId} at a DIFFERENT projected extent [${other.projectedStart.toFixed(1)},${
          other.projectedEnd.toFixed(1)
        }] (${other.agreement}, strength ${strength(other)}) does not affect this result -- weaker or a different extent.`,
      );
    }
  } else if (topGroups.length > 1) {
    status = "unresolved";
    diagnostics.push(
      `Found ${topGroups.length} equally-strong extent groups on the ${axis} axis at DIFFERENT projected extents -- ` +
      `no geometric basis to prefer one over the other. No value chosen.`,
    );
    for (const g of topGroups) {
      diagnostics.push(
        `${g.groupId} span=[${g.projectedStart.toFixed(1)},${g.projectedEnd.toFixed(1)}]: ${
          g.resolvedValueM!.toFixed(4)
        }m (${g.independentObservationCount} observation(s))`,
      );
    }
  } else if (conflictGroups.length > 0) {
    status = "conflict";
    diagnostics.push(`Conflicting ${axis} overall chains at the same projected extent; no averaging performed.`);
    for (const g of conflictGroups) {
      diagnostics.push(
        `${g.groupId} span=[${g.projectedStart.toFixed(1)},${g.projectedEnd.toFixed(1)}]: ` +
        g.memberChainIds
          .map((cid) => {
            const c = forGrouping.find((f) => f.chainId === cid)!;
            return `${cid}=${c.valueM != null ? c.valueM.toFixed(4) + "m" : "unconvertible"}`;
          })
          .join(", "),
      );
    }
  } else {
    status = "unresolved";
    diagnostics.push(
      `Found ${axis} chain(s) with overall-envelope coverage, but could not convert their measurements to meters ` +
      `(unknown unit with no usable document convention, or a non-length referenceTypeHint).`,
    );
  }

  const chainById = new Map(allCandidateChains.map((c) => [c.id, c]));

  const candidateDebug: OverallCandidateDebug[] = forGrouping.map((c) => {
    const g = groupByChainId.get(c.chainId)!;
    const chain = chainById.get(c.chainId)!;
    const accepted = winningGroupId != null && g.groupId === winningGroupId;
    const extentRelation: OverallCandidateDebug["extentRelation"] =
      winningGroupId == null ? "unknown" : g.groupId === winningGroupId ? "same" : "different";
    const reason = accepted
      ? `Part of resolved extent group ${g.groupId} (${g.agreement}, ${g.independentObservationCount} observation(s)).`
      : g.agreement === "conflict"
      ? `In extent group ${g.groupId}, which disagrees internally -- not used.`
      : winningGroupId
      ? `Measures a different projected extent than the resolved group ${winningGroupId} -- not compared.`
      : `No resolved extent group on this axis yet.`;
    return {
      chainId: c.chainId,
      candidateType: c.candidateType,
      valueM: c.valueM,
      projectedStart: c.spanStartPct,
      projectedEnd: c.spanEndPct,
      coveragePct: c.coveragePct,
      evidenceChainIds: [c.chainId],
      extentGroupId: g.groupId,
      extentRelation,
      accepted,
      reason,
      geometricFillRatio: chain.geometricFillRatio,
      gapCount: chain.gapCount,
      totalGapPct: chain.totalGapPct,
      isCompletePartition: chain.isCompletePartition,
    };
  });

  // Incomplete candidates never entered grouping at all -- still reported
  // for visibility, always rejected, never counted as "different extent"
  // (that would wrongly imply they were compared and lost on geometry
  // grounds, when really they were never eligible to compete in the
  // first place).
  for (const c of incompleteChains) {
    diagnostics.push(
      `${c.id}: reached overall-envelope coverage (${c.coveragePct.toFixed(1)}%, span=[${
        c.spanStartPct.toFixed(1)
      },${c.spanEndPct.toFixed(1)}]) but is an INCOMPLETE partition -- fillRatio=${
        c.geometricFillRatio.toFixed(1)
      }% (needs >= ${COMPLETENESS_FILL_THRESHOLD_PCT}%), gapCount=${c.gapCount}, totalGap=${
        c.totalGapPct.toFixed(1)
      }%. Not eligible to compete against another reading of this extent.`,
    );
    candidateDebug.push({
      chainId: c.id,
      candidateType: c.candidateType,
      valueM: chainValueM(c, byId, convention),
      projectedStart: c.spanStartPct,
      projectedEnd: c.spanEndPct,
      coveragePct: c.coveragePct,
      evidenceChainIds: [c.id],
      extentGroupId: "n/a",
      extentRelation: "unknown",
      accepted: false,
      reason: `Incomplete partition (fillRatio=${c.geometricFillRatio.toFixed(1)}%, gapCount=${c.gapCount}) -- ` +
        `not eligible to compete against an explicit or complete overall reading.`,
      geometricFillRatio: c.geometricFillRatio,
      gapCount: c.gapCount,
      totalGapPct: c.totalGapPct,
      isCompletePartition: c.isCompletePartition,
    });
  }

  return { axis, valueM, confidence, sourceChainIds, status, diagnostics, extentGroups: groups, candidateDebug };
}


// supabase/functions/_shared/dimension_extent_grouping_v3.ts
//
// Session 23 follow-up #6 (Yaron's review of the follow-up #5 run): being
// "an overall candidate" (near-full-page coverage, edges near the
// reference span) is not enough to decide two candidates are measuring
// the SAME physical extent, and it is not enough to decide two candidates
// that both qualify are in genuine conflict either. Two more distinctions
// matter:
//
//   1. CORROBORATION: two independent overall candidates that measure the
//      SAME projected extent (their spans are geometrically equivalent --
//      within ANCHOR_TOLERANCE_PCT on both start and end) and AGREE
//      numerically should strengthen each other, not create ambiguity.
//      The real-drawing run read "1669" twice, completely independently
//      (once from the top-strip crop, once from the bottom-strip crop),
//      landing on two slightly different chains with nearly identical
//      spans. That is two independent observations of the same physical
//      dimension line, not two competing candidates.
//
//   2. EXTENT EQUIVALENCE GATES CONFLICT: a candidate can only be in
//      conflict with another candidate if they measure the SAME physical
//      extent. Same orientation, similar coverage, or even the same
//      cross-axis baseline are NOT sufficient on their own -- only
//      matching projected start/end anchors (within ANCHOR_TOLERANCE_PCT)
//      make two candidates comparable at all. A candidate whose anchors
//      don't match anything else's is evaluated on its own; it is never
//      silently chosen as "the" answer, and it never blocks a different,
//      internally-agreeing extent group either.
//
// This module ONLY groups and compares already-computed overall
// candidates (each with its own valueM already converted by the caller,
// via dimension_chain_resolver_v3.ts's toMetersV3 -- this module doesn't
// touch units or geometry itself). It never averages disagreeing values
// within a group; a group with disagreeing convertible values is reported
// as agreement:"conflict" with resolvedValueM: null, same discipline as
// every other file in this pipeline.

import type { Confidence } from "./dimension_evidence_schema_v3.ts";

export const ANCHOR_TOLERANCE_PCT = 3;
export const VALUE_AGREEMENT_TOLERANCE_PCT = 2.0;

export type ExtentAgreement = "agree" | "conflict" | "single";

export interface OverallCandidateForGrouping {
  chainId: string;
  candidateType: string;
  valueM: number | null;
  spanStartPct: number;
  spanEndPct: number;
  coveragePct: number;
  confidence: Confidence;
}

export interface ExtentGroup {
  groupId: string;
  axis: "horizontal" | "vertical";
  memberChainIds: string[];
  projectedStart: number;
  projectedEnd: number;
  agreement: ExtentAgreement;
  resolvedValueM: number | null;
  independentObservationCount: number;
  confidence: Confidence;
}

function confidenceRank(c: Confidence): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
function rankToConfidence(r: number): Confidence {
  return r >= 3 ? "high" : r >= 2 ? "medium" : "low";
}
function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

/**
 * Clusters overall candidates into extent groups by anchor proximity
 * (union-find: two candidates join the same group if their projected
 * start AND end are both within ANCHOR_TOLERANCE_PCT of each other --
 * transitively, so a chain of near-identical spans still forms one
 * group even if the two most-different members in it wouldn't pair up
 * directly). Then decides, per group, whether the members' converted
 * values agree, conflict, or there's only one to judge.
 */
export function groupOverallCandidatesByExtent(
  candidates: OverallCandidateForGrouping[],
  axis: "horizontal" | "vertical",
): ExtentGroup[] {
  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = candidates[i], b = candidates[j];
      if (
        Math.abs(a.spanStartPct - b.spanStartPct) <= ANCHOR_TOLERANCE_PCT &&
        Math.abs(a.spanEndPct - b.spanEndPct) <= ANCHOR_TOLERANCE_PCT
      ) {
        union(i, j);
      }
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(i);
  }

  const groups: ExtentGroup[] = [];
  let idx = 0;
  for (const memberIdxs of byRoot.values()) {
    idx++;
    const members = memberIdxs.map((i) => candidates[i]);
    const projectedStart = members.reduce((s, c) => s + c.spanStartPct, 0) / members.length;
    const projectedEnd = members.reduce((s, c) => s + c.spanEndPct, 0) / members.length;
    const convertible = members.filter((c): c is OverallCandidateForGrouping & { valueM: number } => c.valueM != null);

    let agreement: ExtentAgreement;
    let resolvedValueM: number | null = null;
    let confidence: Confidence = "low";

    if (convertible.length === 0) {
      agreement = "single"; // nothing to compare; unresolved value, not a claimed conflict
    } else if (convertible.length === 1) {
      agreement = "single";
      resolvedValueM = convertible[0].valueM;
      confidence = convertible[0].confidence;
    } else {
      const reference = [...convertible].sort(
        (a, b) => b.coveragePct - a.coveragePct || confidenceRank(b.confidence) - confidenceRank(a.confidence),
      )[0];
      const disagreeing = convertible.filter((c) => pctDiff(c.valueM, reference.valueM) > VALUE_AGREEMENT_TOLERANCE_PCT);
      if (disagreeing.length === 0) {
        agreement = "agree";
        resolvedValueM = reference.valueM;
        // Corroboration: >=2 independent chains landing on the same
        // physical extent with agreeing values is stronger evidence than
        // any single one of them, regardless of their individual
        // confidence tags.
        confidence = rankToConfidence(Math.max(3, confidenceRank(reference.confidence)));
      } else {
        agreement = "conflict";
        resolvedValueM = null;
        confidence = "low";
      }
    }

    groups.push({
      groupId: `${axis[0]}group_${String(idx).padStart(2, "0")}`,
      axis,
      memberChainIds: members.map((m) => m.chainId),
      projectedStart,
      projectedEnd,
      agreement,
      resolvedValueM,
      independentObservationCount: convertible.length,
      confidence,
    });
  }

  return groups;
}


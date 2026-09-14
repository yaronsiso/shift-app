// supabase/functions/_shared/axis_extent_resolver.ts
//
// Pure, code-side resolution of ONE building-axis's authoritative extent
// from a set of Pass 0.5 DimensionChains — extracted out of
// analyze-sketch-v2-envelope/index.ts (session 22) so this specific logic
// can be independently unit-tested (see
// validate_envelope_axis_resolution_test.mjs), the same way
// page_dimensions_schema.ts's chain-validation logic already is.
//
// SESSION 22 FIX ("Patch 01 — Measurement Integrity"): the previous version
// of this logic (inline in analyze-sketch-v2-envelope/index.ts) AVERAGED
// every same-axis chain's total regardless of whether they agreed — e.g. a
// chain reading 16.00m and another reading 17.80m silently became 16.90m,
// a number that never appeared anywhere in the drawing. For mm-grade
// reconstruction that is unacceptable: averaging manufactures a number, it
// doesn't resolve a disagreement. Found in an architecture audit,
// independently confirmed by reading the deployed code. Now: disagreement
// beyond CROSS_CHAIN_CONFLICT_THRESHOLD_PCT is a CONFLICT — the axis
// resolves to no authoritative value at all (extent stays null, same as
// "no measurement found"), and the conflicting numbers are returned
// separately so callers can surface them instead of hiding them.

import type { DimensionChain } from "./dimension_extraction_schema.ts";

export type Confidence = "high" | "medium" | "low";

export interface ResolvedAxisExtent {
  valueM: number;
  confidence: Confidence;
  chainCount: number;
}

// extent !== null            -> a single, trusted value was resolved.
// extent === null, conflict  -> credible chains disagreed; NOTHING is used
//                                as authoritative (never averaged).
//                                `conflict` lists the disagreeing values.
// extent === null, no conflict -> no usable chain existed for this axis.
export interface AxisResolution {
  extent: ResolvedAxisExtent | null;
  conflict: string[] | null;
}

// Disagreement beyond this (relative, percent, between the best candidate
// and any other candidate chain) makes the axis a conflict rather than a
// resolved value. Deliberately tight — "still use it, just downgrade
// confidence" at a similar threshold was exactly the defect being fixed.
export const CROSS_CHAIN_CONFLICT_THRESHOLD_PCT = 2;

export function resolveChainTotalM(chain: DimensionChain): number {
  if (chain.overallValueM !== null && Number.isFinite(chain.overallValueM)) {
    return chain.overallValueM;
  }
  return chain.segments.reduce((sum, seg) => sum + (Number.isFinite(seg.valueM) ? seg.valueM : 0), 0);
}

function confidenceRank(c: Confidence): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

// Picks the single most-trustworthy chain (an explicit printed overall
// total outranks a segment-sum; higher per-chain confidence breaks further
// ties) and only accepts it if every other candidate chain on the same
// axis agrees with it within tolerance. Never blends multiple numbers into
// one — see the file header for why.
export function resolveAxisExtent(
  chains: DimensionChain[],
  axis: "horizontal" | "vertical",
): AxisResolution {
  const axisChains = chains.filter((c) => c.axis === axis && (c.segments.length > 0 || c.overallValueM !== null));
  if (axisChains.length === 0) return { extent: null, conflict: null };

  const candidates = axisChains
    .map((chain) => ({ chain, valueM: resolveChainTotalM(chain) }))
    .filter((c) => Number.isFinite(c.valueM) && c.valueM > 0);
  if (candidates.length === 0) return { extent: null, conflict: null };

  candidates.sort((a, b) => {
    const aExplicit = a.chain.overallValueM !== null ? 1 : 0;
    const bExplicit = b.chain.overallValueM !== null ? 1 : 0;
    if (aExplicit !== bExplicit) return bExplicit - aExplicit;
    return confidenceRank(b.chain.confidence) - confidenceRank(a.chain.confidence);
  });

  const best = candidates[0];
  const disagreeing = candidates
    .slice(1)
    .filter((c) => pctDiff(c.valueM, best.valueM) > CROSS_CHAIN_CONFLICT_THRESHOLD_PCT);

  if (disagreeing.length > 0) {
    const allDescriptions = candidates.map(
      (c) => `${c.chain.location || c.chain.id}: ${c.valueM.toFixed(2)}מ' (ביטחון ${c.chain.confidence})`,
    );
    return { extent: null, conflict: allDescriptions };
  }

  return {
    extent: { valueM: best.valueM, confidence: best.chain.confidence, chainCount: candidates.length },
    conflict: null,
  };
}

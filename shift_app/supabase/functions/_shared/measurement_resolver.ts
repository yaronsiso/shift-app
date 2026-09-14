// supabase/functions/_shared/measurement_resolver.ts
//
// Code-side logic that consumes page_dimensions_schema_v2.ts's raw
// evidence — session 22, "Patch 01: Measurement Integrity" (see that
// file's header for full provenance). Pure functions, no I/O, so they're
// independently unit-tested rather than only exercised through a live
// OpenAI call — see validate_measurement_resolver_test.mjs.
//
// Three responsibilities, each a pure function:
//   toMeters / normalizeMeasurements — mm/cm/m -> m conversion, done ONLY
//     here, never by the model (a "unknown" unit stays unconverted/null —
//     see toMeters below — so a bare ambiguous number can never quietly
//     become authoritative).
//   validateChain — does one chain's printed overall total agree with the
//     sum of its own segments? Reports match/contradiction, never
//     silently corrects.
//   resolveAuthoritativeExtent — the fix this patch exists for: picks ONE
//     building-wide horizontal/vertical extent from the candidate
//     overall_building chains, and NEVER averages disagreeing ones. See
//     its own doc comment below.

import type {
  Axis,
  Confidence,
  DimensionChain,
  PageDimensionEvidence,
  RawMeasurement,
} from "./page_dimensions_schema_v2.ts";

export interface NormalizedMeasurement extends RawMeasurement {
  valueM: number | null;
}

export interface ChainValidation {
  chainId: string;
  segmentSumM: number | null;
  overallM: number | null;
  diffPct: number | null;
  status: "match" | "contradiction" | "not_checkable";
}

export interface ResolvedExtent {
  axis: "horizontal" | "vertical";
  valueM: number | null;
  confidence: Confidence;
  sourceChainIds: string[];
  status: "resolved" | "conflict" | "missing";
  diagnostics: string[];
}

const CHAIN_TOLERANCE_PCT = 1.5;
const CROSS_CHAIN_TOLERANCE_PCT = 2.0;

export function toMeters(m: RawMeasurement): number | null {
  if (m.rawNumeric == null || !Number.isFinite(m.rawNumeric)) return null;
  switch (m.unit) {
    case "mm": return m.rawNumeric / 1000;
    case "cm": return m.rawNumeric / 100;
    case "m": return m.rawNumeric;
    default: return null;
  }
}

export function normalizeMeasurements(evidence: PageDimensionEvidence): NormalizedMeasurement[] {
  return evidence.measurements.map((m) => ({ ...m, valueM: toMeters(m) }));
}

function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

export function validateChain(
  chain: DimensionChain,
  byId: Map<string, NormalizedMeasurement>,
): ChainValidation {
  const segmentValues = chain.segmentMeasurementIds
    .map((id) => byId.get(id)?.valueM ?? null)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const segmentSumM = segmentValues.length === chain.segmentMeasurementIds.length && segmentValues.length > 0
    ? segmentValues.reduce((a, b) => a + b, 0)
    : null;

  const overallM = chain.overallMeasurementId
    ? (byId.get(chain.overallMeasurementId)?.valueM ?? null)
    : null;

  if (segmentSumM == null || overallM == null) {
    return { chainId: chain.id, segmentSumM, overallM, diffPct: null, status: "not_checkable" };
  }

  const diffPct = pctDiff(segmentSumM, overallM);
  return {
    chainId: chain.id,
    segmentSumM,
    overallM,
    diffPct,
    status: diffPct <= CHAIN_TOLERANCE_PCT ? "match" : "contradiction",
  };
}

function confidenceRank(c: Confidence): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

/**
 * Resolves ONE building-wide extent for an axis.
 * Critical rule: NEVER average contradictory chains.
 * If multiple credible overall chains disagree, return conflict and stop
 * geometry from treating either number as authoritative.
 */
export function resolveAuthoritativeExtent(
  evidence: PageDimensionEvidence,
  axis: "horizontal" | "vertical",
): ResolvedExtent {
  const normalized = normalizeMeasurements(evidence);
  const byId = new Map(normalized.map((m) => [m.id, m]));

  const candidateChains = evidence.chains.filter((c) =>
    c.axis === axis &&
    c.referenceType === "overall_building" &&
    (c.level === "overall" || c.level === "secondary")
  );

  if (candidateChains.length === 0) {
    return {
      axis, valueM: null, confidence: "low", sourceChainIds: [], status: "missing",
      diagnostics: [`No overall_building ${axis} dimension chain was extracted.`],
    };
  }

  const candidates = candidateChains.map((chain) => {
    const validation = validateChain(chain, byId);
    const explicitOverall = chain.overallMeasurementId
      ? byId.get(chain.overallMeasurementId)?.valueM ?? null
      : null;

    const segmentSum = validation.segmentSumM;
    const valueM = explicitOverall ?? segmentSum;

    // Contradictory chain is never authoritative.
    const usable = valueM != null && validation.status !== "contradiction";
    const explicitBonus = explicitOverall != null ? 10 : 0;
    const validationBonus = validation.status === "match" ? 5 : 0;
    const score = usable ? explicitBonus + validationBonus + confidenceRank(chain.confidence) : -1;
    return { chain, validation, valueM, usable, score };
  });

  const usable = candidates.filter((c) => c.usable && c.valueM != null);
  if (usable.length === 0) {
    return {
      axis, valueM: null, confidence: "low", sourceChainIds: candidateChains.map((c) => c.id),
      status: "conflict",
      diagnostics: candidates.map((c) =>
        `${c.chain.id}: unusable (${c.validation.status}), overall=${c.validation.overallM}, sum=${c.validation.segmentSumM}`
      ),
    };
  }

  usable.sort((a, b) => b.score - a.score);
  const best = usable[0];

  // Compare every other credible candidate to the best. Never average.
  const disagreements = usable.slice(1).filter((c) =>
    c.valueM != null && best.valueM != null && pctDiff(c.valueM, best.valueM) > CROSS_CHAIN_TOLERANCE_PCT
  );

  if (disagreements.length > 0) {
    return {
      axis,
      valueM: null,
      confidence: "low",
      sourceChainIds: usable.map((c) => c.chain.id),
      status: "conflict",
      diagnostics: [
        `Conflicting ${axis} overall dimensions; no averaging performed.`,
        ...usable.map((c) => `${c.chain.id}=${c.valueM?.toFixed(4)}m (${c.validation.status})`),
      ],
    };
  }

  return {
    axis,
    valueM: best.valueM!,
    confidence: best.chain.confidence,
    sourceChainIds: usable.map((c) => c.chain.id),
    status: "resolved",
    diagnostics: [
      `Resolved ${axis} extent from ${best.chain.id}: ${best.valueM!.toFixed(4)}m.`,
      `No averaging used. ${usable.length} compatible candidate chain(s).`,
    ],
  };
}

// supabase/functions/_shared/dimension_chain_resolver_v3.ts
//
// Session 23. Code-side unit conversion + never-average axis resolution,
// built on top of dimension_chain_builder_v3.ts's geometry-based chains.
// Replaces measurement_resolver.ts (deleted — nothing else depended on
// it). Pure functions, no I/O — see validate_dimension_chain_resolver_v3.mjs
// for the standalone tests, including the three conditions Yaron required
// before touching Stage 1: horizontal overall 1669->16.69m resolves,
// vertical overall 1099->10.99m resolves, 274 never gets selected as
// either axis's overall value, and disagreeing chains are never averaged.
//
// toMetersV3 — unit conversion, and where it deliberately refuses to
// convert:
//   - A measurement's own `unit` is used when the model marked it as
//     anything other than "unknown". Only when the model genuinely
//     couldn't tell does code fall back to the page-wide
//     DocumentMeasurementConvention.detectedUnit (itself just evidence the
//     model reported, not a decision — see dimension_evidence_schema_v3.ts).
//   - Only "length" referenceTypeHints (building/room/wall/opening) are
//     ever converted here. "area" (e.g. "13.20" meaning m², a totally
//     different unit family) and "elevation" (e.g. "+304.50", a level
//     marker, not a wall length) are excluded on purpose — converting them
//     as if they were lengths is exactly the kind of silent
//     misclassification-to-fabrication this file exists to prevent.
//
// resolveAuthoritativeExtentV3 — only considers chains the chain-builder
// already flagged isOverallCandidate (a geometric fact: does this chain's
// span cover ~the whole combined dimensioned extent on its axis, reaching
// both its far edges — see dimension_chain_builder_v3.ts's file header for
// the session-23-follow-up-#2 fix that made this adaptive to a drawing's
// own margin instead of the literal page 0-100). Among those, if more than
// one is usable and they disagree beyond tolerance, the result is
// `status: "conflict"` with valueM: null — NEVER an average.

import type {
  Confidence,
  DimensionEvidence,
  DocumentMeasurementConvention,
  ReferenceTypeHint,
} from "./dimension_evidence_schema_v3.ts";
import {
  buildDimensionChains,
  EDGE_TOLERANCE_PCT,
  OVERALL_COVERAGE_THRESHOLD_PCT,
  type BuiltDimensionChain,
} from "./dimension_chain_builder_v3.ts";

export interface NormalizedMeasurementV3 extends DimensionEvidence {
  valueM: number | null;
}

export interface ResolvedExtentV3 {
  axis: "horizontal" | "vertical";
  valueM: number | null;
  confidence: Confidence;
  sourceChainIds: string[];
  status: "resolved" | "conflict" | "missing" | "unresolved";
  diagnostics: string[];
}

const CROSS_CHAIN_TOLERANCE_PCT = 2.0;

// Exported (session 23, follow-up #3) so document_unit_convention_resolver.ts
// can filter to the exact same population this file's toMetersV3 will ever
// actually convert -- "area" and "elevation" measurements must never
// influence unit-convention inference any more than they're allowed to
// influence a resolved extent.
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
  // A chain is only as trustworthy as its weakest member.
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

function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

/**
 * Resolves ONE building-wide extent for an axis from geometry-flagged
 * overall-candidate chains only. Critical rule, unchanged from Patch 01:
 * NEVER average contradictory chains.
 */
export function resolveAuthoritativeExtentV3(
  measurements: DimensionEvidence[],
  convention: DocumentMeasurementConvention,
  axis: "horizontal" | "vertical",
): ResolvedExtentV3 {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  const allChains = buildDimensionChains(measurements).filter((c) => c.axis === axis);
  const candidateChains = allChains.filter((c) => c.isOverallCandidate);

  if (candidateChains.length === 0) {
    return {
      axis,
      valueM: null,
      confidence: "low",
      sourceChainIds: [],
      status: "missing",
      diagnostics: [
        `No ${axis} chain reached overall-envelope coverage ` +
        `(needs >= ${OVERALL_COVERAGE_THRESHOLD_PCT}% of the page and both ends within ` +
        `${EDGE_TOLERANCE_PCT}% of the far edges of the combined dimensioned extent on this axis).`,
        ...allChains.map((c) =>
          `${c.id}: coverage=${c.coveragePct.toFixed(1)}% span=[${c.spanStartPct.toFixed(1)},${
            c.spanEndPct.toFixed(1)
          }] members=${c.measurementIds.join(",")}`
        ),
      ],
    };
  }

  const scored = candidateChains.map((chain) => {
    const values = chain.measurementIds.map((id) => {
      const m = byId.get(id);
      return m ? toMetersV3(m, convention) : null;
    });
    const allConvertible = values.every((v): v is number => v != null && Number.isFinite(v));
    const valueM = allConvertible ? values.reduce((a, b) => (a as number) + (b as number), 0) as number : null;
    return { chain, valueM, confidence: chainConfidence(chain, byId) };
  });

  const usable = scored.filter((s) => s.valueM != null);
  if (usable.length === 0) {
    return {
      axis,
      valueM: null,
      confidence: "low",
      sourceChainIds: candidateChains.map((c) => c.id),
      status: "unresolved",
      diagnostics: [
        `Found ${axis} chain(s) with overall-envelope coverage, but could not convert ` +
        `their measurements to meters (unknown unit with no usable document convention, ` +
        `or a non-length referenceTypeHint).`,
        ...candidateChains.map((c) => `${c.id}: members=${c.measurementIds.join(",")}`),
      ],
    };
  }

  usable.sort((a, b) =>
    b.chain.coveragePct - a.chain.coveragePct || confidenceRank(b.confidence) - confidenceRank(a.confidence)
  );
  const best = usable[0];

  const disagreements = usable.slice(1).filter((s) =>
    s.valueM != null && best.valueM != null && pctDiff(s.valueM, best.valueM) > CROSS_CHAIN_TOLERANCE_PCT
  );

  if (disagreements.length > 0) {
    return {
      axis,
      valueM: null,
      confidence: "low",
      sourceChainIds: usable.map((s) => s.chain.id),
      status: "conflict",
      diagnostics: [
        `Conflicting ${axis} overall chains; no averaging performed.`,
        ...usable.map((s) => `${s.chain.id}=${s.valueM?.toFixed(4)}m`),
      ],
    };
  }

  return {
    axis,
    valueM: best.valueM!,
    confidence: best.confidence,
    sourceChainIds: usable.map((s) => s.chain.id),
    status: "resolved",
    diagnostics: [
      `Resolved ${axis} extent from ${best.chain.id}: ${best.valueM!.toFixed(4)}m.`,
      `No averaging used. ${usable.length} compatible overall-candidate chain(s).`,
    ],
  };
}

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

function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

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
          }] members=${c.measurementIds.join(",")}${
            c.excludedFromAdditiveChain ? ` (excluded_from_additive_chain: ${c.excludedFromAdditiveChain})` : ""
          }`
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

  const diagnostics = [
    `Resolved ${axis} extent from ${best.chain.id}: ${best.valueM!.toFixed(4)}m.`,
    `No averaging used. ${usable.length} compatible overall-candidate chain(s).`,
  ];
  if (best.chain.chainMembership === "standalone") {
    diagnostics.push(
      `Note: ${best.chain.id} is a standalone candidate (no drawn dimension-line endpoints -- ` +
      `based on its text position only). Treat with extra scrutiny.`,
    );
  }

  return {
    axis,
    valueM: best.valueM!,
    confidence: best.confidence,
    sourceChainIds: usable.map((s) => s.chain.id),
    status: "resolved",
    diagnostics,
  };
}


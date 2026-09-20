// supabase/functions/_shared/vnext_checkpoint1_stability.ts
//
// Mechanical comparison utility for N attempts of SHIFT VNext Checkpoint 1
// run against the SAME normalized/cropped image. Never averages away a
// difference — every metric below is reported as an explicit per-attempt
// value plus an explicit pairwise/overall diff, and the PASS/FAIL verdict
// is a straight equality-or-within-tolerance check, never a mean.
//
// TOLERANCES ARE NOT TUNED YET — see STABILITY_TOLERANCES_VNEXT below.
// Every tolerance defaults to the strictest possible reading (0, i.e.
// exact match) except the single one that is inherently continuous
// (bbox drift), which carries an explicitly-labeled placeholder pending
// real data from the first 3-run experiment. Do not treat these defaults
// as validated — they exist so every threshold lives in one named,
// grep-able place instead of being invented inline.

import type { GeometryObservationVNext } from "./geometry_observation_schema_vnext.ts";
import { computeConnectedComponents } from "./geometry_observation_validators_vnext.ts";
import type { EvidenceObservationVNext } from "./evidence_observation_schema_vnext.ts";

export const STABILITY_TOLERANCES_VNEXT = {
  // Entity counts (vertices/edges/rooms/openings/stairs) and axis-hint
  // distribution: exact match required by default. This is almost
  // certainly too strict for real production plans and IS expected to be
  // loosened once we have real 3-run/10-run data — but starting at 0
  // means the first real run tells us the TRUE noise floor rather than
  // us guessing one and hiding it.
  countExactMatchRequired: true,
  // PLACEHOLDER — UNTUNED. Image-space bounding-box drift of the observed
  // wall graph across attempts, in percentage points of the image
  // dimension. 0 means "report the drift, don't gate on it yet" (pass/
  // fail for this metric is left OFF until a real value is chosen).
  bboxDriftPctToleranceUntuned: 0,
  bboxDriftGatesPassFail: false,
  // rawText sets: exact match required (this is OCR of unchanged printed
  // text on an unchanged image — there is no legitimate tolerance band
  // here, unlike geometry perception).
  rawTextExactMatchRequired: true,
} as const;

export interface AttemptInput {
  attemptLabel: string; // e.g. "attempt-1"
  geometry: GeometryObservationVNext | null; // null if that call failed/was invalid
  evidence: EvidenceObservationVNext | null;
  geometryDurationMs: number;
  evidenceDurationMs: number;
  totalWallClockMs: number;
}

interface CountSignature {
  vertices: number;
  edges: number;
  roomRegions: number;
  openings: number;
  stairs: number;
  exteriorFeatures: number;
}

interface AxisHintDistribution {
  horizontal: number;
  vertical: number;
  diagonal_or_unknown: number;
}

interface GraphSignature {
  componentCount: number;
  componentSizeMultiset: number[]; // sorted, so it's comparable independent of id assignment
  degreeMultiset: number[]; // sorted degree of every vertex
}

interface ExteriorSemanticsSignature {
  exteriorFeatureMultiset: string[];
  stairsContextMultiset: string[];
}

interface BBoxPct {
  minXPct: number;
  minYPct: number;
  maxXPct: number;
  maxYPct: number;
}

function countSignature(g: GeometryObservationVNext): CountSignature {
  return {
    vertices: g.vertices.length,
    edges: g.edges.length,
    roomRegions: g.roomRegions.length,
    openings: g.openings.length,
    stairs: g.stairs.length,
    exteriorFeatures: g.exteriorFeatures.length,
  };
}

function axisHintDistribution(g: GeometryObservationVNext): AxisHintDistribution {
  const dist: AxisHintDistribution = { horizontal: 0, vertical: 0, diagonal_or_unknown: 0 };
  for (const e of g.edges) dist[e.axisHint] += 1;
  return dist;
}

function graphSignature(g: GeometryObservationVNext): GraphSignature {
  const components = computeConnectedComponents(g);
  const componentSizeMultiset = components.map((c) => c.length).sort((a, b) => a - b);

  const degree = new Map<string, number>();
  for (const v of g.vertices) degree.set(v.id, 0);
  for (const e of g.edges) {
    if (degree.has(e.fromVertexId)) degree.set(e.fromVertexId, (degree.get(e.fromVertexId) ?? 0) + 1);
    if (degree.has(e.toVertexId)) degree.set(e.toVertexId, (degree.get(e.toVertexId) ?? 0) + 1);
  }
  const degreeMultiset = [...degree.values()].sort((a, b) => a - b);

  return { componentCount: components.length, componentSizeMultiset, degreeMultiset };
}

function exteriorSemanticsSignature(g: GeometryObservationVNext): ExteriorSemanticsSignature {
  return {
    exteriorFeatureMultiset: g.exteriorFeatures
      .map(
        (feature) =>
          `${feature.typeHint}|${feature.evidenceState}|` +
          `${feature.boundaryCompletenessHint}|${feature.enclosureHint}`,
      )
      .sort(),
    stairsContextMultiset: g.stairs.map((stairs) => stairs.contextHint).sort(),
  };
}

function boundingBoxPct(g: GeometryObservationVNext): BBoxPct | null {
  if (g.vertices.length === 0) return null;
  const xs = g.vertices.map((v) => v.imagePct.xPct);
  const ys = g.vertices.map((v) => v.imagePct.yPct);
  return { minXPct: Math.min(...xs), minYPct: Math.min(...ys), maxXPct: Math.max(...xs), maxYPct: Math.max(...ys) };
}

function bboxDriftPct(a: BBoxPct | null, b: BBoxPct | null): number | null {
  if (!a || !b) return null;
  return Math.max(
    Math.abs(a.minXPct - b.minXPct),
    Math.abs(a.minYPct - b.minYPct),
    Math.abs(a.maxXPct - b.maxXPct),
    Math.abs(a.maxYPct - b.maxYPct),
  );
}

function rawTextMultiset(e: EvidenceObservationVNext): string[] {
  return [
    ...e.dimensionEvidence.map((d) => `dim:${d.rawText}`),
    ...e.textLabels.map((l) => `label:${l.roleHint}:${l.rawText}`),
  ].sort();
}

function multisetDiff(a: string[], b: string[]): { missingFromB: string[]; extraInB: string[] } {
  const aCounts = new Map<string, number>();
  for (const x of a) aCounts.set(x, (aCounts.get(x) ?? 0) + 1);
  const bCounts = new Map<string, number>();
  for (const x of b) bCounts.set(x, (bCounts.get(x) ?? 0) + 1);

  const missingFromB: string[] = [];
  for (const [key, count] of aCounts) {
    const inB = bCounts.get(key) ?? 0;
    for (let i = 0; i < count - inB; i++) missingFromB.push(key);
  }
  const extraInB: string[] = [];
  for (const [key, count] of bCounts) {
    const inA = aCounts.get(key) ?? 0;
    for (let i = 0; i < count - inA; i++) extraInB.push(key);
  }
  return { missingFromB, extraInB };
}

export interface PairwiseDiff {
  attemptA: string;
  attemptB: string;
  countsMatch: boolean;
  countDeltas: Partial<Record<keyof CountSignature, number>>;
  axisHintDistributionMatch: boolean;
  graphSignatureMatch: boolean;
  exteriorSemanticsSignatureMatch: boolean;
  bboxDriftPct: number | null;
  rawTextMissingFromB: string[];
  rawTextExtraInB: string[];
  rawTextSetsMatch: boolean;
}

export interface StabilityReport {
  attemptLabels: string[];
  perAttempt: Array<{
    attemptLabel: string;
    counts: CountSignature | null;
    axisHintDistribution: AxisHintDistribution | null;
    boundingBoxPct: BBoxPct | null;
    exteriorSemanticsSignature: ExteriorSemanticsSignature | null;
    rawTextCount: number | null;
    geometryDurationMs: number;
    evidenceDurationMs: number;
    totalWallClockMs: number;
    geometryMissing: boolean;
    evidenceMissing: boolean;
  }>;
  pairwiseDiffs: PairwiseDiff[];
  overallPass: boolean;
  // Every individual reason overallPass is false, explicit and never
  // collapsed into a single opaque boolean.
  failureReasons: string[];
}

/**
 * Compares N attempts of the same image pairwise against the FIRST
 * attempt (not averaged, not sampled) and reports raw differences. Any
 * attempt with a null geometry or evidence observation (a failed/invalid
 * call) is reported explicitly and, by design, fails overall stability —
 * a missing observation is not "no difference to report", it is itself
 * the most important difference.
 */
export function runStabilityComparison(attempts: AttemptInput[]): StabilityReport {
  const attemptLabels = attempts.map((a) => a.attemptLabel);
  const failureReasons: string[] = [];

  const perAttempt = attempts.map((a) => ({
    attemptLabel: a.attemptLabel,
    counts: a.geometry ? countSignature(a.geometry) : null,
    axisHintDistribution: a.geometry ? axisHintDistribution(a.geometry) : null,
    boundingBoxPct: a.geometry ? boundingBoxPct(a.geometry) : null,
    exteriorSemanticsSignature: a.geometry ? exteriorSemanticsSignature(a.geometry) : null,
    rawTextCount: a.evidence ? rawTextMultiset(a.evidence).length : null,
    geometryDurationMs: a.geometryDurationMs,
    evidenceDurationMs: a.evidenceDurationMs,
    totalWallClockMs: a.totalWallClockMs,
    geometryMissing: a.geometry === null,
    evidenceMissing: a.evidence === null,
  }));

  for (const a of perAttempt) {
    if (a.geometryMissing) failureReasons.push(`${a.attemptLabel}: geometry observation missing/invalid`);
    if (a.evidenceMissing) failureReasons.push(`${a.attemptLabel}: evidence observation missing/invalid`);
  }

  const pairwiseDiffs: PairwiseDiff[] = [];
  if (attempts.length >= 2) {
    const base = attempts[0];
    for (let i = 1; i < attempts.length; i++) {
      const other = attempts[i];
      const attemptA = base.attemptLabel;
      const attemptB = other.attemptLabel;

      let countsMatch = true;
      const countDeltas: Partial<Record<keyof CountSignature, number>> = {};
      let axisHintDistributionMatch = true;
      let graphSignatureMatch = true;
      let exteriorSemanticsSignatureMatch = true;
      let drift: number | null = null;

      if (base.geometry && other.geometry) {
        const csA = countSignature(base.geometry);
        const csB = countSignature(other.geometry);
        (Object.keys(csA) as Array<keyof CountSignature>).forEach((key) => {
          const delta = csB[key] - csA[key];
          if (delta !== 0) {
            countDeltas[key] = delta;
            countsMatch = false;
          }
        });

        const adA = axisHintDistribution(base.geometry);
        const adB = axisHintDistribution(other.geometry);
        axisHintDistributionMatch =
          adA.horizontal === adB.horizontal &&
          adA.vertical === adB.vertical &&
          adA.diagonal_or_unknown === adB.diagonal_or_unknown;

        const gsA = graphSignature(base.geometry);
        const gsB = graphSignature(other.geometry);
        graphSignatureMatch =
          gsA.componentCount === gsB.componentCount &&
          JSON.stringify(gsA.componentSizeMultiset) === JSON.stringify(gsB.componentSizeMultiset) &&
          JSON.stringify(gsA.degreeMultiset) === JSON.stringify(gsB.degreeMultiset);

        const esA = exteriorSemanticsSignature(base.geometry);
        const esB = exteriorSemanticsSignature(other.geometry);
        exteriorSemanticsSignatureMatch = JSON.stringify(esA) === JSON.stringify(esB);

        drift = bboxDriftPct(boundingBoxPct(base.geometry), boundingBoxPct(other.geometry));
      } else {
        countsMatch = false;
        axisHintDistributionMatch = false;
        graphSignatureMatch = false;
        exteriorSemanticsSignatureMatch = false;
      }

      let rawTextMissingFromB: string[] = [];
      let rawTextExtraInB: string[] = [];
      let rawTextSetsMatch = true;
      if (base.evidence && other.evidence) {
        const { missingFromB, extraInB } = multisetDiff(rawTextMultiset(base.evidence), rawTextMultiset(other.evidence));
        rawTextMissingFromB = missingFromB;
        rawTextExtraInB = extraInB;
        rawTextSetsMatch = missingFromB.length === 0 && extraInB.length === 0;
      } else {
        rawTextSetsMatch = false;
      }

      if (!countsMatch) failureReasons.push(`${attemptA} vs ${attemptB}: entity counts differ (${JSON.stringify(countDeltas)})`);
      if (!axisHintDistributionMatch) failureReasons.push(`${attemptA} vs ${attemptB}: axisHint distribution differs`);
      if (!graphSignatureMatch) failureReasons.push(`${attemptA} vs ${attemptB}: graph component/degree signature differs`);
      if (!exteriorSemanticsSignatureMatch) {
        failureReasons.push(`${attemptA} vs ${attemptB}: exterior feature/stairs semantic signature differs`);
      }
      if (!rawTextSetsMatch) {
        failureReasons.push(
          `${attemptA} vs ${attemptB}: rawText sets differ (missing: ${rawTextMissingFromB.length}, extra: ${rawTextExtraInB.length})`,
        );
      }

      pairwiseDiffs.push({
        attemptA,
        attemptB,
        countsMatch,
        countDeltas,
        axisHintDistributionMatch,
        graphSignatureMatch,
        exteriorSemanticsSignatureMatch,
        bboxDriftPct: drift,
        rawTextMissingFromB,
        rawTextExtraInB,
        rawTextSetsMatch,
      });
    }
  }

  return {
    attemptLabels,
    perAttempt,
    pairwiseDiffs,
    overallPass: failureReasons.length === 0,
    failureReasons,
  };
}

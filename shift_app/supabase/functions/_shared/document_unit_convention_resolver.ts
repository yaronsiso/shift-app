// supabase/functions/_shared/document_unit_convention_resolver.ts
//
// Session 23, follow-up #3. Yaron's real-drawing regression (the one that
// finally got 1669/1099 read correctly via targeted dimension strips --
// see dimension_measurement_merge_v3.ts) exposed the NEXT gate: almost
// every measurement on this drawing has unit:"unknown" (no "cm"/"m" label
// printed next to the number -- normal for Israeli architectural drawings,
// where the convention is stated once, if at all, or simply assumed). The
// model's own page-wide `DocumentMeasurementConvention` hint (see
// dimension_evidence_schema_v3.ts) came back `detectedUnit:"unknown"`,
// confidence "low" -- an honest "I don't see an explicit note", but not
// something resolveAuthoritativeExtentV3 can build on. Without SOME
// resolved unit, both axes stay stuck at status:"unresolved" forever, no
// matter how well Pass 1 reads the raw numbers.
//
// Yaron's explicit instruction for the fix, verbatim (translated): add a
// separate DETERMINISTIC resolution layer. The AI/raw measurements stay
// untouched (rawNumeric stays 1669, unit stays "unknown" on the record
// itself -- this file never mutates a DimensionEvidence). The resolver may
// infer a document convention ONLY from multiple mutually consistent
// architectural length measurements, NEVER from a single number alone.
// Never silently assume cm. If no candidate wins by a strong margin,
// return unresolved -- exactly like a missing/conflicting axis chain, this
// is a case where "we don't know" must be reported honestly rather than
// guessed.
//
// THE ALGORITHM: for each candidate unit (mm/cm/m), convert every
// length-bearing (building/room/wall/opening -- see isLengthType in
// dimension_chain_resolver_v3.ts, exported for this file to reuse the
// exact same population) measurement whose OWN unit is "unknown" as if it
// were expressed in that candidate unit, and check whether the resulting
// meter value falls inside a broad, documented "architecturally plausible"
// range for that measurement's referenceTypeHint (PLAUSIBLE_RANGE_M below).
// The candidate with the highest plausible-fraction wins, but ONLY if it
// clears two bars: a high absolute plausible-fraction (MIN_WINNING_FRACTION)
// AND a strong margin over the runner-up candidate (MIN_MARGIN) -- a
// drawing whose numbers are ambiguous between two conventions (e.g. very
// few measurements, or a set that happens to look plausible under more
// than one unit) must resolve to "unknown", not a coin flip.
//
// Why per-hint plausible ranges, not one universal range: a single broad
// range (say 0.02m-80m) would accept almost every candidate unit for
// almost every number, since a "building" length is plausible from a few
// centimeters to tens of meters. The ranges below are intentionally
// narrower for "room"/"wall"/"opening" -- those are what actually
// discriminate between candidates in practice (thickness numbers like
// 20/22 are plausible as 0.20m/0.22m wall thickness under cm, implausible
// as 20mm/22mm or as 20m/22m). "building" is kept broad on purpose --
// individual building-edge measurements in this pipeline range from short
// wall-run segments to the full envelope span, and being unable to
// discriminate well on its own is fine: the room/wall/opening evidence
// carries the vote.
//
// Explicitly NOT done here: this never looks at a measurement whose OWN
// unit is already non-"unknown" (toMetersV3 already converts those
// directly and never needs a document convention for them), never mixes
// units within one candidate's scoring, and never falls back to "cm" as a
// silent default when evidence is thin -- exactly Yaron's "never silently
// assume cm" instruction.

import type { Confidence, DimensionEvidence, LengthUnit } from "./dimension_evidence_schema_v3.ts";
import { isLengthType } from "./dimension_chain_resolver_v3.ts";

export type UnitCandidate = "mm" | "cm" | "m";

export interface DocumentUnitConventionResult {
  detectedUnit: LengthUnit; // "mm" | "cm" | "m" | "unknown"
  confidence: Confidence;
  evidence: string[];
}

const CANDIDATES: readonly UnitCandidate[] = ["mm", "cm", "m"] as const;

// Broad, documented, intentionally generous architectural plausibility
// ranges in METERS, keyed by referenceTypeHint. Deliberately NOT tuned to
// this one drawing -- these are meant to hold for ordinary residential/
// small-commercial floor plans in general. See file header for why
// "building" is wide and "room"/"wall"/"opening" are what actually
// discriminate mm vs. cm vs. m.
const PLAUSIBLE_RANGE_M: Record<"building" | "room" | "wall" | "opening", { min: number; max: number }> = {
  building: { min: 0.3, max: 80 },
  room: { min: 0.5, max: 20 },
  wall: { min: 0.03, max: 12 },
  opening: { min: 0.3, max: 4 },
};

// Never infer a convention from a handful of numbers -- "multiple mutually
// consistent measurements", per Yaron's instruction, not one or two.
const MIN_EVIDENCE_COUNT = 3;

// The winning candidate must explain a strong majority of the evidence...
const MIN_WINNING_FRACTION = 0.7;
// ...AND beat the runner-up by a strong margin. A close call (e.g. 55% vs.
// 50%) is exactly the ambiguous case that must resolve to "unknown".
const MIN_MARGIN = 0.25;

function toMetersAsCandidate(rawNumeric: number, unit: UnitCandidate): number {
  switch (unit) {
    case "mm":
      return rawNumeric / 1000;
    case "cm":
      return rawNumeric / 100;
    case "m":
      return rawNumeric;
  }
}

interface CandidateScore {
  unit: UnitCandidate;
  plausibleCount: number;
  implausibleCount: number;
  plausibleFraction: number;
}

/**
 * Deterministically infers this document's length-unit convention from its
 * own raw measurement evidence -- never from a printed label (those are
 * used directly, per-measurement, by toMetersV3 and never reach this
 * function), never from a single number, and never defaulting to cm when
 * the evidence is thin or ambiguous.
 */
export function resolveDocumentUnitConvention(
  measurements: DimensionEvidence[],
): DocumentUnitConventionResult {
  // Only measurements this convention could ever actually be used for:
  // unit=="unknown" (an explicit per-measurement unit never consults the
  // document convention -- see toMetersV3) AND a length-bearing hint with
  // a defined plausibility range.
  const pool = measurements.filter(
    (m): m is DimensionEvidence & { referenceTypeHint: keyof typeof PLAUSIBLE_RANGE_M; rawNumeric: number } =>
      m.unit === "unknown" &&
      m.rawNumeric != null &&
      Number.isFinite(m.rawNumeric) &&
      isLengthType(m.referenceTypeHint) &&
      m.referenceTypeHint in PLAUSIBLE_RANGE_M,
  );

  if (pool.length < MIN_EVIDENCE_COUNT) {
    return {
      detectedUnit: "unknown",
      confidence: "low",
      evidence: [
        `Only ${pool.length} unknown-unit length measurement(s) available -- too few to infer ` +
        `a document convention (need >= ${MIN_EVIDENCE_COUNT}).`,
      ],
    };
  }

  const scored: CandidateScore[] = CANDIDATES.map((unit) => {
    let plausibleCount = 0;
    let implausibleCount = 0;
    for (const m of pool) {
      const valueM = toMetersAsCandidate(m.rawNumeric, unit);
      const range = PLAUSIBLE_RANGE_M[m.referenceTypeHint];
      if (valueM >= range.min && valueM <= range.max) {
        plausibleCount++;
      } else {
        implausibleCount++;
      }
    }
    const total = plausibleCount + implausibleCount;
    return { unit, plausibleCount, implausibleCount, plausibleFraction: total > 0 ? plausibleCount / total : 0 };
  });

  scored.sort((a, b) => b.plausibleFraction - a.plausibleFraction || b.plausibleCount - a.plausibleCount);
  const best = scored[0];
  const runnerUp = scored[1];

  const summary = scored
    .map((s) => `${s.unit}=${(s.plausibleFraction * 100).toFixed(0)}%(${s.plausibleCount}/${s.plausibleCount + s.implausibleCount})`)
    .join(", ");

  if (best.plausibleFraction < MIN_WINNING_FRACTION || best.plausibleFraction - runnerUp.plausibleFraction < MIN_MARGIN) {
    return {
      detectedUnit: "unknown",
      confidence: "low",
      evidence: [
        `No unit candidate won by a strong enough margin over ${pool.length} measurement(s): ${summary}. ` +
        `Needs >= ${(MIN_WINNING_FRACTION * 100).toFixed(0)}% plausible and a >= ${
          (MIN_MARGIN * 100).toFixed(0)
        }-point margin over the runner-up.`,
      ],
    };
  }

  const confidence: Confidence = best.plausibleFraction >= 0.9 && best.plausibleCount >= 5 ? "high" : "medium";

  return {
    detectedUnit: best.unit,
    confidence,
    evidence: [
      `${best.unit}: ${best.plausibleCount}/${best.plausibleCount + best.implausibleCount} unknown-unit length ` +
      `measurements (${(best.plausibleFraction * 100).toFixed(0)}%) fall within plausible architectural ranges ` +
      `by referenceTypeHint. Next-best candidate: ${runnerUp.unit} at ${(runnerUp.plausibleFraction * 100).toFixed(0)}%.`,
      `All candidates: ${summary}.`,
    ],
  };
}

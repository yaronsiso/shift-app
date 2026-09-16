// claude/phase1c-a/src/validator/semantic_plan_validator_v1.ts
//
// Phase 1C-A — Part C: Deterministic Semantic Validator — IMPLEMENTATION.
//
// AI PROPOSES -> PART C VALIDATES -> Part D translates to ApprovedPlan ->
// constructCanonicalTopology executes. This file is PART C ONLY:
//   - takes EnvelopeTopologyV1, RawTopology, and a SemanticPlanProposal (all
//     three, kept separate on purpose -- see the file-level note below on
//     why Part C does not derive RawTopology from EnvelopeTopologyV1
//     itself)
//   - returns a SemanticPlanValidationResultV1
//   - performs NO mutation of any input (proved by tests: deep-equal
//     before/after on all three inputs)
//   - performs NO auto-fill, NO forced closure, NO proximity-based repair
//   - never reads `reason` or `confidence` as a basis for any rule decision
//   - is fully deterministic: identical input -> byte-identical output. No
//     Date.now(), no Math.random(), no network, no I/O.
//
// WHY THREE SEPARATE PARAMETERS (envelope, raw, proposal), NOT TWO:
// Part C deliberately takes RawTopology as an explicit parameter rather
// than deriving it internally via envelopeTopologyV1ToRawTopology(envelope).
// If Part C built its own RawTopology from the envelope, then
// ENVELOPE_RAW_CONSISTENCY (below) would be comparing a value against
// itself -- a tautology that could never fail. The caller is responsible
// for supplying whatever RawTopology it actually used (e.g. the one it fed
// to the referential-integrity checks, or to phase1c-b), and Part C checks
// that value for real, independent consistency against the envelope it was
// supposedly derived from.
//
// SCOPE (binding, do not exceed): this file validates one SemanticPlanProposal.
// It does not build a PlanOperation, an ApprovedPlan, or touch
// constructCanonicalTopology, OpenAI, any Edge Function, persistence, DB,
// Flutter, Witness, or the solver. Those are all out of scope for Part C.

import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';
import type { RawTopology } from '../types/raw_audited_plan_model.js';
import type { EdgeSemanticProposal, SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';
import { checkReferentialIntegrity, type ReferentialIntegrityResult } from '../referential_integrity.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import type {
  PerEdgeReadiness,
  PerEdgeReadinessStatus,
  SemanticPlanValidationResultV1,
  SemanticValidationFinding,
  SemanticValidationReadiness,
  SemanticValidationRuleResult,
} from './semantic_plan_validation_result_v1.js';

// ---------------------------------------------------------------------
// Helpers (pure, no mutation of any argument)
// ---------------------------------------------------------------------

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

// deepEqual (the earlier order-sensitive helper) was removed: per the
// approved design, ENVELOPE_RAW_CONSISTENCY compares vertex/edge ID SETS
// (order-independent), with exact (non-epsilon) per-ID field comparison --
// see checkEnvelopeRawConsistency below, which does that directly rather
// than through a generic deep-equal helper.

// ---------------------------------------------------------------------
// CONTRACT rules
// ---------------------------------------------------------------------

/**
 * ENVELOPE_RAW_CONSISTENCY -- exact equality (NOT epsilon/proximity) between
 * the RawTopology derived from `envelope` (via the same adapter Part A and
 * Part D use) and the `raw` parameter the caller actually supplied.
 *
 * Per the approved design, this compares vertex/edge ID SETS, not array
 * order: vertices and edges are unordered collections identified by id, so
 * a `raw` that contains exactly the same ids as the envelope-derived
 * topology, in any order, is consistent. What IS checked exactly (===, no
 * epsilon, no proximity) per matching id:
 *   - vertex id sets are identical (no missing id, no extra id)
 *   - edge id sets are identical (no missing id, no extra id)
 *   - for every vertex id present in both: xPct === xPct, yPct === yPct
 *   - for every edge id present in both: fromVertexId === fromVertexId,
 *     toVertexId === toVertexId
 * axisHint is intentionally NOT compared here: RawEdge.axisHint is already
 * a narrowed/derived field (the adapter maps 'diagonal_or_unknown' to
 * undefined -- see adapter.ts), not a 1:1 passthrough value, so comparing
 * it would not be an "exact" comparison of the same underlying fact and is
 * out of scope for this rule. roleHint/cornerAngleHint/polygonOrder/
 * perceptionNotes are envelope-only fields that never exist on RawTopology
 * at all, so they play no part in this comparison either way.
 * This does NOT recompute `raw` and substitute it (that would defeat the
 * point of taking it as a separate parameter) -- it only compares.
 */
function checkEnvelopeRawConsistency(
  envelope: EnvelopeTopologyV1,
  raw: RawTopology,
): SemanticValidationRuleResult {
  const derived = envelopeTopologyV1ToRawTopology(envelope);

  const derivedVertexIds = new Set(derived.vertices.map((v) => v.id));
  const rawVertexIds = new Set(raw.vertices.map((v) => v.id));
  const missingVertexIds = [...derivedVertexIds].filter((id) => !rawVertexIds.has(id));
  const extraVertexIds = [...rawVertexIds].filter((id) => !derivedVertexIds.has(id));

  const derivedEdgeIds = new Set(derived.edges.map((e) => e.id));
  const rawEdgeIds = new Set(raw.edges.map((e) => e.id));
  const missingEdgeIds = [...derivedEdgeIds].filter((id) => !rawEdgeIds.has(id));
  const extraEdgeIds = [...rawEdgeIds].filter((id) => !derivedEdgeIds.has(id));

  const rawVertexById = new Map(raw.vertices.map((v) => [v.id, v]));
  const mismatchedVertexIds: string[] = [];
  for (const dv of derived.vertices) {
    const rv = rawVertexById.get(dv.id);
    if (rv && (rv.xPct !== dv.xPct || rv.yPct !== dv.yPct)) {
      mismatchedVertexIds.push(dv.id);
    }
  }

  const rawEdgeById = new Map(raw.edges.map((e) => [e.id, e]));
  const mismatchedEdgeIds: string[] = [];
  for (const de of derived.edges) {
    const re = rawEdgeById.get(de.id);
    if (re && (re.fromVertexId !== de.fromVertexId || re.toVertexId !== de.toVertexId)) {
      mismatchedEdgeIds.push(de.id);
    }
  }

  const passed =
    missingVertexIds.length === 0 &&
    extraVertexIds.length === 0 &&
    missingEdgeIds.length === 0 &&
    extraEdgeIds.length === 0 &&
    mismatchedVertexIds.length === 0 &&
    mismatchedEdgeIds.length === 0;

  const problems: string[] = [];
  if (missingVertexIds.length > 0) problems.push(`missing vertex ids: ${missingVertexIds.join(', ')}`);
  if (extraVertexIds.length > 0) problems.push(`extra vertex ids: ${extraVertexIds.join(', ')}`);
  if (missingEdgeIds.length > 0) problems.push(`missing edge ids: ${missingEdgeIds.join(', ')}`);
  if (extraEdgeIds.length > 0) problems.push(`extra edge ids: ${extraEdgeIds.join(', ')}`);
  if (mismatchedVertexIds.length > 0) problems.push(`vertex xPct/yPct mismatch: ${mismatchedVertexIds.join(', ')}`);
  if (mismatchedEdgeIds.length > 0) problems.push(`edge fromVertexId/toVertexId mismatch: ${mismatchedEdgeIds.join(', ')}`);

  return {
    rule: 'ENVELOPE_RAW_CONSISTENCY',
    category: 'CONTRACT',
    passed,
    details: passed
      ? 'The supplied RawTopology has exactly the same vertex/edge id sets (order-independent) as the RawTopology derived from the supplied EnvelopeTopologyV1, with exact xPct/yPct and fromVertexId/toVertexId matches per id.'
      : `The supplied RawTopology is not consistent with the RawTopology derived from the supplied EnvelopeTopologyV1 -- ${problems.join('; ')}.`,
  };
}

/**
 * NO_DUPLICATE_GAP_PROPOSAL -- gapId must be unique across gapProposals.
 * New to Part C (approved as a CONTRACT rule) -- Part A's
 * referential_integrity.ts is deliberately NOT modified for this; this is
 * a standalone check here, reusing only the findDuplicates helper pattern,
 * not any Part A code path.
 */
function checkNoDuplicateGapProposal(proposal: SemanticPlanProposal): SemanticValidationRuleResult {
  const dups = findDuplicates(proposal.gapProposals.map((g) => g.gapId));
  const passed = dups.length === 0;
  return {
    rule: 'NO_DUPLICATE_GAP_PROPOSAL',
    category: 'CONTRACT',
    passed,
    details: passed
      ? 'No gapId appears more than once across gapProposals.'
      : `Duplicate gapProposals for gapId: ${dups.join(', ')}`,
  };
}

// ---------------------------------------------------------------------
// COVERAGE rules
// ---------------------------------------------------------------------

/**
 * EVERY_RAW_EDGE_HAS_PROPOSAL -- every RAW edge must have >=1 edgeProposal.
 * Combined with Part A's NO_DUPLICATE_EDGE_PROPOSAL, the conjunction means
 * "exactly one" (per design). UNRESOLVED counts as valid coverage -- this
 * rule only checks a proposal EXISTS for the edge, never what its
 * disposition is; an edge proposed as UNRESOLVED still satisfies this rule.
 * An edge with NO proposal at all fails it (that is a genuine coverage gap,
 * distinct from a legitimate UNRESOLVED finding).
 */
function checkEveryRawEdgeHasProposal(
  proposal: SemanticPlanProposal,
  raw: RawTopology,
): SemanticValidationRuleResult {
  const proposedEdgeIds = new Set(proposal.edgeProposals.map((p) => p.rawEdgeId));
  const missing = raw.edges.filter((e) => !proposedEdgeIds.has(e.id)).map((e) => e.id);
  const passed = missing.length === 0;
  return {
    rule: 'EVERY_RAW_EDGE_HAS_PROPOSAL',
    category: 'COVERAGE',
    passed,
    details: passed
      ? `Every one of ${raw.edges.length} RAW edges has at least one edgeProposal (UNRESOLVED counts as coverage).`
      : `RAW edges with no edgeProposal at all: ${missing.join(', ')}`,
  };
}

/**
 * GAP_REQUIRES_TOPOLOGY_CONTEXT -- a gapProposal with BOTH
 * relatedRawEdgeIds and knownEndpointRawVertexIds empty is an ungrounded /
 * "floating" gap, and fails this rule. At least one ref on either side
 * (even a single one) is structurally sufficient to pass -- Part C invents
 * no topology context to satisfy this rule for a gap that has none. This
 * is a per-gap check aggregated into one rule result (passed iff every
 * gapProposal individually passes), consistent with how Part A aggregates
 * its own per-item existence checks into one rule result each.
 */
function checkGapRequiresTopologyContext(proposal: SemanticPlanProposal): SemanticValidationRuleResult {
  const ungrounded = proposal.gapProposals
    .filter((g) => g.relatedRawEdgeIds.length === 0 && g.knownEndpointRawVertexIds.length === 0)
    .map((g) => g.gapId);
  const passed = ungrounded.length === 0;
  return {
    rule: 'GAP_REQUIRES_TOPOLOGY_CONTEXT',
    category: 'COVERAGE',
    passed,
    details: passed
      ? 'Every gapProposal has at least one relatedRawEdgeId or knownEndpointRawVertexId (no floating gaps).'
      : `gapProposals with both relatedRawEdgeIds and knownEndpointRawVertexIds empty (floating/ungrounded): ${ungrounded.join(', ')}`,
  };
}

// ---------------------------------------------------------------------
// SEMANTIC_POLICY rules
// ---------------------------------------------------------------------

/**
 * DUAL_FACE_FIELD_MATCHES_DISPOSITION -- the approved SYMMETRIC rule:
 *
 *   passed  <=>  (dualFaceOf !== null)  ===  (disposition === 'REJECT_DUAL_FACE')
 *
 * Both directions are enforced:
 *   - disposition === REJECT_DUAL_FACE with dualFaceOf === null: FAIL.
 *   - disposition !== REJECT_DUAL_FACE (KEEP_ENVELOPE, REJECT_NOT_ENVELOPE,
 *     SPLIT_REQUIRED, or UNRESOLVED) with dualFaceOf !== null: FAIL.
 *
 * This is per-proposal field coherence, checked here per-edge and
 * aggregated into one rule result (passed iff every edgeProposal
 * individually passes) -- same aggregation convention as
 * GAP_REQUIRES_TOPOLOGY_CONTEXT above.
 *
 * IMPORTANT: passing this rule (plus DUAL_FACE_TARGET_MUST_EXIST and
 * DUAL_FACE_NO_SELF_REFERENCE from Part A) is coherence, NOT proof. An
 * edgeProposal with disposition REJECT_DUAL_FACE that passes all three
 * still gets perEdgeReadiness status UNVERIFIED_NOT_EXECUTABLE (see
 * computePerEdgeReadiness below) -- there is no deterministic geometric
 * dual-face proof source in Part C, by design, and none is added here.
 */
function checkDualFaceFieldMatchesDisposition(proposal: SemanticPlanProposal): SemanticValidationRuleResult {
  const violating = proposal.edgeProposals
    .filter((p) => (p.dualFaceOf !== null) !== (p.disposition === 'REJECT_DUAL_FACE'))
    .map((p) => p.rawEdgeId);
  const passed = violating.length === 0;
  return {
    rule: 'DUAL_FACE_FIELD_MATCHES_DISPOSITION',
    category: 'SEMANTIC_POLICY',
    passed,
    details: passed
      ? 'For every edgeProposal, (dualFaceOf !== null) exactly matches (disposition === REJECT_DUAL_FACE).'
      : `edgeProposals where dualFaceOf-presence and REJECT_DUAL_FACE-disposition disagree: ${violating.join(', ')}`,
  };
}

/**
 * KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE -- the existing constructor
 * (phase1c-b, constructCanonicalTopology) requires semanticVerificationScope
 * on every PRESERVE_CONFIRMED_TOPOLOGY operation and throws
 * MISSING_SEMANTIC_VERIFICATION_SCOPE when it is absent. Part C did not
 * previously enforce this, so a KEEP_ENVELOPE edgeProposal with
 * verificationScope:null could reach executionReadyForPartD=true and then
 * fail downstream at construction. This rule closes that narrow readiness
 * hole, deterministically, at the Part C layer:
 *
 *   passed  <=>  for every edgeProposal: if disposition === 'KEEP_ENVELOPE'
 *                then verificationScope !== null
 *
 * Only KEEP_ENVELOPE is constrained by this rule. Every other disposition
 * (REJECT_NOT_ENVELOPE, REJECT_DUAL_FACE, SPLIT_REQUIRED, UNRESOLVED) may
 * freely carry verificationScope:null -- this rule imposes no requirement
 * on them at all, in either direction.
 *
 * This rule reads only `disposition` and `verificationScope`. Per
 * REASON_IS_NOT_PROOF / PROPOSAL_CONFIDENCE_IS_NOT_AUTHORITY, `reason` and
 * `confidence` have zero effect on its outcome.
 */
function checkKeepEnvelopeRequiresVerificationScope(proposal: SemanticPlanProposal): SemanticValidationRuleResult {
  const violating = proposal.edgeProposals
    .filter((p) => p.disposition === 'KEEP_ENVELOPE' && p.verificationScope === null)
    .map((p) => p.rawEdgeId);
  const passed = violating.length === 0;
  return {
    rule: 'KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE',
    category: 'SEMANTIC_POLICY',
    passed,
    details: passed
      ? 'Every KEEP_ENVELOPE edgeProposal carries a non-null verificationScope.'
      : `KEEP_ENVELOPE edgeProposals with verificationScope=null (required by the existing constructor's semanticVerificationScope check): ${violating.join(', ')}`,
  };
}

// ---------------------------------------------------------------------
// Informational findings (no passed:boolean, by design)
// ---------------------------------------------------------------------

function computeInformationalFindings(proposal: SemanticPlanProposal): SemanticValidationFinding[] {
  const findings: SemanticValidationFinding[] = [];

  const splitRequiredEdges = proposal.edgeProposals
    .filter((p) => p.disposition === 'SPLIT_REQUIRED')
    .map((p) => p.rawEdgeId);
  if (splitRequiredEdges.length > 0) {
    findings.push({
      key: 'SPLIT_REQUIRED_PRESENT',
      affectedRawEdgeIds: splitRequiredEdges,
      details: `${splitRequiredEdges.length} edgeProposal(s) carry disposition SPLIT_REQUIRED. This is a legitimate finding, not a failure -- constructCanonicalTopology has no mechanism to perform a real split, so these can never be EXECUTION_READY with the current constructor.`,
    });
  }

  const dualFaceRejectEdges = proposal.edgeProposals
    .filter((p) => p.disposition === 'REJECT_DUAL_FACE')
    .map((p) => p.rawEdgeId);
  if (dualFaceRejectEdges.length > 0) {
    findings.push({
      key: 'DUAL_FACE_PROOF_NOT_AVAILABLE',
      affectedRawEdgeIds: dualFaceRejectEdges,
      details: `${dualFaceRejectEdges.length} edgeProposal(s) carry disposition REJECT_DUAL_FACE. Even where dualFaceOf field/reference checks pass, Part C has no deterministic geometric proof source for the dual-face claim -- these remain UNVERIFIED_NOT_EXECUTABLE.`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// Per-edge readiness
// ---------------------------------------------------------------------

function computePerEdgeReadiness(
  proposal: SemanticPlanProposal,
  raw: RawTopology,
  contractValid: boolean,
  coverageValid: boolean,
  semanticPolicyValid: boolean,
): PerEdgeReadiness[] {
  const proposalsByEdgeId = new Map<string, EdgeSemanticProposal>();
  for (const p of proposal.edgeProposals) {
    // Intentionally last-write-wins on duplicates: NO_DUPLICATE_EDGE_PROPOSAL
    // already reports this as a CONTRACT failure (contractValid will be
    // false), and perEdgeReadiness is still computed for diagnostic
    // completeness per design -- it does not need its own separate
    // duplicate-handling policy.
    proposalsByEdgeId.set(p.rawEdgeId, p);
  }

  return raw.edges.map((edge): PerEdgeReadiness => {
    const proposalForEdge = proposalsByEdgeId.get(edge.id);

    if (!proposalForEdge) {
      return {
        rawEdgeId: edge.id,
        status: 'NOT_EXECUTION_READY_UNRESOLVED',
        details:
          'No edgeProposal exists for this RAW edge (a coverage gap reported separately by EVERY_RAW_EDGE_HAS_PROPOSAL); treated as not execution-ready.',
      };
    }

    if (!contractValid || !coverageValid || !semanticPolicyValid) {
      return {
        rawEdgeId: edge.id,
        status:
          proposalForEdge.disposition === 'UNRESOLVED'
            ? 'NOT_EXECUTION_READY_UNRESOLVED'
            : proposalForEdge.disposition === 'SPLIT_REQUIRED'
              ? 'NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR'
              : proposalForEdge.disposition === 'REJECT_DUAL_FACE'
                ? 'UNVERIFIED_NOT_EXECUTABLE'
                : 'NOT_EXECUTION_READY_UNRESOLVED',
        details:
          'The overall proposal failed a CONTRACT, COVERAGE, or SEMANTIC_POLICY rule, so no edge in this proposal can be EXECUTION_READY -- see ruleResults for the specific failure(s).',
      };
    }

    switch (proposalForEdge.disposition) {
      case 'KEEP_ENVELOPE':
      case 'REJECT_NOT_ENVELOPE':
        return {
          rawEdgeId: edge.id,
          status: 'EXECUTION_READY',
          details: `disposition=${proposalForEdge.disposition}; every applicable rule passed; no outstanding deterministic blocker.`,
        };
      case 'UNRESOLVED':
        return {
          rawEdgeId: edge.id,
          status: 'NOT_EXECUTION_READY_UNRESOLVED',
          details: 'disposition=UNRESOLVED; a legitimate, undecided finding -- never upgraded to a decision.',
        };
      case 'SPLIT_REQUIRED':
        return {
          rawEdgeId: edge.id,
          status: 'NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR',
          details:
            'disposition=SPLIT_REQUIRED; constructCanonicalTopology has no mechanism to perform a real topology split.',
        };
      case 'REJECT_DUAL_FACE':
        return {
          rawEdgeId: edge.id,
          status: 'UNVERIFIED_NOT_EXECUTABLE',
          details:
            'disposition=REJECT_DUAL_FACE; field/reference checks passed but this is coherence, not proof -- no deterministic geometric dual-face proof source exists in Part C.',
        };
    }
  });
}

// ---------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------

/**
 * Pure, deterministic validation of one SemanticPlanProposal. Performs NO
 * mutation of `envelope`, `raw`, or `proposal`. Never reads `reason` or
 * `confidence` on any rule decision (they are consulted nowhere in this
 * file). Identical input -> byte-identical output.
 */
export function validateSemanticPlan(
  envelope: EnvelopeTopologyV1,
  raw: RawTopology,
  proposal: SemanticPlanProposal,
): SemanticPlanValidationResultV1 {
  // --- CONTRACT: import + normalize Part A's 7 referential-integrity results ---
  const referentialResults: ReferentialIntegrityResult[] = checkReferentialIntegrity(proposal, raw);
  const contractFromPartA: SemanticValidationRuleResult[] = referentialResults.map((r) => ({
    rule: r.rule,
    category: 'CONTRACT' as const,
    passed: r.passed,
    details: r.details,
  }));

  const envelopeRawConsistency = checkEnvelopeRawConsistency(envelope, raw);
  const noDuplicateGapProposal = checkNoDuplicateGapProposal(proposal);

  const contractResults: SemanticValidationRuleResult[] = [
    ...contractFromPartA,
    envelopeRawConsistency,
    noDuplicateGapProposal,
  ];

  // --- COVERAGE ---
  const everyRawEdgeHasProposal = checkEveryRawEdgeHasProposal(proposal, raw);
  const gapRequiresTopologyContext = checkGapRequiresTopologyContext(proposal);
  const coverageResults: SemanticValidationRuleResult[] = [everyRawEdgeHasProposal, gapRequiresTopologyContext];

  // --- SEMANTIC_POLICY ---
  const dualFaceFieldMatchesDisposition = checkDualFaceFieldMatchesDisposition(proposal);
  const keepEnvelopeRequiresVerificationScope = checkKeepEnvelopeRequiresVerificationScope(proposal);
  const semanticPolicyResults: SemanticValidationRuleResult[] = [
    dualFaceFieldMatchesDisposition,
    keepEnvelopeRequiresVerificationScope,
  ];

  const contractValid = contractResults.every((r) => r.passed);
  const coverageValid = coverageResults.every((r) => r.passed);
  const semanticPolicyValid = semanticPolicyResults.every((r) => r.passed);

  const perEdgeReadiness = computePerEdgeReadiness(proposal, raw, contractValid, coverageValid, semanticPolicyValid);

  const executionReadyForPartD =
    contractValid &&
    coverageValid &&
    semanticPolicyValid &&
    perEdgeReadiness.every((r: PerEdgeReadiness) => r.status === 'EXECUTION_READY');

  const readiness: SemanticValidationReadiness = {
    contractValid,
    coverageValid,
    semanticPolicyValid,
    executionReadyForPartD,
  };

  const informationalFindings = computeInformationalFindings(proposal);

  const ruleResults: SemanticValidationRuleResult[] = [...contractResults, ...coverageResults, ...semanticPolicyResults];

  return {
    schemaVersion: 'semantic_plan_validation_result_v1',
    ruleResults,
    informationalFindings,
    readiness,
    perEdgeReadiness,
  };
}

/**
 * Convenience wrapper for callers that only have EnvelopeTopologyV1 on hand
 * and want Part C to derive RawTopology from it via the same pure adapter
 * used elsewhere. NOTE: unlike checkReferentialIntegrityAgainstEnvelope in
 * Part A, using this wrapper makes ENVELOPE_RAW_CONSISTENCY a tautology
 * (raw is derived from envelope internally, so it trivially matches) -- it
 * always passes when called this way. This wrapper exists for caller
 * convenience only; callers that specifically want ENVELOPE_RAW_CONSISTENCY
 * to be a meaningful, independent check must call validateSemanticPlan
 * directly with their own independently-obtained RawTopology.
 */
export function validateSemanticPlanAgainstEnvelope(
  envelope: EnvelopeTopologyV1,
  proposal: SemanticPlanProposal,
): SemanticPlanValidationResultV1 {
  return validateSemanticPlan(envelope, envelopeTopologyV1ToRawTopology(envelope), proposal);
}

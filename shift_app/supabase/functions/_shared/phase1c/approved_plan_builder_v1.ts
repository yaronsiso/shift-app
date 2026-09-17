// claude/phase1c-a/src/builder/approved_plan_builder_v1.ts
//
// Phase 1C-A — Part D: ApprovedPlan Builder — IMPLEMENTATION.
//
// AI PROPOSES (Part B) -> PART C VALIDATES -> PART D TRANSLATES -> existing
// constructCanonicalTopology (phase1c-b) EXECUTES. This file is PART D ONLY:
//   - takes EnvelopeTopologyV1, RawTopology, SemanticPlanProposal, and
//     SemanticPlanValidationResultV1 (all four, per the approved design)
//   - returns an ApprovedPlanBuildResultV1 (BUILT with a real ApprovedPlan,
//     or BLOCKED with plan:null and every applicable blocking reason)
//   - performs NO mutation of any input
//   - NEVER reruns Part C -- validation.readiness is taken as authoritative
//   - NEVER decides semantic truth, repairs topology, or infers geometry
//   - translates ONLY execution-ready EDGE semantic decisions
//     (KEEP_ENVELOPE, REJECT_NOT_ENVELOPE) into PlanOperation entries the
//     existing phase1c-b constructor already knows how to execute
//   - is fully deterministic: identical input -> byte-identical output. No
//     Date.now(), no Math.random(), no network, no I/O.
//
// AUTHORITY BOUNDARY (binding, do not exceed):
//   - does NOT translate proposal.vertexProposals into anything. They never
//     block Part D, never mutate a coordinate, never affect operation
//     construction. Changing them leaves the built ApprovedPlan byte-for-byte
//     identical.
//   - does NOT translate proposal.gapProposals. A non-empty gapProposals
//     list always blocks (GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1) -- no
//     CanonicalGap is ever created here, no endpoint is ever invented, no
//     gap is ever silently discarded.
//   - does NOT invent canon-* canonical ids. Those remain the existing
//     constructor's responsibility (canon-${rawEdgeId}); Part D only ever
//     emits PlanOperation.affectedRawEdges containing RAW edge ids.
//   - does NOT mutate any RAW coordinate. No x/y/xPct/yPct field is read or
//     written anywhere in this file.
//   - does NOT use proposal.reason as provenance/execution authority
//     anywhere (REASON_IS_NOT_PROOF, carried over unchanged from Part A/C).
//   - proposal.confidence is copied 1:1 into perEntityEvidence.semanticConfidence
//     as METADATA ONLY -- it never decides BUILT/BLOCKED, never decides
//     edge ownership, never decides execution eligibility. Operation-level
//     `confidence` is always the constant 'LOW' fail-safe; resolutionConfidence
//     is always 'NONE' (Part D resolves no geometry). No MIN aggregation, no
//     confidenceAggregation field is ever set.
//
// ORDERING AUTHORITY: raw.edges is the only ordering authority used anywhere
// in this file. proposal.edgeProposals array order is NEVER read for
// ordering -- edges are looked up by id via a Map, then walked in raw.edges
// order.
//
// SCOPE (binding, do not exceed): this file translates one execution-ready
// SemanticPlanProposal into one ApprovedPlan. It does not call OpenAI, does
// not touch any Edge Function, persistence, DB, Flutter, Witness, or the
// solver, and does not modify constructCanonicalTopology/validateCandidate
// (phase1c-b) or the canonical_topology_v1 contract in any way.

import type { EnvelopeTopologyV1 } from '../envelope_topology_schema_v1.ts';
import type { EnvelopeTopologyV2 } from '../envelope_topology_schema_v2.ts';
import type {
  RawTopology,
  ApprovedPlan,
  PlanOperation,
  PerEntityEvidence,
} from './model.ts';
import type { SemanticPlanProposal, EdgeSemanticProposal, ProposedVerificationScope } from './semantic_plan_proposal_v1.ts';
import type { SemanticPlanValidationResultV1 } from './semantic_plan_validation_result_v1.ts';
import type { ApprovedPlanBlockingReason, ApprovedPlanBuildResultV1 } from './approved_plan_build_result_v1.ts';

/**
 * Canonical scope grouping order (approved design, section 18/22). KEEP
 * edges are grouped into one PRESERVE_CONFIRMED_TOPOLOGY operation per
 * non-empty scope group, walked in this fixed order -- never in whatever
 * order distinct scope values happen to first appear in the proposal.
 */
const CANONICAL_SCOPE_ORDER: readonly ProposedVerificationScope[] = [
  'FULL_SPAN',
  'VISIBLE_SPAN',
  'LOCAL_ADJACENCY_CONFIRMED',
];

/**
 * Deterministic, edge-id-based evidence reference. A constant path back to
 * the exact field this evidence came from -- never a free-form/derived
 * string, never dependent on `reason`.
 */
function evidenceRefForEdge(rawEdgeId: string): string {
  return `semantic_plan_proposal_v1:edgeProposals:${rawEdgeId}`;
}

function blocked(reasons: readonly ApprovedPlanBlockingReason[]): ApprovedPlanBuildResultV1 {
  return {
    schemaVersion: 'approved_plan_build_result_v1',
    outcome: 'BLOCKED',
    plan: null,
    blockingReasons: reasons,
  };
}

/**
 * Pure, deterministic translation of one execution-ready SemanticPlanProposal
 * into an ApprovedPlan the existing phase1c-b constructor can execute
 * as-is. Performs NO mutation of `envelope`, `raw`, `proposal`, or
 * `validation`. Identical input -> byte-identical output.
 *
 * `envelope` is part of the approved input signature (kept symmetric with
 * Part C's own signature) but is not read by any translation step below --
 * Part D v1's algorithm operates entirely on `raw` and `proposal`, taking
 * `validation.readiness` as the sole authority on whether translation may
 * proceed at all.
 */
export function buildApprovedPlan(
  envelope: EnvelopeTopologyV1 | EnvelopeTopologyV2,
  raw: RawTopology,
  proposal: SemanticPlanProposal,
  validation: SemanticPlanValidationResultV1,
): ApprovedPlanBuildResultV1 {
  void envelope; // approved input signature; intentionally unused by v1 (see doc comment above)

  // ---------------------------------------------------------------------
  // STEP 0 -- fail-closed guards. Accumulate every applicable reason before
  // returning; never stop at the first one found.
  // ---------------------------------------------------------------------
  const blockingReasons: ApprovedPlanBlockingReason[] = [];

  if (validation.readiness.executionReadyForPartD !== true) {
    blockingReasons.push({
      key: 'VALIDATION_NOT_EXECUTION_READY',
      details:
        'validation.readiness.executionReadyForPartD is not true. Part D never re-runs Part C and treats this readiness verdict as authoritative -- no translation is attempted.',
    });
  }

  const keepMissingScopeEdgeIds = proposal.edgeProposals
    .filter((p) => p.disposition === 'KEEP_ENVELOPE' && p.verificationScope === null)
    .map((p) => p.rawEdgeId);
  if (keepMissingScopeEdgeIds.length > 0) {
    blockingReasons.push({
      key: 'KEEP_EDGE_MISSING_VERIFICATION_SCOPE',
      details: `KEEP_ENVELOPE edgeProposals with verificationScope=null (defense-in-depth check -- Part C's KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE rule should already block this upstream): ${keepMissingScopeEdgeIds.join(', ')}`,
    });
  }

  if (proposal.gapProposals.length > 0) {
    blockingReasons.push({
      key: 'GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1',
      details: `Part D v1 has no gap-translation authority (no CanonicalGap creation, no endpoint inference, no silent discard). gapProposals present: ${proposal.gapProposals.map((g) => g.gapId).join(', ')}`,
    });
  }

  if (blockingReasons.length > 0) {
    return blocked(blockingReasons);
  }

  // ---------------------------------------------------------------------
  // STEP 1 -- partition edges by disposition, walking raw.edges (the only
  // ordering authority) rather than proposal.edgeProposals array order.
  // ---------------------------------------------------------------------
  const proposalByEdgeId = new Map<string, EdgeSemanticProposal>(
    proposal.edgeProposals.map((p) => [p.rawEdgeId, p]),
  );

  const keepEdgesInRawOrder: EdgeSemanticProposal[] = [];
  const rejectEdgesInRawOrder: EdgeSemanticProposal[] = [];

  for (const rawEdge of raw.edges) {
    const edgeProposal = proposalByEdgeId.get(rawEdge.id);
    if (!edgeProposal) {
      // Step 0 already required executionReadyForPartD=true, which itself
      // requires (via Part C's EVERY_RAW_EDGE_HAS_PROPOSAL coverage rule)
      // that every RAW edge has a proposal. Reaching this means Part C's
      // own readiness verdict was inconsistent with the RawTopology
      // actually supplied here -- an impossible programmer/contract state,
      // not a semantic finding Part D is authorized to report as BLOCKED.
      throw new Error(
        `IMPOSSIBLE_STATE: validation.readiness.executionReadyForPartD was true, but RAW edge "${rawEdge.id}" has no edgeProposal at all.`,
      );
    }
    if (edgeProposal.disposition === 'KEEP_ENVELOPE') {
      keepEdgesInRawOrder.push(edgeProposal);
    } else if (edgeProposal.disposition === 'REJECT_NOT_ENVELOPE') {
      rejectEdgesInRawOrder.push(edgeProposal);
    } else {
      // UNRESOLVED / SPLIT_REQUIRED / REJECT_DUAL_FACE must never reach
      // here: executionReadyForPartD=true requires every perEdgeReadiness
      // entry to be EXECUTION_READY, which only KEEP_ENVELOPE/
      // REJECT_NOT_ENVELOPE ever achieve. Same impossible-state reasoning
      // as above -- never invent an operation for it.
      throw new Error(
        `IMPOSSIBLE_STATE: validation.readiness.executionReadyForPartD was true, but RAW edge "${rawEdge.id}" has disposition "${edgeProposal.disposition}", which can never be EXECUTION_READY.`,
      );
    }
  }

  const operations: PlanOperation[] = [];

  // ---------------------------------------------------------------------
  // STEP 2 -- KEEP_ENVELOPE -> PRESERVE_CONFIRMED_TOPOLOGY, grouped
  // deterministically by verificationScope in canonical scope order. One
  // operation per non-empty group.
  // ---------------------------------------------------------------------
  for (const scope of CANONICAL_SCOPE_ORDER) {
    const group = keepEdgesInRawOrder.filter((p) => p.verificationScope === scope);
    if (group.length === 0) continue;

    const perEntityEvidence: PerEntityEvidence[] = group.map((p) => ({
      edgeId: p.rawEdgeId,
      semanticStatus: 'KEEP_ENVELOPE',
      // Metadata only, copied 1:1 -- never read as execution authority.
      semanticConfidence: p.confidence,
      geometryAlignmentStatus: p.geometryAlignment,
      evidenceRef: evidenceRefForEdge(p.rawEdgeId),
    }));

    operations.push({
      operationId: `partd-preserve-${scope}`,
      operationType: 'PRESERVE_CONFIRMED_TOPOLOGY',
      affectedRawVertices: [],
      affectedRawEdges: group.map((p) => p.rawEdgeId),
      evidenceRefs: group.map((p) => evidenceRefForEdge(p.rawEdgeId)),
      perEntityEvidence,
      confidence: 'LOW',
      resolutionConfidence: 'NONE',
      planningDecisionDeterministic: true,
      executionDeterministic: true,
      requiresAdditionalEvidence: false,
      executionAllowed: true,
      deferTo: null,
      semanticVerificationScope: scope,
      provenanceNote: `Part D v1: deterministic translation of ${group.length} execution-ready KEEP_ENVELOPE edgeProposal(s) with verificationScope=${scope} into PRESERVE_CONFIRMED_TOPOLOGY. Source: SemanticPlanValidationResultV1 (executionReadyForPartD=true).`,
    });
  }

  // ---------------------------------------------------------------------
  // STEP 3 -- REJECT_NOT_ENVELOPE -> explicit DROP_REJECTED_EDGE, one
  // operation per rejected edge, in raw.edges order. Never relies on
  // omission to represent rejection.
  // ---------------------------------------------------------------------
  for (const p of rejectEdgesInRawOrder) {
    const perEntityEvidence: PerEntityEvidence[] = [
      {
        edgeId: p.rawEdgeId,
        semanticStatus: 'REJECT_NOT_ENVELOPE',
        semanticConfidence: p.confidence,
        geometryAlignmentStatus: p.geometryAlignment,
        evidenceRef: evidenceRefForEdge(p.rawEdgeId),
      },
    ];

    operations.push({
      operationId: `partd-drop-${p.rawEdgeId}`,
      operationType: 'DROP_REJECTED_EDGE',
      affectedRawVertices: [],
      affectedRawEdges: [p.rawEdgeId],
      evidenceRefs: [evidenceRefForEdge(p.rawEdgeId)],
      perEntityEvidence,
      confidence: 'LOW',
      resolutionConfidence: 'NONE',
      planningDecisionDeterministic: true,
      executionDeterministic: true,
      requiresAdditionalEvidence: false,
      executionAllowed: true,
      deferTo: null,
      provenanceNote: `Part D v1: deterministic, explicit translation of execution-ready REJECT_NOT_ENVELOPE edgeProposal for RAW edge ${p.rawEdgeId} into DROP_REJECTED_EDGE. Never represented by omission.`,
    });
  }

  const plan: ApprovedPlan = { operations };

  return {
    schemaVersion: 'approved_plan_build_result_v1',
    outcome: 'BUILT',
    plan,
    blockingReasons: [],
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovedPlan } from '../builder/approved_plan_builder_v1.js';
import { validateSemanticPlan } from '../validator/semantic_plan_validator_v1.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import { constructCanonicalTopology } from '../construct.js';
import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';
import type { RawTopology } from '../types/raw_audited_plan_model.js';
import type {
  SemanticPlanProposal,
  EdgeSemanticProposal,
} from '../types/semantic_plan_proposal_v1.js';
import type { SemanticPlanValidationResultV1 } from '../validator/semantic_plan_validation_result_v1.js';
import type { ApprovedPlanBuildResultV1 } from '../builder/approved_plan_build_result_v1.js';

/**
 * Narrowing assertion helper: asserts outcome==='BUILT' AND narrows the
 * static type so `.plan` is known non-null afterwards. Plain
 * `assert.equal(result.outcome, 'BUILT')` proves the same fact at runtime
 * but is not a TypeScript type guard, so `.plan` would still be typed
 * `ApprovedPlan | null` at every call site without this.
 */
function assertBuilt(
  result: ApprovedPlanBuildResultV1,
): asserts result is Extract<ApprovedPlanBuildResultV1, { outcome: 'BUILT' }> {
  assert.equal(
    result.outcome,
    'BUILT',
    result.outcome === 'BLOCKED' ? `expected BUILT, got BLOCKED: ${JSON.stringify(result.blockingReasons)}` : undefined,
  );
}

// =====================================================================
// Independent synthetic fixtures (NOT Attempt3 -- see approved test plan,
// 00_HANDOFF section 23). F1/F2/F3 share one rectangle envelope; F4 is a
// deliberately differently-shaped, differently-id'd triangle to prove
// genericity.
// =====================================================================

function edge(overrides: Partial<EdgeSemanticProposal> & { rawEdgeId: string }): EdgeSemanticProposal {
  return {
    disposition: 'KEEP_ENVELOPE',
    confidence: 'HIGH',
    geometryAlignment: 'ALIGNED',
    verificationScope: 'FULL_SPAN',
    dualFaceOf: null,
    reason: 'part d fixture',
    ...overrides,
  };
}

// --- F1/F2/F3 shared rectangle envelope: f1v1..f1v4 / f1e1..f1e4 ---

const rectEnvelope: EnvelopeTopologyV1 = {
  schemaVersion: 'envelope_topology_v1',
  vertices: [
    { id: 'f1v1', imagePct: { xPct: 0, yPct: 0 }, cornerAngleHint: 'orthogonal_90' },
    { id: 'f1v2', imagePct: { xPct: 100, yPct: 0 }, cornerAngleHint: 'orthogonal_90' },
    { id: 'f1v3', imagePct: { xPct: 100, yPct: 100 }, cornerAngleHint: 'orthogonal_90' },
    { id: 'f1v4', imagePct: { xPct: 0, yPct: 100 }, cornerAngleHint: 'orthogonal_90' },
  ],
  edges: [
    { id: 'f1e1', fromVertexId: 'f1v1', toVertexId: 'f1v2', axisHint: 'horizontal', roleHint: 'exterior_wall' },
    { id: 'f1e2', fromVertexId: 'f1v2', toVertexId: 'f1v3', axisHint: 'vertical', roleHint: 'exterior_wall' },
    { id: 'f1e3', fromVertexId: 'f1v3', toVertexId: 'f1v4', axisHint: 'horizontal', roleHint: 'exterior_wall' },
    { id: 'f1e4', fromVertexId: 'f1v4', toVertexId: 'f1v1', axisHint: 'vertical', roleHint: 'exterior_wall' },
  ],
  polygonOrder: ['f1v1', 'f1v2', 'f1v3', 'f1v4'],
  perceptionNotes: null,
};

const rectRaw: RawTopology = envelopeTopologyV1ToRawTopology(rectEnvelope);

/** F1: rectangle, all four edges KEEP_ENVELOPE + FULL_SPAN, no gaps. */
function f1Proposal(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'f1e1', geometryAlignment: 'ALIGNED' }),
      edge({ rawEdgeId: 'f1e2', geometryAlignment: 'NEAR' }),
      edge({ rawEdgeId: 'f1e3', geometryAlignment: 'ALIGNED' }),
      edge({ rawEdgeId: 'f1e4', geometryAlignment: 'ALIGNED' }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
}

/** F2: F1 with f1e3 = REJECT_NOT_ENVELOPE. */
function f2Proposal(): SemanticPlanProposal {
  const base = f1Proposal();
  return {
    ...base,
    edgeProposals: [
      base.edgeProposals[0]!,
      base.edgeProposals[1]!,
      edge({ rawEdgeId: 'f1e3', disposition: 'REJECT_NOT_ENVELOPE', verificationScope: null, geometryAlignment: 'NOT_AUDITED' }),
      base.edgeProposals[3]!,
    ],
  };
}

/** F3: rectangle, all KEEP_ENVELOPE but with mixed verificationScope. */
function f3Proposal(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'f1e1', verificationScope: 'FULL_SPAN' }),
      edge({ rawEdgeId: 'f1e2', verificationScope: 'VISIBLE_SPAN' }),
      edge({ rawEdgeId: 'f1e3', verificationScope: 'LOCAL_ADJACENCY_CONFIRMED' }),
      edge({ rawEdgeId: 'f1e4', verificationScope: 'FULL_SPAN' }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
}

// --- F4: independent, differently-shaped, differently-id'd triangle ---

const triEnvelope: EnvelopeTopologyV1 = {
  schemaVersion: 'envelope_topology_v1',
  vertices: [
    { id: 'g1v1', imagePct: { xPct: 0, yPct: 0 }, cornerAngleHint: null },
    { id: 'g1v2', imagePct: { xPct: 60, yPct: 0 }, cornerAngleHint: null },
    { id: 'g1v3', imagePct: { xPct: 30, yPct: 60 }, cornerAngleHint: null },
  ],
  edges: [
    { id: 'g1e1', fromVertexId: 'g1v1', toVertexId: 'g1v2', axisHint: 'horizontal', roleHint: 'exterior_wall' },
    { id: 'g1e2', fromVertexId: 'g1v2', toVertexId: 'g1v3', axisHint: 'diagonal_or_unknown', roleHint: 'exterior_wall' },
    { id: 'g1e3', fromVertexId: 'g1v3', toVertexId: 'g1v1', axisHint: 'diagonal_or_unknown', roleHint: 'exterior_wall' },
  ],
  polygonOrder: ['g1v1', 'g1v2', 'g1v3'],
  perceptionNotes: null,
};

const triRaw: RawTopology = envelopeTopologyV1ToRawTopology(triEnvelope);

function f4Proposal(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'g1e1', confidence: 'MEDIUM' }),
      edge({ rawEdgeId: 'g1e2', confidence: 'MEDIUM_HIGH', verificationScope: 'VISIBLE_SPAN' }),
      edge({ rawEdgeId: 'g1e3', confidence: 'LOW' }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
}

// =====================================================================
// BUILT: F1 -- fully valid, all-KEEP, single scope
// =====================================================================

test('F1: a fully valid all-KEEP_ENVELOPE/FULL_SPAN proposal BUILDS with blockingReasons empty', () => {
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, f1Proposal());
  assert.equal(validation.readiness.executionReadyForPartD, true, JSON.stringify(validation.readiness));
  const result = buildApprovedPlan(rectEnvelope, rectRaw, f1Proposal(), validation);
  assertBuilt(result);
  assert.equal(result.schemaVersion, 'approved_plan_build_result_v1');
  assert.deepEqual(result.blockingReasons, []);
  assert.ok(result.plan);
});

test('F1: the existing phase1c-b constructor accepts the generated ApprovedPlan without throwing', () => {
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, f1Proposal());
  const result = buildApprovedPlan(rectEnvelope, rectRaw, f1Proposal(), validation);
  assertBuilt(result);
  assert.doesNotThrow(() => constructCanonicalTopology(rectRaw, result.plan, 'f1-candidate'));
});

test('F1: canonical topology contains exactly the KEEP edges, with canon-${rawEdgeId} ids, and no rejected edge', () => {
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, f1Proposal());
  const result = buildApprovedPlan(rectEnvelope, rectRaw, f1Proposal(), validation);
  assertBuilt(result);
  const candidate = constructCanonicalTopology(rectRaw, result.plan, 'f1-candidate');
  assert.deepEqual(
    candidate.edges.map((e) => e.canonicalEdgeId).sort(),
    ['canon-f1e1', 'canon-f1e2', 'canon-f1e3', 'canon-f1e4'],
  );
  for (const e of candidate.edges) {
    assert.equal(e.sourceRawEdgeIds.length, 1);
    assert.equal(`canon-${e.sourceRawEdgeIds[0]}`, e.canonicalEdgeId);
  }
});

test('F1: geometryAlignment metadata from the proposal reaches the canonical edge geometryVerificationStatus verbatim', () => {
  const proposal = f1Proposal();
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  assertBuilt(result);
  const candidate = constructCanonicalTopology(rectRaw, result.plan, 'f1-candidate');
  const byId = new Map(candidate.edges.map((e) => [e.sourceRawEdgeIds[0], e]));
  assert.equal(byId.get('f1e1')!.geometryVerificationStatus, 'ALIGNED');
  assert.equal(byId.get('f1e2')!.geometryVerificationStatus, 'NEAR');
});

// =====================================================================
// BUILT: F2 -- one REJECT_NOT_ENVELOPE edge
// =====================================================================

test('F2: a rejected edge never becomes canonical, and an explicit DROP_REJECTED_EDGE operation is emitted (never represented by omission)', () => {
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, f2Proposal());
  assert.equal(validation.readiness.executionReadyForPartD, true, JSON.stringify(validation.readiness));
  const result = buildApprovedPlan(rectEnvelope, rectRaw, f2Proposal(), validation);
  assertBuilt(result);

  const dropOps = result.plan.operations.filter((o) => o.operationType === 'DROP_REJECTED_EDGE');
  assert.equal(dropOps.length, 1);
  assert.deepEqual(dropOps[0]!.affectedRawEdges, ['f1e3']);

  const candidate = constructCanonicalTopology(rectRaw, result.plan, 'f2-candidate');
  assert.deepEqual(
    candidate.edges.map((e) => e.canonicalEdgeId).sort(),
    ['canon-f1e1', 'canon-f1e2', 'canon-f1e4'],
  );
  assert.ok(!candidate.edges.some((e) => e.sourceRawEdgeIds.includes('f1e3')));
});

// =====================================================================
// BUILT: F3 -- mixed verificationScope grouping
// =====================================================================

test('F3: KEEP edges are grouped deterministically by verificationScope, one PRESERVE_CONFIRMED_TOPOLOGY operation per non-empty group, in canonical scope order', () => {
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, f3Proposal());
  assert.equal(validation.readiness.executionReadyForPartD, true, JSON.stringify(validation.readiness));
  const result = buildApprovedPlan(rectEnvelope, rectRaw, f3Proposal(), validation);
  assertBuilt(result);

  const preserveOps = result.plan.operations.filter((o) => o.operationType === 'PRESERVE_CONFIRMED_TOPOLOGY');
  assert.equal(preserveOps.length, 3, JSON.stringify(preserveOps.map((o) => o.operationId)));

  // Canonical scope order: FULL_SPAN, VISIBLE_SPAN, LOCAL_ADJACENCY_CONFIRMED.
  assert.equal(preserveOps[0]!.semanticVerificationScope, 'FULL_SPAN');
  assert.deepEqual(preserveOps[0]!.affectedRawEdges, ['f1e1', 'f1e4']); // raw.edges order within the group
  assert.equal(preserveOps[1]!.semanticVerificationScope, 'VISIBLE_SPAN');
  assert.deepEqual(preserveOps[1]!.affectedRawEdges, ['f1e2']);
  assert.equal(preserveOps[2]!.semanticVerificationScope, 'LOCAL_ADJACENCY_CONFIRMED');
  assert.deepEqual(preserveOps[2]!.affectedRawEdges, ['f1e3']);

  assert.doesNotThrow(() => constructCanonicalTopology(rectRaw, result.plan, 'f3-candidate'));
  const candidate = constructCanonicalTopology(rectRaw, result.plan, 'f3-candidate');
  assert.deepEqual(
    candidate.edges.map((e) => e.canonicalEdgeId).sort(),
    ['canon-f1e1', 'canon-f1e2', 'canon-f1e3', 'canon-f1e4'],
  );
});

// =====================================================================
// BUILT: F4 -- generic, non-rectangle, differently-id'd topology
// =====================================================================

test('F4: an independent, non-rectangular, differently-id\'d triangle topology builds correctly -- no hardcoded ids anywhere in Part D', () => {
  const validation = validateSemanticPlan(triEnvelope, triRaw, f4Proposal());
  assert.equal(validation.readiness.executionReadyForPartD, true, JSON.stringify(validation.readiness));
  const result = buildApprovedPlan(triEnvelope, triRaw, f4Proposal(), validation);
  assertBuilt(result);
  const candidate = constructCanonicalTopology(triRaw, result.plan, 'f4-candidate');
  assert.deepEqual(
    candidate.edges.map((e) => e.canonicalEdgeId).sort(),
    ['canon-g1e1', 'canon-g1e2', 'canon-g1e3'],
  );
});

// =====================================================================
// BLOCKED
// =====================================================================

test('BLOCKED: executionReadyForPartD=false (an UNRESOLVED edge) -> outcome BLOCKED, plan:null, VALIDATION_NOT_EXECUTION_READY reported', () => {
  const proposal = f1Proposal();
  const withUnresolved: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      proposal.edgeProposals[0]!,
      proposal.edgeProposals[1]!,
      edge({ rawEdgeId: 'f1e3', disposition: 'UNRESOLVED', geometryAlignment: 'UNRESOLVED', verificationScope: null }),
      proposal.edgeProposals[3]!,
    ],
  };
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, withUnresolved);
  assert.equal(validation.readiness.executionReadyForPartD, false);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, withUnresolved, validation);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.plan, null);
  assert.ok(result.blockingReasons.some((r) => r.key === 'VALIDATION_NOT_EXECUTION_READY'));
});

test('BLOCKED: a SPLIT_REQUIRED edge -> executionReadyForPartD=false -> BLOCKED with VALIDATION_NOT_EXECUTION_READY', () => {
  const proposal = f1Proposal();
  const withSplit: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      proposal.edgeProposals[0]!,
      proposal.edgeProposals[1]!,
      edge({ rawEdgeId: 'f1e3', disposition: 'SPLIT_REQUIRED', verificationScope: null }),
      proposal.edgeProposals[3]!,
    ],
  };
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, withSplit);
  assert.equal(validation.readiness.executionReadyForPartD, false);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, withSplit, validation);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.plan, null);
  assert.ok(result.blockingReasons.some((r) => r.key === 'VALIDATION_NOT_EXECUTION_READY'));
});

test('BLOCKED: a REJECT_DUAL_FACE edge -> executionReadyForPartD=false -> BLOCKED with VALIDATION_NOT_EXECUTION_READY', () => {
  const proposal = f1Proposal();
  const withDualFace: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      proposal.edgeProposals[0]!,
      proposal.edgeProposals[1]!,
      edge({ rawEdgeId: 'f1e3', disposition: 'REJECT_DUAL_FACE', dualFaceOf: 'f1e1', geometryAlignment: 'NOT_AUDITED', verificationScope: null }),
      proposal.edgeProposals[3]!,
    ],
  };
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, withDualFace);
  assert.equal(validation.readiness.executionReadyForPartD, false);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, withDualFace, validation);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.plan, null);
  assert.ok(result.blockingReasons.some((r) => r.key === 'VALIDATION_NOT_EXECUTION_READY'));
});

test('BLOCKED (defense-in-depth): a KEEP_ENVELOPE edge with verificationScope=null still blocks Part D even if the supplied validation result (hypothetically, e.g. a future Part C regression) claims executionReadyForPartD=true', () => {
  const proposal = f1Proposal();
  const badKeep: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'f1e1', disposition: 'KEEP_ENVELOPE', verificationScope: null }),
      proposal.edgeProposals[1]!,
      proposal.edgeProposals[2]!,
      proposal.edgeProposals[3]!,
    ],
  };
  // Deliberately hand-built "ready" validation result, bypassing Part C
  // entirely, to prove Part D's own KEEP_EDGE_MISSING_VERIFICATION_SCOPE
  // guard is real and independent -- not merely decorative because Part C
  // already blocks this upstream in the normal path.
  const fakeReadyValidation: SemanticPlanValidationResultV1 = {
    schemaVersion: 'semantic_plan_validation_result_v1',
    ruleResults: [],
    informationalFindings: [],
    readiness: {
      contractValid: true,
      coverageValid: true,
      semanticPolicyValid: true,
      executionReadyForPartD: true,
    },
    perEdgeReadiness: rectRaw.edges.map((e) => ({
      rawEdgeId: e.id,
      status: 'EXECUTION_READY' as const,
      details: 'stubbed for defense-in-depth test',
    })),
  };
  const result = buildApprovedPlan(rectEnvelope, rectRaw, badKeep, fakeReadyValidation);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.plan, null);
  const reason = result.blockingReasons.find((r) => r.key === 'KEEP_EDGE_MISSING_VERIFICATION_SCOPE');
  assert.ok(reason, JSON.stringify(result.blockingReasons));
  assert.ok(reason!.details.includes('f1e1'));
});

test('BLOCKED: a non-empty gapProposals list blocks with GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1, even when every edge is otherwise execution-ready', () => {
  const proposal: SemanticPlanProposal = {
    ...f1Proposal(),
    gapProposals: [
      { gapId: 'gap-1', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: ['f1e2'], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' },
    ],
  };
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  // Empirically, a well-formed gap does not by itself fail Part C readiness.
  assert.equal(validation.readiness.executionReadyForPartD, true, JSON.stringify(validation.readiness));
  const result = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.plan, null);
  const reason = result.blockingReasons.find((r) => r.key === 'GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1');
  assert.ok(reason, JSON.stringify(result.blockingReasons));
  assert.ok(reason!.details.includes('gap-1'));
  // No CanonicalGap was invented, no gap was silently discarded -- it is
  // reported as an explicit blocking reason instead.
});

test('BLOCKED: multiple applicable blocking reasons are all accumulated in one result, not just the first one found', () => {
  const proposal = f1Proposal();
  const notReadyWithGap: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      proposal.edgeProposals[0]!,
      proposal.edgeProposals[1]!,
      edge({ rawEdgeId: 'f1e3', disposition: 'UNRESOLVED', geometryAlignment: 'UNRESOLVED', verificationScope: null }),
      proposal.edgeProposals[3]!,
    ],
    gapProposals: [
      { gapId: 'gap-x', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: ['f1e2'], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' },
    ],
  };
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, notReadyWithGap);
  assert.equal(validation.readiness.executionReadyForPartD, false);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, notReadyWithGap, validation);
  assert.equal(result.outcome, 'BLOCKED');
  const keys = result.blockingReasons.map((r) => r.key).sort();
  assert.deepEqual(keys, ['GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1', 'VALIDATION_NOT_EXECUTION_READY']);
});

// =====================================================================
// PURITY / AUTHORITY
// =====================================================================

test('PURITY: changing vertexProposals alone leaves the built ApprovedPlan byte-for-byte identical', () => {
  const proposal = f1Proposal();
  const validationA = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const resultA = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validationA);

  const withVertexProposals: SemanticPlanProposal = {
    ...proposal,
    vertexProposals: [{ rawVertexId: 'f1v1', finding: 'MISALIGNED', confidence: 'HIGH', reason: 'irrelevant to Part D v1' }],
  };
  const validationB = validateSemanticPlan(rectEnvelope, rectRaw, withVertexProposals);
  const resultB = buildApprovedPlan(rectEnvelope, rectRaw, withVertexProposals, validationB);

  assert.deepEqual(resultA, resultB);
});

test('PURITY: reordering proposal.edgeProposals does not change the built ApprovedPlan (raw.edges is the only ordering authority)', () => {
  const proposal = f3Proposal();
  const validationA = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const resultA = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validationA);

  const reordered: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [...proposal.edgeProposals].reverse(),
  };
  const validationB = validateSemanticPlan(rectEnvelope, rectRaw, reordered);
  const resultB = buildApprovedPlan(rectEnvelope, rectRaw, reordered, validationB);

  assert.deepEqual(resultA, resultB);
});

test('PURITY: changing reason strings does not change the built ApprovedPlan', () => {
  const proposal = f1Proposal();
  const validationA = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const resultA = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validationA);

  const reworded: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: proposal.edgeProposals.map((p) => ({ ...p, reason: 'a completely different, much longer explanatory reason string' })),
  };
  const validationB = validateSemanticPlan(rectEnvelope, rectRaw, reworded);
  const resultB = buildApprovedPlan(rectEnvelope, rectRaw, reworded, validationB);

  assert.deepEqual(resultA, resultB);
});

test('PURITY/AUTHORITY: changing confidence changes only perEntityEvidence metadata, never BUILT/BLOCKED outcome, edge ownership, or the constant operation-level confidence/resolutionConfidence', () => {
  const proposal = f1Proposal();
  const validationA = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const resultA = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validationA);
  assertBuilt(resultA);

  const lowConfidence: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: proposal.edgeProposals.map((p) => ({ ...p, confidence: 'LOW' as const })),
  };
  const validationB = validateSemanticPlan(rectEnvelope, rectRaw, lowConfidence);
  const resultB = buildApprovedPlan(rectEnvelope, rectRaw, lowConfidence, validationB);
  assertBuilt(resultB);

  // Operation-level confidence/resolutionConfidence are the constant
  // fail-safe values regardless of proposal.confidence.
  for (const op of resultA.plan.operations) {
    assert.equal(op.confidence, 'LOW');
    assert.equal(op.resolutionConfidence, 'NONE');
    assert.equal('confidenceAggregation' in op, false, 'confidenceAggregation must never be set by Part D');
  }
  for (const op of resultB.plan.operations) {
    assert.equal(op.confidence, 'LOW');
    assert.equal(op.resolutionConfidence, 'NONE');
  }

  // Edge ownership / operation shape is identical between the two calls...
  assert.deepEqual(
    resultA.plan.operations.map((o) => ({ operationId: o.operationId, affectedRawEdges: o.affectedRawEdges })),
    resultB.plan.operations.map((o) => ({ operationId: o.operationId, affectedRawEdges: o.affectedRawEdges })),
  );
  // ...but perEntityEvidence[].semanticConfidence metadata does track the
  // proposal's confidence, per edge.
  const metaA = resultA.plan.operations.flatMap((o) => o.perEntityEvidence.map((pe) => pe.semanticConfidence));
  const metaB = resultB.plan.operations.flatMap((o) => o.perEntityEvidence.map((pe) => pe.semanticConfidence));
  assert.ok(metaA.some((c) => c === 'HIGH'));
  assert.ok(metaB.every((c) => c === 'LOW'));
});

test('PURITY: buildApprovedPlan mutates neither envelope, raw, proposal, nor validation', () => {
  const proposal = f1Proposal();
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const envelopeBefore = JSON.parse(JSON.stringify(rectEnvelope));
  const rawBefore = JSON.parse(JSON.stringify(rectRaw));
  const proposalBefore = JSON.parse(JSON.stringify(proposal));
  const validationBefore = JSON.parse(JSON.stringify(validation));

  buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);

  assert.deepEqual(rectEnvelope, envelopeBefore);
  assert.deepEqual(rectRaw, rawBefore);
  assert.deepEqual(proposal, proposalBefore);
  assert.deepEqual(validation, validationBefore);
});

test('PURITY: buildApprovedPlan is deterministic -- identical input produces deep-equal output across repeated calls', () => {
  const proposal = f3Proposal();
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const r1 = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  const r2 = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  assert.deepEqual(r1, r2);
});

test('AUTHORITY: no canon-* id is ever produced by Part D itself -- every affectedRawEdges entry is a bare RAW edge id', () => {
  const proposal = f1Proposal();
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  assertBuilt(result);
  for (const op of result.plan.operations) {
    for (const id of op.affectedRawEdges) {
      assert.ok(!id.startsWith('canon-'), `Part D must never emit a canon-* id itself: found "${id}"`);
    }
  }
});

test('AUTHORITY: no PlanOperation coordinate is ever set -- Part D reads/writes no x/y/xPct/yPct field', () => {
  const proposal = f1Proposal();
  const validation = validateSemanticPlan(rectEnvelope, rectRaw, proposal);
  const result = buildApprovedPlan(rectEnvelope, rectRaw, proposal, validation);
  assertBuilt(result);
  const serialized = JSON.stringify(result.plan);
  assert.ok(!/"x"\s*:/.test(serialized) && !/"xPct"/.test(serialized) && !/"yPct"/.test(serialized));
});

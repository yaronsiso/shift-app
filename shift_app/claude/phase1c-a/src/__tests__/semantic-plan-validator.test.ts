import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSemanticPlan, validateSemanticPlanAgainstEnvelope } from '../validator/semantic_plan_validator_v1.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';
import type { RawTopology } from '../types/raw_audited_plan_model.js';
import type { SemanticPlanProposal, EdgeSemanticProposal } from '../types/semantic_plan_proposal_v1.js';

// sampleEnvelope: vertices v1-v4, edges e1(h)-e2(v)-e3(diag/opening)-e4(v)

const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);

function edge(overrides: Partial<EdgeSemanticProposal> & { rawEdgeId: string }): EdgeSemanticProposal {
  return {
    disposition: 'KEEP_ENVELOPE',
    confidence: 'HIGH',
    geometryAlignment: 'ALIGNED',
    verificationScope: 'FULL_SPAN',
    dualFaceOf: null,
    reason: 'test fixture',
    ...overrides,
  };
}

/** Fully covered, fully passing proposal: all four edges KEEP_ENVELOPE, no gaps. */
function fullyCoveredKeepAllProposal(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'e1' }),
      edge({ rawEdgeId: 'e2' }),
      edge({ rawEdgeId: 'e3' }),
      edge({ rawEdgeId: 'e4' }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
}

// =====================================================================
// TOP-LEVEL: fully passing proposal
// =====================================================================

test('a fully valid, fully-covered, all-KEEP_ENVELOPE proposal is executionReadyForPartD with every edge EXECUTION_READY', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  assert.equal(result.schemaVersion, 'semantic_plan_validation_result_v1');
  assert.ok(result.ruleResults.every((r) => r.passed), JSON.stringify(result.ruleResults, null, 2));
  assert.equal(result.readiness.contractValid, true);
  assert.equal(result.readiness.coverageValid, true);
  assert.equal(result.readiness.semanticPolicyValid, true);
  assert.equal(result.readiness.executionReadyForPartD, true);
  assert.equal(result.perEdgeReadiness.length, 4);
  assert.ok(result.perEdgeReadiness.every((r) => r.status === 'EXECUTION_READY'));
  assert.deepEqual(result.informationalFindings, []);
});

test('ruleResults contains exactly the expected 12 rules (7 Part A + 2 new CONTRACT + 2 COVERAGE + 1 SEMANTIC_POLICY)', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  const ruleNames = result.ruleResults.map((r) => r.rule).sort();
  assert.deepEqual(ruleNames, [
    'DUAL_FACE_FIELD_MATCHES_DISPOSITION',
    'DUAL_FACE_NO_SELF_REFERENCE',
    'DUAL_FACE_TARGET_MUST_EXIST',
    'EDGE_REF_MUST_EXIST',
    'ENVELOPE_RAW_CONSISTENCY',
    'EVERY_RAW_EDGE_HAS_PROPOSAL',
    'GAP_REF_MUST_EXIST',
    'GAP_REQUIRES_TOPOLOGY_CONTEXT',
    'NO_DUPLICATE_EDGE_PROPOSAL',
    'NO_DUPLICATE_GAP_PROPOSAL',
    'NO_DUPLICATE_VERTEX_PROPOSAL',
    'VERTEX_REF_MUST_EXIST',
  ]);
  assert.equal(result.ruleResults.length, 12);
});

test('categories are correctly attributed to each rule', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  const byName = new Map(result.ruleResults.map((r) => [r.rule, r.category]));
  for (const r of [
    'EDGE_REF_MUST_EXIST',
    'VERTEX_REF_MUST_EXIST',
    'GAP_REF_MUST_EXIST',
    'NO_DUPLICATE_EDGE_PROPOSAL',
    'NO_DUPLICATE_VERTEX_PROPOSAL',
    'DUAL_FACE_TARGET_MUST_EXIST',
    'DUAL_FACE_NO_SELF_REFERENCE',
    'ENVELOPE_RAW_CONSISTENCY',
    'NO_DUPLICATE_GAP_PROPOSAL',
  ]) {
    assert.equal(byName.get(r as never), 'CONTRACT', r);
  }
  assert.equal(byName.get('EVERY_RAW_EDGE_HAS_PROPOSAL'), 'COVERAGE');
  assert.equal(byName.get('GAP_REQUIRES_TOPOLOGY_CONTEXT'), 'COVERAGE');
  assert.equal(byName.get('DUAL_FACE_FIELD_MATCHES_DISPOSITION'), 'SEMANTIC_POLICY');
});

// =====================================================================
// CONTRACT: Part A rules are reused, not reimplemented (spot check via
// a known-failing case for one of them, mirrored from Part A's own test)
// =====================================================================

test('CONTRACT: EDGE_REF_MUST_EXIST (imported from Part A) fails the whole contract category when an edgeProposal references a nonexistent RAW edge', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [edge({ rawEdgeId: 'e999' }), ...proposal.edgeProposals.slice(1)],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  const rule = result.ruleResults.find((r) => r.rule === 'EDGE_REF_MUST_EXIST')!;
  assert.equal(rule.passed, false);
  assert.equal(result.readiness.contractValid, false);
  assert.equal(result.readiness.executionReadyForPartD, false);
});

// =====================================================================
// CONTRACT: ENVELOPE_RAW_CONSISTENCY (new)
// =====================================================================

test('CONTRACT: ENVELOPE_RAW_CONSISTENCY passes when raw is exactly the RawTopology derived from envelope', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, true);
});

test('CONTRACT: ENVELOPE_RAW_CONSISTENCY fails when a raw vertex xPct differs from the envelope by even 0.0001 (not epsilon-tolerant)', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices.map((v) => (v.id === 'v1' ? { ...v, xPct: v.xPct + 0.0001 } : v)),
    edges: raw.edges,
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.equal(result.readiness.contractValid, false);
});

test('CONTRACT: ENVELOPE_RAW_CONSISTENCY fails when a raw edge id set differs from envelope-derived (extra edge)', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices,
    edges: [...raw.edges, { id: 'e-extra', fromVertexId: 'v1', toVertexId: 'v3' }],
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
});

test('validateSemanticPlanAgainstEnvelope makes ENVELOPE_RAW_CONSISTENCY trivially pass (documented tautology), by construction', () => {
  const result = validateSemanticPlanAgainstEnvelope(sampleEnvelope, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, true);
});

test('ENVELOPE_RAW_CONSISTENCY: reordered_vertices_still_envelope_raw_consistent', () => {
  const reorderedRaw: RawTopology = {
    vertices: [...raw.vertices].reverse(),
    edges: raw.edges,
  };
  const result = validateSemanticPlan(sampleEnvelope, reorderedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, true, rule.details);
});

test('ENVELOPE_RAW_CONSISTENCY: reordered_edges_still_envelope_raw_consistent', () => {
  const reorderedRaw: RawTopology = {
    vertices: raw.vertices,
    edges: [...raw.edges].reverse(),
  };
  const result = validateSemanticPlan(sampleEnvelope, reorderedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, true, rule.details);
});

test('ENVELOPE_RAW_CONSISTENCY: reordering both vertices and edges simultaneously still passes', () => {
  const reorderedRaw: RawTopology = {
    vertices: [...raw.vertices].reverse(),
    edges: [...raw.edges].reverse(),
  };
  const result = validateSemanticPlan(sampleEnvelope, reorderedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, true, rule.details);
});

test('ENVELOPE_RAW_CONSISTENCY: same_ids_but_vertex_coordinate_changed_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices.map((v) => (v.id === 'v2' ? { ...v, yPct: v.yPct + 5 } : v)),
    edges: raw.edges,
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('v2'));
});

test('ENVELOPE_RAW_CONSISTENCY: same_edge_id_but_endpoint_changed_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices,
    edges: raw.edges.map((e) => (e.id === 'e1' ? { ...e, toVertexId: 'v3' } : e)),
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('e1'));
});

test('ENVELOPE_RAW_CONSISTENCY: missing_vertex_id_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices.filter((v) => v.id !== 'v4'),
    edges: raw.edges,
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('v4'));
});

test('ENVELOPE_RAW_CONSISTENCY: extra_vertex_id_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: [...raw.vertices, { id: 'v-extra', xPct: 50, yPct: 50 }],
    edges: raw.edges,
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('v-extra'));
});

test('ENVELOPE_RAW_CONSISTENCY: missing_edge_id_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices,
    edges: raw.edges.filter((e) => e.id !== 'e4'),
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('e4'));
});

test('ENVELOPE_RAW_CONSISTENCY: extra_edge_id_fails', () => {
  const tamperedRaw: RawTopology = {
    vertices: raw.vertices,
    edges: [...raw.edges, { id: 'e-extra', fromVertexId: 'v1', toVertexId: 'v3' }],
  };
  const result = validateSemanticPlan(sampleEnvelope, tamperedRaw, fullyCoveredKeepAllProposal());
  const rule = result.ruleResults.find((r) => r.rule === 'ENVELOPE_RAW_CONSISTENCY')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('e-extra'));
});

// =====================================================================
// CONTRACT: NO_DUPLICATE_GAP_PROPOSAL (new)
// =====================================================================

test('CONTRACT: NO_DUPLICATE_GAP_PROPOSAL passes with unique gapIds', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    gapProposals: [
      { gapId: 'gap-1', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: ['e2'], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' },
      { gapId: 'gap-2', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: ['e3'], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' },
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const rule = result.ruleResults.find((r) => r.rule === 'NO_DUPLICATE_GAP_PROPOSAL')!;
  assert.equal(rule.passed, true);
});

test('CONTRACT: NO_DUPLICATE_GAP_PROPOSAL fails when the same gapId appears twice', () => {
  const dupGap = { gapId: 'gap-dup', gapType: 'SOURCE_OCCLUDED' as const, relatedRawEdgeIds: ['e2'], knownEndpointRawVertexIds: [], confidence: 'LOW' as const, reason: 'r' };
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    gapProposals: [dupGap, { ...dupGap, relatedRawEdgeIds: ['e3'] }],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const rule = result.ruleResults.find((r) => r.rule === 'NO_DUPLICATE_GAP_PROPOSAL')!;
  assert.equal(rule.passed, false);
  assert.equal(result.readiness.contractValid, false);
});

// =====================================================================
// COVERAGE: EVERY_RAW_EDGE_HAS_PROPOSAL
// =====================================================================

test('COVERAGE: EVERY_RAW_EDGE_HAS_PROPOSAL fails when a RAW edge has no edgeProposal at all', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const missingOne: SemanticPlanProposal = { ...proposal, edgeProposals: proposal.edgeProposals.slice(0, 3) }; // e4 missing
  const result = validateSemanticPlan(sampleEnvelope, raw, missingOne);
  const rule = result.ruleResults.find((r) => r.rule === 'EVERY_RAW_EDGE_HAS_PROPOSAL')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('e4'));
  assert.equal(result.readiness.coverageValid, false);
  assert.equal(result.readiness.executionReadyForPartD, false);
});

test('COVERAGE: EVERY_RAW_EDGE_HAS_PROPOSAL passes when an edge is proposed as UNRESOLVED (UNRESOLVED counts as coverage)', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const withUnresolved: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      ...proposal.edgeProposals.slice(0, 3),
      edge({ rawEdgeId: 'e4', disposition: 'UNRESOLVED', geometryAlignment: 'UNRESOLVED', verificationScope: null }),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, withUnresolved);
  const rule = result.ruleResults.find((r) => r.rule === 'EVERY_RAW_EDGE_HAS_PROPOSAL')!;
  assert.equal(rule.passed, true);
  assert.equal(result.readiness.coverageValid, true);
  // But NOT execution ready overall, because e4 itself is UNRESOLVED.
  assert.equal(result.readiness.executionReadyForPartD, false);
  const e4Readiness = result.perEdgeReadiness.find((r) => r.rawEdgeId === 'e4')!;
  assert.equal(e4Readiness.status, 'NOT_EXECUTION_READY_UNRESOLVED');
});

// =====================================================================
// COVERAGE: GAP_REQUIRES_TOPOLOGY_CONTEXT
// =====================================================================

test('COVERAGE: GAP_REQUIRES_TOPOLOGY_CONTEXT passes when a gap has only relatedRawEdgeIds (vertex array empty)', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    gapProposals: [{ gapId: 'g1', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: ['e2'], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' }],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  assert.equal(result.ruleResults.find((r) => r.rule === 'GAP_REQUIRES_TOPOLOGY_CONTEXT')!.passed, true);
});

test('COVERAGE: GAP_REQUIRES_TOPOLOGY_CONTEXT passes when a gap has only knownEndpointRawVertexIds (edge array empty)', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    gapProposals: [{ gapId: 'g1', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: [], knownEndpointRawVertexIds: ['v2'], confidence: 'LOW', reason: 'r' }],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  assert.equal(result.ruleResults.find((r) => r.rule === 'GAP_REQUIRES_TOPOLOGY_CONTEXT')!.passed, true);
});

test('COVERAGE: GAP_REQUIRES_TOPOLOGY_CONTEXT fails when both arrays are empty (floating gap) -- unlike Part A, Part C DOES enforce this', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    gapProposals: [{ gapId: 'g-floating', gapType: 'UNSUPPORTED_BOUNDARY_RELATION', relatedRawEdgeIds: [], knownEndpointRawVertexIds: [], confidence: 'LOW', reason: 'r' }],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const rule = result.ruleResults.find((r) => r.rule === 'GAP_REQUIRES_TOPOLOGY_CONTEXT')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('g-floating'));
  assert.equal(result.readiness.coverageValid, false);
});

// =====================================================================
// SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION (symmetric)
// =====================================================================

test('SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION fails when disposition=REJECT_DUAL_FACE but dualFaceOf=null', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: null }),
      ...proposal.edgeProposals.slice(1),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  const rule = result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!;
  assert.equal(rule.passed, false);
  assert.ok(rule.details.includes('e1'));
  assert.equal(result.readiness.semanticPolicyValid, false);
});

test('SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION fails when dualFaceOf is set but disposition is KEEP_ENVELOPE (the symmetric direction)', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE', dualFaceOf: 'e2' }),
      ...proposal.edgeProposals.slice(1),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  const rule = result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!;
  assert.equal(rule.passed, false);
  assert.equal(result.readiness.semanticPolicyValid, false);
});

test('SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION fails when dualFaceOf is set but disposition is SPLIT_REQUIRED', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'SPLIT_REQUIRED', dualFaceOf: 'e2', verificationScope: null }),
      ...proposal.edgeProposals.slice(1),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!.passed, false);
});

test('SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION fails when dualFaceOf is set but disposition is UNRESOLVED', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'UNRESOLVED', dualFaceOf: 'e2', geometryAlignment: 'UNRESOLVED', verificationScope: null }),
      ...proposal.edgeProposals.slice(1),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!.passed, false);
});

test('SEMANTIC_POLICY: DUAL_FACE_FIELD_MATCHES_DISPOSITION passes for REJECT_DUAL_FACE with a valid dualFaceOf target', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const ok: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: 'e3', geometryAlignment: 'NOT_AUDITED', verificationScope: null }),
      ...proposal.edgeProposals.slice(1),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, ok);
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!.passed, true);
});

// =====================================================================
// UNVERIFIED_NOT_EXECUTABLE: REJECT_DUAL_FACE passing everything still
// isn't proof (the central Part C design invariant)
// =====================================================================

test('a REJECT_DUAL_FACE edge that passes field checks AND reference checks (DUAL_FACE_TARGET_MUST_EXIST, DUAL_FACE_NO_SELF_REFERENCE, DUAL_FACE_FIELD_MATCHES_DISPOSITION) is still perEdgeReadiness=UNVERIFIED_NOT_EXECUTABLE, never EXECUTION_READY', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: 'e3', geometryAlignment: 'NOT_AUDITED', verificationScope: null }),
      edge({ rawEdgeId: 'e2' }),
      edge({ rawEdgeId: 'e3' }),
      edge({ rawEdgeId: 'e4' }),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  // All referential + policy rules touching e1's dual-face fields pass.
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_TARGET_MUST_EXIST')!.passed, true);
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_NO_SELF_REFERENCE')!.passed, true);
  assert.equal(result.ruleResults.find((r) => r.rule === 'DUAL_FACE_FIELD_MATCHES_DISPOSITION')!.passed, true);
  // Yet e1 is never EXECUTION_READY.
  const e1Readiness = result.perEdgeReadiness.find((r) => r.rawEdgeId === 'e1')!;
  assert.equal(e1Readiness.status, 'UNVERIFIED_NOT_EXECUTABLE');
  assert.equal(result.readiness.executionReadyForPartD, false);
});

// =====================================================================
// informationalFindings: SPLIT_REQUIRED_PRESENT / DUAL_FACE_PROOF_NOT_AVAILABLE
// =====================================================================

test('informationalFindings contains SPLIT_REQUIRED_PRESENT when a SPLIT_REQUIRED edge exists, with no passed field on the finding object', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'SPLIT_REQUIRED', verificationScope: null }),
      edge({ rawEdgeId: 'e2' }),
      edge({ rawEdgeId: 'e3' }),
      edge({ rawEdgeId: 'e4' }),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const finding = result.informationalFindings.find((f) => f.key === 'SPLIT_REQUIRED_PRESENT');
  assert.ok(finding, JSON.stringify(result.informationalFindings));
  assert.deepEqual(finding!.affectedRawEdgeIds, ['e1']);
  assert.ok(!('passed' in finding!), 'informational findings must never carry a passed:boolean field');
});

test('informationalFindings contains DUAL_FACE_PROOF_NOT_AVAILABLE when a REJECT_DUAL_FACE edge exists, with no passed field', () => {
  const proposal: SemanticPlanProposal = {
    ...fullyCoveredKeepAllProposal(),
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: 'e3', geometryAlignment: 'NOT_AUDITED', verificationScope: null }),
      edge({ rawEdgeId: 'e2' }),
      edge({ rawEdgeId: 'e3' }),
      edge({ rawEdgeId: 'e4' }),
    ],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const finding = result.informationalFindings.find((f) => f.key === 'DUAL_FACE_PROOF_NOT_AVAILABLE');
  assert.ok(finding);
  assert.deepEqual(finding!.affectedRawEdgeIds, ['e1']);
  assert.ok(!('passed' in finding!));
});

test('informationalFindings is empty when no SPLIT_REQUIRED and no REJECT_DUAL_FACE dispositions are present', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  assert.deepEqual(result.informationalFindings, []);
});

// =====================================================================
// perEdgeReadiness completeness and status-per-disposition matrix
// =====================================================================

test('perEdgeReadiness has exactly one entry per RAW edge, in RAW edge order', () => {
  const result = validateSemanticPlan(sampleEnvelope, raw, fullyCoveredKeepAllProposal());
  assert.deepEqual(result.perEdgeReadiness.map((r) => r.rawEdgeId), raw.edges.map((e) => e.id));
});

test('perEdgeReadiness status matrix: KEEP_ENVELOPE/REJECT_NOT_ENVELOPE=EXECUTION_READY, UNRESOLVED=NOT_EXECUTION_READY_UNRESOLVED, SPLIT_REQUIRED=NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR, REJECT_DUAL_FACE(valid target)=UNVERIFIED_NOT_EXECUTABLE', () => {
  const proposal: SemanticPlanProposal = {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE' }),
      edge({ rawEdgeId: 'e2', disposition: 'REJECT_NOT_ENVELOPE', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN' }),
      edge({ rawEdgeId: 'e3', disposition: 'UNRESOLVED', geometryAlignment: 'UNRESOLVED', verificationScope: null }),
      edge({ rawEdgeId: 'e4', disposition: 'SPLIT_REQUIRED', verificationScope: null }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const byId = new Map(result.perEdgeReadiness.map((r) => [r.rawEdgeId, r.status]));
  assert.equal(byId.get('e1'), 'EXECUTION_READY');
  assert.equal(byId.get('e2'), 'EXECUTION_READY');
  assert.equal(byId.get('e3'), 'NOT_EXECUTION_READY_UNRESOLVED');
  assert.equal(byId.get('e4'), 'NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR');
  // Whole proposal not execution-ready because not every edge is EXECUTION_READY.
  assert.equal(result.readiness.executionReadyForPartD, false);
  // But contract/coverage/semanticPolicy ARE all individually valid here.
  assert.equal(result.readiness.contractValid, true);
  assert.equal(result.readiness.coverageValid, true);
  assert.equal(result.readiness.semanticPolicyValid, true);
});

test('a RAW edge with no proposal at all gets perEdgeReadiness NOT_EXECUTION_READY_UNRESOLVED (not a crash, not an invented EXECUTION_READY)', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const missingE4: SemanticPlanProposal = { ...proposal, edgeProposals: proposal.edgeProposals.slice(0, 3) };
  const result = validateSemanticPlan(sampleEnvelope, raw, missingE4);
  const e4 = result.perEdgeReadiness.find((r) => r.rawEdgeId === 'e4')!;
  assert.equal(e4.status, 'NOT_EXECUTION_READY_UNRESOLVED');
});

// =====================================================================
// "Contract/coverage failure fails the WHOLE proposal" -- executionReadyForPartD
// is false immediately, without needing per-edge inspection to explain why
// =====================================================================

test('executionReadyForPartD is false whenever contractValid is false, even if every individual edge disposition looks otherwise fine', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const dupProposal: SemanticPlanProposal = { ...proposal, edgeProposals: [...proposal.edgeProposals, { ...proposal.edgeProposals[0]! }] };
  const result = validateSemanticPlan(sampleEnvelope, raw, dupProposal);
  assert.equal(result.readiness.contractValid, false);
  assert.equal(result.readiness.executionReadyForPartD, false);
});

test('executionReadyForPartD is false whenever coverageValid is false', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const missingOne: SemanticPlanProposal = { ...proposal, edgeProposals: proposal.edgeProposals.slice(0, 3) };
  const result = validateSemanticPlan(sampleEnvelope, raw, missingOne);
  assert.equal(result.readiness.coverageValid, false);
  assert.equal(result.readiness.executionReadyForPartD, false);
});

test('executionReadyForPartD is false whenever semanticPolicyValid is false', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const bad: SemanticPlanProposal = {
    ...proposal,
    edgeProposals: [edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: null }), ...proposal.edgeProposals.slice(1)],
  };
  const result = validateSemanticPlan(sampleEnvelope, raw, bad);
  assert.equal(result.readiness.semanticPolicyValid, false);
  assert.equal(result.readiness.executionReadyForPartD, false);
});

// =====================================================================
// Purity / determinism / no-mutation / no reason-or-confidence-as-proof
// =====================================================================

test('validateSemanticPlan does not mutate envelope, raw, or proposal', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const envelopeBefore = JSON.parse(JSON.stringify(sampleEnvelope));
  const rawBefore = JSON.parse(JSON.stringify(raw));
  const proposalBefore = JSON.parse(JSON.stringify(proposal));
  validateSemanticPlan(sampleEnvelope, raw, proposal);
  assert.deepEqual(sampleEnvelope, envelopeBefore);
  assert.deepEqual(raw, rawBefore);
  assert.deepEqual(proposal, proposalBefore);
});

test('validateSemanticPlan is deterministic: identical input produces deep-equal output across repeated calls', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const r1 = validateSemanticPlan(sampleEnvelope, raw, proposal);
  const r2 = validateSemanticPlan(sampleEnvelope, raw, proposal);
  assert.deepEqual(r1, r2);
});

test('a low-confidence, terse-reason REJECT_DUAL_FACE proposal is treated identically to a high-confidence, detailed-reason one -- reason/confidence never affect any rule outcome', () => {
  const base = fullyCoveredKeepAllProposal();
  const terse: SemanticPlanProposal = {
    ...base,
    edgeProposals: [
      edge({ rawEdgeId: 'e1', disposition: 'REJECT_DUAL_FACE', dualFaceOf: 'e3', confidence: 'LOW', reason: '', geometryAlignment: 'NOT_AUDITED', verificationScope: null }),
      ...base.edgeProposals.slice(1),
    ],
  };
  const detailed: SemanticPlanProposal = {
    ...base,
    edgeProposals: [
      edge({
        rawEdgeId: 'e1',
        disposition: 'REJECT_DUAL_FACE',
        dualFaceOf: 'e3',
        confidence: 'HIGH',
        reason: 'Extremely thorough, well-argued, persuasive explanation with many supporting details and cross-references.',
        geometryAlignment: 'NOT_AUDITED',
        verificationScope: null,
      }),
      ...base.edgeProposals.slice(1),
    ],
  };
  const rTerse = validateSemanticPlan(sampleEnvelope, raw, terse);
  const rDetailed = validateSemanticPlan(sampleEnvelope, raw, detailed);
  // Strip reason/confidence-bearing fields is unnecessary -- results should
  // be identical in every rule/readiness/perEdgeReadiness outcome (details
  // strings reference edge ids, not reason/confidence content).
  assert.deepEqual(rTerse.readiness, rDetailed.readiness);
  assert.deepEqual(
    rTerse.perEdgeReadiness.map((r) => r.status),
    rDetailed.perEdgeReadiness.map((r) => r.status),
  );
  assert.deepEqual(
    rTerse.ruleResults.map((r) => ({ rule: r.rule, passed: r.passed })),
    rDetailed.ruleResults.map((r) => ({ rule: r.rule, passed: r.passed })),
  );
});

// =====================================================================
// Sanity: validateSemanticPlanAgainstEnvelope wrapper delegates correctly
// =====================================================================

test('validateSemanticPlanAgainstEnvelope produces the same result as calling validateSemanticPlan with the adapter-derived RawTopology directly', () => {
  const proposal = fullyCoveredKeepAllProposal();
  const viaWrapper = validateSemanticPlanAgainstEnvelope(sampleEnvelope, proposal);
  const viaDirect = validateSemanticPlan(sampleEnvelope, envelopeTopologyV1ToRawTopology(sampleEnvelope), proposal);
  assert.deepEqual(viaWrapper, viaDirect);
});

// =====================================================================
// Sanity: a probe EnvelopeTopologyV1 unrelated to sampleEnvelope, to make
// sure nothing here is accidentally hardcoded to the fixture's specific ids
// =====================================================================

test('validator works correctly against an independent minimal 3-edge triangle envelope, not just sampleEnvelope', () => {
  const triangle: EnvelopeTopologyV1 = {
    schemaVersion: 'envelope_topology_v1',
    vertices: [
      { id: 't1', imagePct: { xPct: 0, yPct: 0 }, cornerAngleHint: null },
      { id: 't2', imagePct: { xPct: 50, yPct: 0 }, cornerAngleHint: null },
      { id: 't3', imagePct: { xPct: 25, yPct: 50 }, cornerAngleHint: null },
    ],
    edges: [
      { id: 'te1', fromVertexId: 't1', toVertexId: 't2', axisHint: 'horizontal', roleHint: 'exterior_wall' },
      { id: 'te2', fromVertexId: 't2', toVertexId: 't3', axisHint: 'diagonal_or_unknown', roleHint: 'exterior_wall' },
      { id: 'te3', fromVertexId: 't3', toVertexId: 't1', axisHint: 'diagonal_or_unknown', roleHint: 'exterior_wall' },
    ],
    polygonOrder: ['t1', 't2', 't3'],
    perceptionNotes: null,
  };
  const triangleRaw = envelopeTopologyV1ToRawTopology(triangle);
  const proposal: SemanticPlanProposal = {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      edge({ rawEdgeId: 'te1' }),
      edge({ rawEdgeId: 'te2' }),
      edge({ rawEdgeId: 'te3' }),
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
  const result = validateSemanticPlan(triangle, triangleRaw, proposal);
  assert.equal(result.readiness.executionReadyForPartD, true);
  assert.equal(result.perEdgeReadiness.length, 3);
});

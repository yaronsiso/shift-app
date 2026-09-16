import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReferentialIntegrity, checkReferentialIntegrityAgainstEnvelope } from '../referential_integrity.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import type { SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';

const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope); // vertices v1-v4, edges e1-e4

function basePassingProposal(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      {
        rawEdgeId: 'e1',
        disposition: 'KEEP_ENVELOPE',
        confidence: 'HIGH',
        geometryAlignment: 'ALIGNED',
        verificationScope: 'FULL_SPAN',
        dualFaceOf: null,
        reason: 'Clean exterior wall line.',
      },
      {
        rawEdgeId: 'e3',
        disposition: 'REJECT_DUAL_FACE',
        confidence: 'MEDIUM',
        geometryAlignment: 'NOT_AUDITED',
        verificationScope: null,
        dualFaceOf: 'e1',
        reason: 'Appears to be the inner face of the same wall as e1.',
      },
    ],
    vertexProposals: [{ rawVertexId: 'v3', finding: 'UNRESOLVED', confidence: 'LOW', reason: 'Corner unclear.' }],
    gapProposals: [
      {
        gapId: 'gap-1',
        gapType: 'SOURCE_OCCLUDED',
        relatedRawEdgeIds: ['e2'],
        knownEndpointRawVertexIds: ['v2'],
        confidence: 'LOW',
        reason: 'Legend occludes this corner.',
      },
    ],
    notes: null,
  };
}

function allPassed(results: { passed: boolean }[]): boolean {
  return results.every((r) => r.passed);
}

test('a fully valid proposal passes every Part A referential-integrity rule', () => {
  const results = checkReferentialIntegrity(basePassingProposal(), raw);
  assert.equal(results.length, 7);
  assert.ok(allPassed(results), JSON.stringify(results, null, 2));
});

test('EDGE_REF_MUST_EXIST fails when an edgeProposal references a nonexistent RAW edge', () => {
  const proposal = basePassingProposal();
  const bad = { ...proposal, edgeProposals: [{ ...proposal.edgeProposals[0]!, rawEdgeId: 'e999' }] };
  const results = checkReferentialIntegrity(bad, raw);
  const rule = results.find((r) => r.rule === 'EDGE_REF_MUST_EXIST')!;
  assert.equal(rule.passed, false);
});

test('VERTEX_REF_MUST_EXIST fails when a vertexProposal references a nonexistent RAW vertex', () => {
  const proposal = basePassingProposal();
  const bad = { ...proposal, vertexProposals: [{ ...proposal.vertexProposals[0]!, rawVertexId: 'v999' }] };
  const results = checkReferentialIntegrity(bad, raw);
  const rule = results.find((r) => r.rule === 'VERTEX_REF_MUST_EXIST')!;
  assert.equal(rule.passed, false);
});

test('GAP_REF_MUST_EXIST fails when a gapProposal references a nonexistent edge or vertex', () => {
  const proposal = basePassingProposal();
  const badEdge = { ...proposal, gapProposals: [{ ...proposal.gapProposals[0]!, relatedRawEdgeIds: ['e999'] }] };
  const badVertex = {
    ...proposal,
    gapProposals: [{ ...proposal.gapProposals[0]!, knownEndpointRawVertexIds: ['v999'] }],
  };
  assert.equal(checkReferentialIntegrity(badEdge, raw).find((r) => r.rule === 'GAP_REF_MUST_EXIST')!.passed, false);
  assert.equal(checkReferentialIntegrity(badVertex, raw).find((r) => r.rule === 'GAP_REF_MUST_EXIST')!.passed, false);
});

test('NO_DUPLICATE_EDGE_PROPOSAL fails when the same rawEdgeId appears twice', () => {
  const proposal = basePassingProposal();
  const dup = { ...proposal, edgeProposals: [...proposal.edgeProposals, { ...proposal.edgeProposals[0]! }] };
  const rule = checkReferentialIntegrity(dup, raw).find((r) => r.rule === 'NO_DUPLICATE_EDGE_PROPOSAL')!;
  assert.equal(rule.passed, false);
});

test('NO_DUPLICATE_VERTEX_PROPOSAL fails when the same rawVertexId appears twice', () => {
  const proposal = basePassingProposal();
  const dup = { ...proposal, vertexProposals: [...proposal.vertexProposals, { ...proposal.vertexProposals[0]! }] };
  const rule = checkReferentialIntegrity(dup, raw).find((r) => r.rule === 'NO_DUPLICATE_VERTEX_PROPOSAL')!;
  assert.equal(rule.passed, false);
});

test('DUAL_FACE_TARGET_MUST_EXIST fails when dualFaceOf points to a nonexistent RAW edge', () => {
  const proposal = basePassingProposal();
  const bad = {
    ...proposal,
    edgeProposals: [proposal.edgeProposals[0]!, { ...proposal.edgeProposals[1]!, dualFaceOf: 'e999' }],
  };
  const rule = checkReferentialIntegrity(bad, raw).find((r) => r.rule === 'DUAL_FACE_TARGET_MUST_EXIST')!;
  assert.equal(rule.passed, false);
});

test('DUAL_FACE_NO_SELF_REFERENCE fails when dualFaceOf equals the proposal\'s own rawEdgeId', () => {
  const proposal = basePassingProposal();
  const bad = {
    ...proposal,
    edgeProposals: [proposal.edgeProposals[0]!, { ...proposal.edgeProposals[1]!, dualFaceOf: proposal.edgeProposals[1]!.rawEdgeId }],
  };
  const rule = checkReferentialIntegrity(bad, raw).find((r) => r.rule === 'DUAL_FACE_NO_SELF_REFERENCE')!;
  assert.equal(rule.passed, false);
});

test('passing DUAL_FACE_TARGET_MUST_EXIST + DUAL_FACE_NO_SELF_REFERENCE is NOT proof of a true dual-face relationship (DUAL_FACE_EXISTENCE_NOT_PROOF) -- Part A performs no such semantic check', () => {
  // e1 and e3 are, in the synthetic fixture, unrelated walls (top and bottom
  // of a rectangle) -- not plausibly the same physical wall's two faces.
  // Part A's checks pass anyway, because they check ONLY existence and
  // self-reference, exactly as documented. This test exists to make that
  // limitation explicit and regression-proof, not to validate correctness
  // of the dual-face claim itself (that is an open Part C question).
  const results = checkReferentialIntegrity(basePassingProposal(), raw);
  assert.ok(allPassed(results));
});

test('GAP_REQUIRES_TOPOLOGY_CONTEXT is intentionally NOT enforced by Part A: a gap with both arrays empty still passes every Part A rule', () => {
  const proposal = basePassingProposal();
  const ungroundedGap = {
    ...proposal,
    gapProposals: [
      {
        gapId: 'gap-floating',
        gapType: 'UNSUPPORTED_BOUNDARY_RELATION' as const,
        relatedRawEdgeIds: [],
        knownEndpointRawVertexIds: [],
        confidence: 'LOW' as const,
        reason: 'Floating gap with no topology anchor.',
      },
    ],
  };
  const results = checkReferentialIntegrity(ungroundedGap, raw);
  assert.ok(allPassed(results), 'Part A has no rule that rejects this -- GAP_REQUIRES_TOPOLOGY_CONTEXT is Part C scope');
});

test('checkReferentialIntegrityAgainstEnvelope produces identical results to checking the adapted RawTopology directly', () => {
  const proposal = basePassingProposal();
  const viaEnvelope = checkReferentialIntegrityAgainstEnvelope(proposal, sampleEnvelope);
  const viaRawTopology = checkReferentialIntegrity(proposal, envelopeTopologyV1ToRawTopology(sampleEnvelope));
  assert.deepEqual(viaEnvelope, viaRawTopology);
});

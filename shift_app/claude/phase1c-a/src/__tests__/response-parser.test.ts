import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemanticPlanProposalShape,
  parseAndCheckSemanticPlanProposalResponse,
  SemanticPlanProposalShapeError,
} from '../response/parse_semantic_plan_proposal_response.js';
import { SemanticPlanProposalForbiddenFieldError } from '../schema/semantic_plan_proposal_schema_v1.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import { sampleSemanticPlanResponse } from '../fixtures/sample_semantic_plan_response.js';

test('parseSemanticPlanProposalShape accepts a well-shaped response', () => {
  const parsed = parseSemanticPlanProposalShape(sampleSemanticPlanResponse);
  assert.deepEqual(parsed, sampleSemanticPlanResponse);
});

test('parseSemanticPlanProposalShape rejects a non-object root', () => {
  assert.throws(() => parseSemanticPlanProposalShape('not an object'), SemanticPlanProposalShapeError);
  assert.throws(() => parseSemanticPlanProposalShape(null), SemanticPlanProposalShapeError);
});

test('parseSemanticPlanProposalShape rejects a wrong schemaVersion', () => {
  const bad = { ...sampleSemanticPlanResponse, schemaVersion: 'something_else' };
  assert.throws(() => parseSemanticPlanProposalShape(bad), SemanticPlanProposalShapeError);
});

test('parseSemanticPlanProposalShape rejects non-array edgeProposals/vertexProposals/gapProposals', () => {
  assert.throws(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, edgeProposals: 'nope' }), SemanticPlanProposalShapeError);
  assert.throws(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, vertexProposals: {} }), SemanticPlanProposalShapeError);
  assert.throws(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, gapProposals: null }), SemanticPlanProposalShapeError);
});

test('parseSemanticPlanProposalShape accepts notes:null and notes:array, rejects other types', () => {
  assert.doesNotThrow(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, notes: null }));
  assert.doesNotThrow(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, notes: [] }));
  assert.throws(() => parseSemanticPlanProposalShape({ ...sampleSemanticPlanResponse, notes: 'nope' }), SemanticPlanProposalShapeError);
});

test('parseAndCheckSemanticPlanProposalResponse returns the proposal plus Part A referential-integrity results (no semantic promotion)', () => {
  const result = parseAndCheckSemanticPlanProposalResponse(sampleSemanticPlanResponse, sampleEnvelope);
  assert.deepEqual(result.proposal, sampleSemanticPlanResponse);
  assert.ok(result.referentialIntegrity.length > 0);
  assert.ok(result.referentialIntegrity.every((r) => r.passed));
  // No ApprovedPlan-shaped or decision-shaped field is ever produced here:
  assert.equal('approvedPlan' in result, false);
  assert.equal('accepted' in result, false);
  assert.equal('decision' in result, false);
});

test('parseAndCheckSemanticPlanProposalResponse throws via the Part A firewall on a forbidden field, before any referential check runs', () => {
  const malicious = {
    ...sampleSemanticPlanResponse,
    edgeProposals: [{ ...sampleSemanticPlanResponse.edgeProposals[0]!, isFullyClosed: true }],
  };
  assert.throws(() => parseAndCheckSemanticPlanProposalResponse(malicious, sampleEnvelope), SemanticPlanProposalForbiddenFieldError);
});

test('parseAndCheckSemanticPlanProposalResponse surfaces referential-integrity failures as data, not as a thrown decision', () => {
  const badRef = {
    ...sampleSemanticPlanResponse,
    edgeProposals: [{ ...sampleSemanticPlanResponse.edgeProposals[0]!, rawEdgeId: 'e999-does-not-exist' }],
  };
  const result = parseAndCheckSemanticPlanProposalResponse(badRef, sampleEnvelope);
  const edgeRefRule = result.referentialIntegrity.find((r) => r.rule === 'EDGE_REF_MUST_EXIST')!;
  assert.equal(edgeRefRule.passed, false);
});

test('complete edge coverage is representable end-to-end: the sample response has exactly one proposal per sample-envelope edge', () => {
  const rawEdgeIds = sampleEnvelope.edges.map((e) => e.id).sort();
  const proposedEdgeIds = sampleSemanticPlanResponse.edgeProposals.map((p) => p.rawEdgeId).sort();
  assert.deepEqual(proposedEdgeIds, rawEdgeIds);
});

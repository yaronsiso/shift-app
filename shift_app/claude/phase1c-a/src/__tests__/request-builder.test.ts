import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticPlanProposalRequest } from '../request/build_semantic_plan_request.js';
import { SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA } from '../schema/semantic_plan_proposal_schema_v1.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import type {
  SemanticPlanProposalTextPart,
  SemanticPlanProposalImagePart,
  SemanticPlanProposalUserMessage,
} from '../request/semantic_plan_request_types.js';

const IMAGE_URL = 'https://example.invalid/signed/cropped-image.png?token=abc';

function build() {
  return buildSemanticPlanProposalRequest(sampleEnvelope, IMAGE_URL);
}

function getUserMessage(request: ReturnType<typeof build>): SemanticPlanProposalUserMessage {
  const userMsg = request.messages.find((m): m is SemanticPlanProposalUserMessage => m.role === 'user');
  assert.ok(userMsg, 'expected a user message');
  return userMsg!;
}

function userTextPart(request: ReturnType<typeof build>): SemanticPlanProposalTextPart {
  const userMsg = getUserMessage(request);
  const textPart = userMsg.content.find((p): p is SemanticPlanProposalTextPart => p.type === 'text');
  assert.ok(textPart, 'expected a text content part in the user message');
  return textPart!;
}

test('request contains the full EnvelopeTopologyV1 (deep-equal round-trip out of the embedded JSON)', () => {
  const textPart = userTextPart(build());
  const jsonStart = textPart.text.indexOf('{');
  const embedded = JSON.parse(textPart.text.slice(jsonStart));
  assert.deepEqual(embedded, sampleEnvelope);
});

test('roleHint/cornerAngleHint/polygonOrder/perceptionNotes reach the model input', () => {
  const textPart = userTextPart(build());
  assert.ok(textPart.text.includes('"roleHint"'));
  assert.ok(textPart.text.includes('"cornerAngleHint"'));
  assert.ok(textPart.text.includes('"polygonOrder"'));
  assert.ok(textPart.text.includes('"perceptionNotes"'));
  // exact values from the fixture, not just key presence
  assert.ok(textPart.text.includes('"exterior_wall"'));
  assert.ok(textPart.text.includes('"opening"'));
});

test('RawTopology is never sent instead of EnvelopeTopologyV1 -- the embedded JSON is NOT RawTopology-shaped', () => {
  const textPart = userTextPart(build());
  const jsonStart = textPart.text.indexOf('{');
  const embedded = JSON.parse(textPart.text.slice(jsonStart));
  const rawTopologyEquivalent = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.notDeepEqual(embedded, rawTopologyEquivalent);
  // RawTopology has flat xPct/yPct directly on each vertex and no imagePct
  // wrapper, no roleHint, no polygonOrder, no perceptionNotes. Prove the
  // request text is NOT that reduced shape:
  assert.ok(textPart.text.includes('"imagePct"'), 'expected the imagePct wrapper (EnvelopeTopologyV1), not flattened RawTopology');
  assert.equal(JSON.stringify(rawTopologyEquivalent).includes('imagePct'), false);
  assert.equal(JSON.stringify(rawTopologyEquivalent).includes('roleHint'), false);
});

test('no PageDimensions, measurements, jobId, or metric data anywhere in the request payload', () => {
  const serialized = JSON.stringify(build());
  for (const forbidden of ['PageDimensions', 'jobId', 'meters', 'scale', 'dimensionRefs', 'areaMeters', 'metersPerPct']) {
    assert.equal(serialized.includes(forbidden), false, `request payload unexpectedly contains "${forbidden}"`);
  }
});

test('the cropped image is included exactly once', () => {
  const userMsg = getUserMessage(build());
  const imageParts = userMsg.content.filter((p): p is SemanticPlanProposalImagePart => p.type === 'image_url');
  assert.equal(imageParts.length, 1);
  assert.equal(imageParts[0]!.image_url.url, IMAGE_URL);
});

test('image URL passes through verbatim -- no resize/crop/coordinate transform applied in Part B', () => {
  const userMsg = getUserMessage(build());
  const imagePart = userMsg.content.find((p): p is SemanticPlanProposalImagePart => p.type === 'image_url')!;
  assert.equal(imagePart.image_url.url, IMAGE_URL);
});

test('image detail is "high", matching the existing production image-perception convention', () => {
  const userMsg = getUserMessage(build());
  const imagePart = userMsg.content.find((p): p is SemanticPlanProposalImagePart => p.type === 'image_url')!;
  assert.equal(imagePart.image_url.detail, 'high');
});

test('Part A schema is used directly by reference, never duplicated', () => {
  const request = build();
  assert.equal(request.responseFormat.type, 'json_schema');
  assert.equal(request.responseFormat.json_schema, SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA); // reference identity, not deep-equal
});

test('builder is pure: calling it twice produces deep-equal, independently-owned request objects', () => {
  const r1 = build();
  const r2 = build();
  assert.deepEqual(r1, r2);
  assert.notEqual(r1, r2);
});

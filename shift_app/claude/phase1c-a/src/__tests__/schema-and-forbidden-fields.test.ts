import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA,
  assertNoForbiddenSemanticPlanFields,
  assertNoForbiddenSemanticPlanEnumValues,
  SemanticPlanProposalForbiddenFieldError,
} from '../schema/semantic_plan_proposal_schema_v1.js';
import type { SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';

// ---- Structured Outputs strict-mode structural checks ---------------------

function walkObjectNodes(node: unknown, path: string, visit: (node: any, path: string) => void): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => walkObjectNodes(child, `${path}[${i}]`, visit));
    return;
  }
  const n = node as Record<string, unknown>;
  if (n.type === 'object' || (Array.isArray(n.type) && (n.type as string[]).includes('object'))) {
    visit(n, path);
  }
  for (const key of Object.keys(n)) {
    walkObjectNodes(n[key], `${path}.${key}`, visit);
  }
}

test('strict:true is set at the top level', () => {
  assert.equal(SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.strict, true);
});

test('every object node in the schema has additionalProperties:false', () => {
  const offenders: string[] = [];
  walkObjectNodes(SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.schema, '$', (node, path) => {
    if (node.additionalProperties !== false) offenders.push(path);
  });
  assert.deepEqual(offenders, []);
});

test('every object node lists ALL of its properties keys in required (Structured Outputs strict-mode rule)', () => {
  const offenders: string[] = [];
  walkObjectNodes(SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.schema, '$', (node, path) => {
    const propertyKeys = Object.keys(node.properties ?? {});
    const required: string[] = node.required ?? [];
    const missing = propertyKeys.filter((k) => !required.includes(k));
    if (missing.length > 0) offenders.push(`${path}: missing from required -> ${missing.join(',')}`);
  });
  assert.deepEqual(offenders, []);
});

// ---- Forbidden-content checklist (per the 9-item structural-impossibility
// checklist in ../types/semantic_plan_proposal_v1.ts) --------------------

const FORBIDDEN_SUBSTRINGS = [
  // canonical ids / candidate-layer identifiers
  'canonicalVertexId',
  'canonicalEdgeId',
  'candidateId',
  'candidateState',
  'stateFlags',
  // execution / solver authority
  'isFullyClosed',
  'executionAllowed',
  'executionDeterministic',
  'planningDecisionDeterministic',
  'CONSTRAINT_SOLVED',
  // coordinates / metric / scale
  'imagePct',
  '"xPct"',
  '"yPct"',
  'meters',
  'scale',
  'areaMeters',
  'dimensionRefs',
];

test('schema JSON contains none of the forbidden fields/values from the structural-impossibility checklist', () => {
  const serialized = JSON.stringify(SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA);
  const present = FORBIDDEN_SUBSTRINGS.filter((s) => serialized.includes(s));
  assert.deepEqual(present, [], `schema unexpectedly contains: ${present.join(', ')}`);
});

test('disposition enum has no CONSTRAINT_SOLVED value and has exactly the 5 approved SemanticStatus-shaped values', () => {
  const dispositionEnum = (SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.schema.properties.edgeProposals.items.properties
    .disposition as { enum: readonly string[] }).enum;
  assert.deepEqual(
    [...dispositionEnum].sort(),
    ['KEEP_ENVELOPE', 'REJECT_DUAL_FACE', 'REJECT_NOT_ENVELOPE', 'SPLIT_REQUIRED', 'UNRESOLVED'].sort(),
  );
});

test('vertexProposals.finding enum is only MISALIGNED/UNRESOLVED -- no RAW_OBSERVATION, no NOT_AUDITED, no CONSTRAINT_SOLVED', () => {
  const findingEnum = (SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.schema.properties.vertexProposals.items.properties
    .finding as { enum: readonly string[] }).enum;
  assert.deepEqual([...findingEnum].sort(), ['MISALIGNED', 'UNRESOLVED'].sort());
});

// ---- Runtime forbidden-field firewall --------------------------------------

function validProposal(): SemanticPlanProposal {
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
        reason: 'Clearly the exterior wall line.',
      },
    ],
    vertexProposals: [],
    gapProposals: [],
    notes: null,
  };
}

test('assertNoForbiddenSemanticPlanFields does not throw on a clean, valid proposal', () => {
  assert.doesNotThrow(() => assertNoForbiddenSemanticPlanFields(validProposal()));
});

test('assertNoForbiddenSemanticPlanFields throws when a forbidden field is injected anywhere in the tree', () => {
  const malicious = { ...validProposal(), edgeProposals: [{ ...validProposal().edgeProposals[0]!, xPct: 12.3 }] };
  assert.throws(() => assertNoForbiddenSemanticPlanFields(malicious), SemanticPlanProposalForbiddenFieldError);
});

test('assertNoForbiddenSemanticPlanFields throws on isFullyClosed/executionAllowed/canonicalEdgeId injection', () => {
  for (const field of ['isFullyClosed', 'executionAllowed', 'executionDeterministic', 'canonicalEdgeId', 'canonicalVertexId']) {
    const malicious = { ...validProposal(), [field]: true };
    assert.throws(
      () => assertNoForbiddenSemanticPlanFields(malicious),
      SemanticPlanProposalForbiddenFieldError,
      `expected throw for field "${field}"`,
    );
  }
});

test('assertNoForbiddenSemanticPlanEnumValues throws when CONSTRAINT_SOLVED appears as a value anywhere', () => {
  const malicious = {
    ...validProposal(),
    edgeProposals: [{ ...validProposal().edgeProposals[0]!, reason: 'CONSTRAINT_SOLVED' }],
  };
  assert.throws(() => assertNoForbiddenSemanticPlanEnumValues(malicious), SemanticPlanProposalForbiddenFieldError);
});

test('assertNoForbiddenSemanticPlanEnumValues does not throw on a clean proposal', () => {
  assert.doesNotThrow(() => assertNoForbiddenSemanticPlanEnumValues(validProposal()));
});

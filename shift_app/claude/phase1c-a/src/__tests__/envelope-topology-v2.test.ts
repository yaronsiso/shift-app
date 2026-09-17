import { test } from 'node:test';
import assert from 'node:assert/strict';

import { envelopeTopologyV2ToRawTopology } from '../adapter.js';
import {
  EnvelopeTopologyV2ForbiddenFieldError,
  parseEnvelopeTopologyV2,
  type EnvelopeTopologyV2,
} from '../envelope_topology_schema_v2.js';
import {
  ZERO_LENGTH_EPSILON_PCT_V2,
  validateEnvelopeTopologyV2,
} from '../envelope_topology_validators_v2.js';

function topology(
  overrides: Partial<EnvelopeTopologyV2> = {},
): EnvelopeTopologyV2 {
  return {
    schemaVersion: 'envelope_topology_v2',
    vertices: [
      { id: 'v1', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 50, yPct: 10 }, cornerAngleHint: null },
      { id: 'v3', imagePct: { xPct: 50, yPct: 60 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
      {
        id: 'e2',
        fromVertexId: 'v2',
        toVertexId: 'v3',
        axisHint: 'vertical',
        roleHint: 'exterior_wall',
      },
    ],
    perceptionNotes: null,
    ...overrides,
  };
}

function errorCodes(t: EnvelopeTopologyV2): string[] {
  return validateEnvelopeTopologyV2(t).errors.map((e) => e.code);
}

function diagnosticCodes(t: EnvelopeTopologyV2): string[] {
  return validateEnvelopeTopologyV2(t).diagnostics.map((d) => d.code);
}

test('V2 accepts an open graph: closure is diagnostic-only, never fatal', () => {
  const result = validateEnvelopeTopologyV2(topology());

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.diagnostics.some((d) => d.code === 'OPEN_GRAPH_ENDPOINTS'));
  assert.ok(result.diagnostics.some((d) => d.code === 'NOT_SINGLE_CLOSED_CYCLE'));
});

test('V2 accepts multiple disconnected components: component count is diagnostic-only', () => {
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 30, yPct: 10 }, cornerAngleHint: null },
      { id: 'v3', imagePct: { xPct: 70, yPct: 70 }, cornerAngleHint: null },
      { id: 'v4', imagePct: { xPct: 90, yPct: 70 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
      {
        id: 'e2',
        fromVertexId: 'v3',
        toVertexId: 'v4',
        axisHint: 'horizontal',
        roleHint: 'uncertain',
      },
    ],
  });

  const result = validateEnvelopeTopologyV2(t);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.diagnostics.some((d) => d.code === 'MULTIPLE_CONNECTED_COMPONENTS'));
});

test('axisHint disagreement is diagnostic-only and does not invalidate V2', () => {
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 10, yPct: 80 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
    ],
  });

  const result = validateEnvelopeTopologyV2(t);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.diagnostics.some((d) => d.code === 'AXIS_HINT_MISMATCH'));
});

test('duplicate vertex ids are fatal structural corruption', () => {
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
      { id: 'v1', imagePct: { xPct: 50, yPct: 10 }, cornerAngleHint: null },
    ],
    edges: [],
  });

  const result = validateEnvelopeTopologyV2(t);

  assert.equal(result.valid, false);
  assert.ok(errorCodes(t).includes('DUPLICATE_VERTEX_ID'));
});

test('duplicate edge ids are fatal structural corruption', () => {
  const t = topology({
    edges: [
      {
        id: 'duplicate-edge',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
      {
        id: 'duplicate-edge',
        fromVertexId: 'v2',
        toVertexId: 'v3',
        axisHint: 'vertical',
        roleHint: 'exterior_wall',
      },
    ],
  });

  assert.equal(validateEnvelopeTopologyV2(t).valid, false);
  assert.ok(errorCodes(t).includes('DUPLICATE_EDGE_ID'));
});

test('dangling vertex references are fatal structural corruption', () => {
  const t = topology({
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'missing-vertex',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
    ],
  });

  assert.equal(validateEnvelopeTopologyV2(t).valid, false);
  assert.ok(errorCodes(t).includes('EDGE_REFERENCES_UNKNOWN_VERTEX'));
});

test('non-finite coordinates are fatal structural corruption', () => {
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: Number.NaN, yPct: 10 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 50, yPct: 10 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
    ],
  });

  assert.equal(validateEnvelopeTopologyV2(t).valid, false);
  assert.ok(errorCodes(t).includes('MALFORMED_COORDINATE'));
});

test('zero-length edges are fatal structural corruption', () => {
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: 20, yPct: 20 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 20, yPct: 20 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'diagonal_or_unknown',
        roleHint: 'uncertain',
      },
    ],
  });

  assert.equal(validateEnvelopeTopologyV2(t).valid, false);
  assert.ok(errorCodes(t).includes('ZERO_LENGTH_EDGE'));
});

test('near-zero edges at less than the V2 epsilon are fatal', () => {
  const delta = ZERO_LENGTH_EPSILON_PCT_V2 / 2;
  const t = topology({
    vertices: [
      { id: 'v1', imagePct: { xPct: 20, yPct: 20 }, cornerAngleHint: null },
      { id: 'v2', imagePct: { xPct: 20 + delta, yPct: 20 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
    ],
  });

  assert.equal(validateEnvelopeTopologyV2(t).valid, false);
  assert.ok(errorCodes(t).includes('ZERO_LENGTH_EDGE'));
});

test('uncertain hints remain diagnostics and never become semantic rejection', () => {
  const t = topology({
    edges: [
      {
        id: 'e1',
        fromVertexId: 'v1',
        toVertexId: 'v2',
        axisHint: 'diagonal_or_unknown',
        roleHint: 'uncertain',
      },
    ],
  });

  const result = validateEnvelopeTopologyV2(t);

  assert.equal(result.valid, true);
  assert.ok(diagnosticCodes(t).includes('UNCERTAIN_HINT_PRESENT'));
});

test('parser rejects polygonOrder because V2 must not require a closed traversal', () => {
  const raw = {
    ...topology(),
    polygonOrder: ['v1', 'v2', 'v3'],
  };

  assert.throws(
    () => parseEnvelopeTopologyV2(raw),
    (error: unknown) =>
      error instanceof EnvelopeTopologyV2ForbiddenFieldError &&
      error.field === 'polygonOrder',
  );
});

test('parser rejects metric fields anywhere in the payload', () => {
  const raw = topology() as EnvelopeTopologyV2 & {
    metadata?: { metersPerPct?: number };
  };
  raw.metadata = { metersPerPct: 0.2 };

  assert.throws(
    () => parseEnvelopeTopologyV2(raw),
    (error: unknown) =>
      error instanceof EnvelopeTopologyV2ForbiddenFieldError &&
      error.field === 'metersPerPct',
  );
});

test('V2-to-Raw adapter preserves vertex ids, percentages, edge ids and connectivity exactly', () => {
  const t = topology({
    vertices: [
      { id: 'a', imagePct: { xPct: 12.345, yPct: 67.891 }, cornerAngleHint: null },
      { id: 'b', imagePct: { xPct: 55.5, yPct: 5.05 }, cornerAngleHint: null },
      { id: 'c', imagePct: { xPct: 99.9, yPct: 42.42 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'edge-h',
        fromVertexId: 'a',
        toVertexId: 'b',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
      {
        id: 'edge-u',
        fromVertexId: 'b',
        toVertexId: 'c',
        axisHint: 'diagonal_or_unknown',
        roleHint: 'uncertain',
      },
    ],
  });

  const raw = envelopeTopologyV2ToRawTopology(t);

  assert.deepEqual(
    raw.vertices,
    t.vertices.map((v) => ({
      id: v.id,
      xPct: v.imagePct.xPct,
      yPct: v.imagePct.yPct,
    })),
  );

  assert.equal(raw.edges.length, t.edges.length);
  assert.deepEqual(
    raw.edges.map((e) => [e.id, e.fromVertexId, e.toVertexId]),
    t.edges.map((e) => [e.id, e.fromVertexId, e.toVertexId]),
  );
});

test('V2-to-Raw adapter preserves horizontal/vertical hints and drops diagonal_or_unknown', () => {
  const t = topology({
    vertices: [
      { id: 'a', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: null },
      { id: 'b', imagePct: { xPct: 50, yPct: 10 }, cornerAngleHint: null },
      { id: 'c', imagePct: { xPct: 50, yPct: 80 }, cornerAngleHint: null },
      { id: 'd', imagePct: { xPct: 80, yPct: 50 }, cornerAngleHint: null },
    ],
    edges: [
      {
        id: 'h',
        fromVertexId: 'a',
        toVertexId: 'b',
        axisHint: 'horizontal',
        roleHint: 'exterior_wall',
      },
      {
        id: 'v',
        fromVertexId: 'b',
        toVertexId: 'c',
        axisHint: 'vertical',
        roleHint: 'exterior_wall',
      },
      {
        id: 'u',
        fromVertexId: 'c',
        toVertexId: 'd',
        axisHint: 'diagonal_or_unknown',
        roleHint: 'uncertain',
      },
    ],
  });

  const raw = envelopeTopologyV2ToRawTopology(t);

  assert.equal(raw.edges.find((e) => e.id === 'h')!.axisHint, 'horizontal');
  assert.equal(raw.edges.find((e) => e.id === 'v')!.axisHint, 'vertical');
  assert.equal(raw.edges.find((e) => e.id === 'u')!.axisHint, undefined);
});

test('V2-to-Raw adapter does not create, delete, merge, close or reorder topology', () => {
  const t = topology();
  const raw = envelopeTopologyV2ToRawTopology(t);

  assert.equal(raw.vertices.length, t.vertices.length);
  assert.equal(raw.edges.length, t.edges.length);
  assert.deepEqual(raw.vertices.map((v) => v.id), t.vertices.map((v) => v.id));
  assert.deepEqual(raw.edges.map((e) => e.id), t.edges.map((e) => e.id));
});

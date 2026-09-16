import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';

test('imagePct.xPct/yPct pass through to xPct/yPct verbatim, no transform', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  for (const envVertex of sampleEnvelope.vertices) {
    const rawVertex = raw.vertices.find((v) => v.id === envVertex.id);
    assert.ok(rawVertex, `expected raw vertex for ${envVertex.id}`);
    assert.equal(rawVertex!.xPct, envVertex.imagePct.xPct);
    assert.equal(rawVertex!.yPct, envVertex.imagePct.yPct);
  }
});

test('vertex ids are preserved exactly (same count, same id set, same order)', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.equal(raw.vertices.length, sampleEnvelope.vertices.length);
  assert.deepEqual(
    raw.vertices.map((v) => v.id),
    sampleEnvelope.vertices.map((v) => v.id),
  );
});

test('edge ids/fromVertexId/toVertexId are preserved exactly', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.equal(raw.edges.length, sampleEnvelope.edges.length);
  for (const envEdge of sampleEnvelope.edges) {
    const rawEdge = raw.edges.find((e) => e.id === envEdge.id);
    assert.ok(rawEdge, `expected raw edge for ${envEdge.id}`);
    assert.equal(rawEdge!.fromVertexId, envEdge.fromVertexId);
    assert.equal(rawEdge!.toVertexId, envEdge.toVertexId);
  }
});

test('axisHint: horizontal/vertical pass through; diagonal_or_unknown is dropped (undefined), never coerced', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.equal(raw.edges.find((e) => e.id === 'e1')!.axisHint, 'horizontal');
  assert.equal(raw.edges.find((e) => e.id === 'e2')!.axisHint, 'vertical');
  assert.equal(raw.edges.find((e) => e.id === 'e3')!.axisHint, undefined);
  assert.equal(raw.edges.find((e) => e.id === 'e4')!.axisHint, 'vertical');
});

test('no metric conversion: output values equal input percentages bit-for-bit, no scale factor applied', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  // Distinct, deliberately non-round percentages to catch any accidental
  // unit conversion (e.g. *0.01, /100, or a meters-per-pct multiplication).
  const probe: EnvelopeTopologyV1 = {
    schemaVersion: 'envelope_topology_v1',
    vertices: [
      { id: 'p1', imagePct: { xPct: 12.345, yPct: 67.891 }, cornerAngleHint: null },
      { id: 'p2', imagePct: { xPct: 55.5, yPct: 5.05 }, cornerAngleHint: null },
      { id: 'p3', imagePct: { xPct: 0.1, yPct: 99.9 }, cornerAngleHint: null },
    ],
    edges: [
      { id: 'pe1', fromVertexId: 'p1', toVertexId: 'p2', axisHint: 'horizontal', roleHint: 'exterior_wall' },
      { id: 'pe2', fromVertexId: 'p2', toVertexId: 'p3', axisHint: 'vertical', roleHint: 'exterior_wall' },
      { id: 'pe3', fromVertexId: 'p3', toVertexId: 'p1', axisHint: 'diagonal_or_unknown', roleHint: 'uncertain' },
    ],
    polygonOrder: ['p1', 'p2', 'p3'],
    perceptionNotes: null,
  };
  const rawProbe = envelopeTopologyV1ToRawTopology(probe);
  assert.equal(rawProbe.vertices.find((v) => v.id === 'p1')!.xPct, 12.345);
  assert.equal(rawProbe.vertices.find((v) => v.id === 'p1')!.yPct, 67.891);
  assert.equal(rawProbe.vertices.find((v) => v.id === 'p3')!.yPct, 99.9);
  assert.equal(void 0, undefined); // sanity anchor, no scale field exists to check against
});

test('no topology change: vertex/edge counts and connectivity are identical to input', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.equal(raw.vertices.length, 4);
  assert.equal(raw.edges.length, 4);
  const connectivity = raw.edges.map((e) => `${e.fromVertexId}->${e.toVertexId}`).sort();
  const expected = sampleEnvelope.edges.map((e) => `${e.fromVertexId}->${e.toVertexId}`).sort();
  assert.deepEqual(connectivity, expected);
});

test('no new vertices/edges are ever created: every output id has a matching input id, and vice versa', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  const inputVertexIds = new Set(sampleEnvelope.vertices.map((v) => v.id));
  const inputEdgeIds = new Set(sampleEnvelope.edges.map((e) => e.id));
  for (const v of raw.vertices) assert.ok(inputVertexIds.has(v.id), `unexpected new vertex id ${v.id}`);
  for (const e of raw.edges) assert.ok(inputEdgeIds.has(e.id), `unexpected new edge id ${e.id}`);
  assert.equal(raw.vertices.length, inputVertexIds.size);
  assert.equal(raw.edges.length, inputEdgeIds.size);
});

test('polygonOrder/roleHint/cornerAngleHint/perceptionNotes are not carried into RawTopology', () => {
  const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  const serialized = JSON.stringify(raw);
  // These are semantic/perception-evidence fields that belong only to
  // EnvelopeTopologyV1 for the future semantic-planning AI input -- they
  // must never leak into the constructor-facing RawTopology shape.
  assert.ok(!('polygonOrder' in raw), 'RawTopology must not carry polygonOrder');
  for (const v of raw.vertices) assert.ok(!('cornerAngleHint' in v), `RawVertex ${v.id} must not carry cornerAngleHint`);
  for (const e of raw.edges) assert.ok(!('roleHint' in e), `RawEdge ${e.id} must not carry roleHint`);
  assert.ok(!serialized.includes('perceptionNotes'), 'RawTopology must not carry perceptionNotes');
  assert.ok(!serialized.includes('imagePct'), 'RawTopology must not carry the imagePct wrapper');
});

test('adapter is pure: calling it twice on the same input produces deep-equal, independent output', () => {
  const raw1 = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  const raw2 = envelopeTopologyV1ToRawTopology(sampleEnvelope);
  assert.deepEqual(raw1, raw2);
  assert.notEqual(raw1, raw2); // different object identity, not the same reference
  assert.deepEqual(sampleEnvelope.vertices.map((v) => v.id), ['v1', 'v2', 'v3', 'v4']); // input untouched
});

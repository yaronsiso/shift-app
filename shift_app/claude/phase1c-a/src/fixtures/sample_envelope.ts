// claude/phase1c-a/src/fixtures/sample_envelope.ts
//
// Synthetic, hand-built Part A test fixture ONLY. This is NOT Attempt3 and
// is NOT a production fixture -- per explicit Phase 1C-A constraint,
// Attempt3 stays a phase1c-b regression fixture and must never become a
// source of production decisions or be reused as a "generic" test input
// elsewhere. This fixture exists solely to exercise the adapter and
// referential-integrity checks against a small, easy-to-reason-about
// EnvelopeTopologyV1 shape (a simple rectangle with one opening edge and
// one diagonal_or_unknown axis hint, to exercise the adapter's axisHint
// drop-path).

import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';

export const sampleEnvelope: EnvelopeTopologyV1 = {
  schemaVersion: 'envelope_topology_v1',
  vertices: [
    { id: 'v1', imagePct: { xPct: 10, yPct: 10 }, cornerAngleHint: 'orthogonal_90' },
    { id: 'v2', imagePct: { xPct: 90, yPct: 10 }, cornerAngleHint: 'orthogonal_90' },
    { id: 'v3', imagePct: { xPct: 90, yPct: 80 }, cornerAngleHint: 'uncertain' },
    { id: 'v4', imagePct: { xPct: 10, yPct: 80 }, cornerAngleHint: null },
  ],
  edges: [
    { id: 'e1', fromVertexId: 'v1', toVertexId: 'v2', axisHint: 'horizontal', roleHint: 'exterior_wall' },
    { id: 'e2', fromVertexId: 'v2', toVertexId: 'v3', axisHint: 'vertical', roleHint: 'exterior_wall' },
    { id: 'e3', fromVertexId: 'v3', toVertexId: 'v4', axisHint: 'diagonal_or_unknown', roleHint: 'opening' },
    { id: 'e4', fromVertexId: 'v4', toVertexId: 'v1', axisHint: 'vertical', roleHint: 'uncertain' },
  ],
  polygonOrder: ['v1', 'v2', 'v3', 'v4'],
  perceptionNotes: [{ vertexId: null, edgeId: 'e3', note: 'Possible door opening on south wall.' }],
};

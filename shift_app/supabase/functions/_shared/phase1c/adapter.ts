// claude/phase1c-a/src/adapter.ts
//
// Pure, deterministic adapter: EnvelopeTopologyV1 (production RAW artifact)
// -> RawTopology (constructCanonicalTopology's actual input contract,
// symlinked from phase1c-b/src/types/model.ts as ./types/raw_audited_plan_model.js).
//
// SCOPE (per the approved Phase 1C-A design correction): this adapter
// exists ONLY to reshape the contract for constructCanonicalTopology. It is
// NOT a replacement for EnvelopeTopologyV1 as the semantic-planning AI's
// input -- the future Part B AI call must receive the FULL EnvelopeTopologyV1
// (including roleHint, cornerAngleHint, polygonOrder, perceptionNotes) plus
// the cropped image directly, never this adapter's reduced RawTopology
// output. See ../types/semantic_plan_proposal_v1.ts and this file's tests
// for the explicit proof that roleHint/cornerAngleHint/polygonOrder/
// perceptionNotes are dropped here, not "invented into" RawTopology.
//
// This function performs NO metric conversion, NO scale, NO topology
// mutation, and creates NO new vertex/edge: every RawVertex/RawEdge in the
// output corresponds 1:1, by identical id, to an EnvelopeTopologyVertexV1/
// EnvelopeTopologyEdgeV1 in the input.

import type { EnvelopeTopologyV1, EdgeAxisHint } from '../envelope_topology_schema_v1.ts';
import type { EnvelopeTopologyV2, EdgeAxisHintV2 } from '../envelope_topology_schema_v2.ts';
import type { RawTopology, RawVertex, RawEdge } from './model.ts';

// RawEdge.axisHint only accepts 'horizontal' | 'vertical' (see
// raw_audited_plan_model.ts). EnvelopeTopologyV1's axisHint additionally
// allows 'diagonal_or_unknown'. That third value carries no information
// RawEdge can represent, so it is mapped to `undefined` (i.e. "no hint"),
// never coerced to 'horizontal' or 'vertical' -- inventing an axis would be
// a topology/geometry claim this adapter is not authorized to make.
function toRawAxisHint(axisHint: EdgeAxisHint): 'horizontal' | 'vertical' | undefined {
  if (axisHint === 'horizontal' || axisHint === 'vertical') return axisHint;
  return undefined;
}

export function envelopeTopologyV1ToRawTopology(envelope: EnvelopeTopologyV1): RawTopology {
  const vertices: RawVertex[] = envelope.vertices.map((v) => ({
    id: v.id,
    xPct: v.imagePct.xPct,
    yPct: v.imagePct.yPct,
  }));

  const edges: RawEdge[] = envelope.edges.map((e) => {
    const axisHint = toRawAxisHint(e.axisHint);
    return axisHint === undefined
      ? { id: e.id, fromVertexId: e.fromVertexId, toVertexId: e.toVertexId }
      : { id: e.id, fromVertexId: e.fromVertexId, toVertexId: e.toVertexId, axisHint };
  });

  return { vertices, edges };
}

// EnvelopeTopologyV2 -> RawTopology.
//
// Same scope discipline as the V1 adapter above: this exists ONLY to
// reshape the contract for constructCanonicalTopology. It is NOT a
// replacement for EnvelopeTopologyV2 as the semantic-planning AI's input --
// that call still receives the FULL EnvelopeTopologyV2 (including
// roleHint, cornerAngleHint, perceptionNotes), never this adapter's reduced
// RawTopology output. See buildSemanticPlanProposalRequest, which now
// accepts either EnvelopeTopologyV1 or EnvelopeTopologyV2 verbatim (its own
// body only ever JSON.stringifies the whole object -- it never reads a
// specific field of either shape, so no polygonOrder-shaped dependency
// exists there; confirmed by reading that file directly, not assumed).
//
// This function performs NO metric conversion, NO scale, NO topology
// mutation, and creates NO new vertex/edge: every RawVertex/RawEdge in the
// output corresponds 1:1, by identical id, to an EnvelopeTopologyVertexV2/
// EnvelopeTopologyEdgeV2 in the input. V2 has no polygonOrder to drop in
// the first place (see envelope_topology_schema_v2.ts) -- roleHint,
// cornerAngleHint, and perceptionNotes are dropped here exactly as they are
// for V1, for the same reason: RawTopology has no field for any of them.
function toRawAxisHintV2(axisHint: EdgeAxisHintV2): 'horizontal' | 'vertical' | undefined {
  if (axisHint === 'horizontal' || axisHint === 'vertical') return axisHint;
  return undefined;
}

export function envelopeTopologyV2ToRawTopology(envelope: EnvelopeTopologyV2): RawTopology {
  const vertices: RawVertex[] = envelope.vertices.map((v) => ({
    id: v.id,
    xPct: v.imagePct.xPct,
    yPct: v.imagePct.yPct,
  }));

  const edges: RawEdge[] = envelope.edges.map((e) => {
    const axisHint = toRawAxisHintV2(e.axisHint);
    return axisHint === undefined
      ? { id: e.id, fromVertexId: e.fromVertexId, toVertexId: e.toVertexId }
      : { id: e.id, fromVertexId: e.fromVertexId, toVertexId: e.toVertexId, axisHint };
  });

  return { vertices, edges };
}

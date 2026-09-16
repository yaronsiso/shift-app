// Phase 2-B Part B — strict JSON Schema for WitnessPerceptionCandidate.
//
// This is the actual contract that would be sent as OpenAI's
// response_format.json_schema.schema (strict:true). Every object node sets
// additionalProperties:false. There is no property anywhere in this tree
// named selectedAnchor, proofStatus, proofStrength, endpointConfidence,
// bindingStatus, bindingConfidence, promotionEligible, or anything metric —
// the model cannot return them even if it tries, because the schema gives
// it no slot to put them in.
//
// Per the OpenAI strict-mode constraint already learned and documented in
// envelope_topology_schema_v1.ts: every key under `properties` must also
// appear in `required`; "may be absent" is expressed as `type: [X, "null"]`
// with an explicit null value, never by omitting a key.

const TOPOLOGY_ANCHOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "canonicalVertexId", "canonicalEdgeId", "paramT"],
  properties: {
    kind: { type: "string", enum: ["VERTEX", "EDGE_POINT"] },
    // Present (possibly null) regardless of kind, per strict-mode's
    // required-with-nullable-type pattern. Sanitation (sanitation.ts)
    // enforces that VERTEX candidates have canonicalVertexId non-null and
    // canonicalEdgeId/paramT null, and vice versa for EDGE_POINT — the
    // schema alone cannot express "exactly one of these two shapes" under
    // strict:true's flat-object constraints, so that cross-field
    // consistency check is deterministic sanitation's job, not the
    // schema's.
    canonicalVertexId: { type: ["string", "null"] },
    canonicalEdgeId: { type: ["string", "null"] },
    paramT: { type: ["number", "null"] },
  },
} as const;

const IMAGE_GEOMETRY_EVIDENCE_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["sourceDimensionLineEndpoint", "projectionAxis", "visualRelationDescription"],
  properties: {
    sourceDimensionLineEndpoint: { type: "string", enum: ["lineStartPct", "lineEndPct"] },
    projectionAxis: { type: "string", enum: ["horizontal", "vertical", "diagonal", "unknown"] },
    visualRelationDescription: { type: "string" },
  },
} as const;

const ENDPOINT_PERCEPTION_PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidateAnchors",
    "suggestedAnchor",
    "proposedProofRelationType",
    "imageGeometryEvidence",
    "evidenceRefs",
    "proposalConfidence",
    "notes",
  ],
  properties: {
    // Empty array is explicitly allowed — the AI is never forced to
    // hallucinate a candidate.
    candidateAnchors: { type: "array", items: TOPOLOGY_ANCHOR_SCHEMA },
    // Nullable object: null when the AI has no single best guess. Same
    // shape as TOPOLOGY_ANCHOR_SCHEMA but with "null" added to type — built
    // explicitly (not via spread) so the type array isn't silently
    // overwritten by TOPOLOGY_ANCHOR_SCHEMA's own non-nullable "object" type.
    suggestedAnchor: {
      type: ["object", "null"],
      additionalProperties: false,
      required: TOPOLOGY_ANCHOR_SCHEMA.required,
      properties: TOPOLOGY_ANCHOR_SCHEMA.properties,
    },
    proposedProofRelationType: {
      type: ["string", "null"],
      enum: [
        "EXTENSION_LINE_INTERSECTION_VERIFIED",
        "EXTENSION_LINE_PROJECTION_INFERRED",
        "OTHER_SPATIAL_INFERENCE",
        null,
      ],
    },
    imageGeometryEvidence: IMAGE_GEOMETRY_EVIDENCE_SCHEMA,
    evidenceRefs: { type: "array", items: { type: "string" } },
    proposalConfidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
} as const;

const WITNESS_PERCEPTION_CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["measurementId", "startEndpointProposal", "endEndpointProposal"],
  properties: {
    measurementId: { type: "string" },
    startEndpointProposal: ENDPOINT_PERCEPTION_PROPOSAL_SCHEMA,
    endEndpointProposal: ENDPOINT_PERCEPTION_PROPOSAL_SCHEMA,
  },
} as const;

const SKIPPED_MEASUREMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["measurementId", "reason"],
  properties: {
    measurementId: { type: "string" },
    reason: { type: "string" },
  },
} as const;

export const WITNESS_PERCEPTION_RESPONSE_JSON_SCHEMA = {
  name: "witness_perception_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "skipped"],
    properties: {
      candidates: { type: "array", items: WITNESS_PERCEPTION_CANDIDATE_SCHEMA },
      skipped: { type: "array", items: SKIPPED_MEASUREMENT_SCHEMA },
    },
  },
} as const;

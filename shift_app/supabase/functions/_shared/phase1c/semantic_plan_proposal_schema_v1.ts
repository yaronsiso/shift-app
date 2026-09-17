// claude/phase1c-a/src/schema/semantic_plan_proposal_schema_v1.ts
//
// Strict JSON Schema for OpenAI Structured Outputs, matching
// ../types/semantic_plan_proposal_v1.ts exactly.
//
// Follows the same two conventions already established in this repo's
// envelope_topology_schema_v1.ts (see that file's header comment for the
// full rationale):
//   1. strict:true + additionalProperties:false on every object node.
//   2. every key listed under `properties` also appears in `required`;
//      a genuinely-optional field is expressed as a nullable union
//      (`type: [..., "null"]`, with `null` added to `enum` where present)
//      rather than omitted from `required`. The model returns an explicit
//      `null` instead of omitting the key.
//
// This schema has NO field for: coordinates (x/y/xPct/yPct), scale,
// meters/lengthMeters/area/areaMeters/dimensionRefs, canonicalVertexId/
// canonicalEdgeId, isFullyClosed, executionAllowed, executionDeterministic,
// or any CONSTRAINT_SOLVED enum value -- see the checklist in
// ../types/semantic_plan_proposal_v1.ts's file header. Do not add any of
// these to "pass through" convenience data from the model.

export const SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA = {
  name: 'semantic_plan_proposal_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'edgeProposals', 'vertexProposals', 'gapProposals', 'notes'],
    properties: {
      schemaVersion: { type: 'string', enum: ['semantic_plan_proposal_v1'] },

      edgeProposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'rawEdgeId',
            'disposition',
            'confidence',
            'geometryAlignment',
            'verificationScope',
            'dualFaceOf',
            'reason',
          ],
          properties: {
            rawEdgeId: { type: 'string' },
            disposition: {
              type: 'string',
              enum: ['KEEP_ENVELOPE', 'REJECT_NOT_ENVELOPE', 'REJECT_DUAL_FACE', 'SPLIT_REQUIRED', 'UNRESOLVED'],
            },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW'] },
            geometryAlignment: {
              type: 'string',
              enum: ['NOT_AUDITED', 'ALIGNED', 'NEAR', 'MISALIGNED', 'UNRESOLVED'],
            },
            verificationScope: {
              type: ['string', 'null'],
              enum: ['FULL_SPAN', 'VISIBLE_SPAN', 'LOCAL_ADJACENCY_CONFIRMED', null],
            },
            dualFaceOf: { type: ['string', 'null'] },
            reason: { type: 'string' },
          },
        },
      },

      vertexProposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rawVertexId', 'finding', 'confidence', 'reason'],
          properties: {
            rawVertexId: { type: 'string' },
            finding: { type: 'string', enum: ['MISALIGNED', 'UNRESOLVED'] },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW'] },
            reason: { type: 'string' },
          },
        },
      },

      gapProposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['gapId', 'gapType', 'relatedRawEdgeIds', 'knownEndpointRawVertexIds', 'confidence', 'reason'],
          properties: {
            gapId: { type: 'string' },
            gapType: {
              type: 'string',
              enum: ['OPENING_CONTINUATION_UNKNOWN', 'SOURCE_OCCLUDED', 'UNSUPPORTED_BOUNDARY_RELATION'],
            },
            relatedRawEdgeIds: { type: 'array', items: { type: 'string' } },
            knownEndpointRawVertexIds: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW'] },
            reason: { type: 'string' },
          },
        },
      },

      notes: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rawVertexId', 'rawEdgeId', 'note'],
          properties: {
            rawVertexId: { type: ['string', 'null'] },
            rawEdgeId: { type: ['string', 'null'] },
            note: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

// ---- Forbidden-field firewall ---------------------------------------------
// Defense-in-depth only, mirroring assertNoForbiddenFields in
// envelope_topology_schema_v1.ts: walks the raw parsed JSON recursively and
// throws if any forbidden key name appears anywhere. This does NOT replace
// additionalProperties:false above -- it exists for any path that doesn't
// enforce a strict schema at generation time (a manual retry, a provider
// swap, a hand-constructed test payload).
const SEMANTIC_PLAN_PROPOSAL_FORBIDDEN_FIELD_NAMES = [
  // metric / measurement / solver-authority fields
  'meters',
  'lengthMeters',
  'scale',
  'metersPerPct',
  'area',
  'areaMeters',
  'dimensionRefs',
  'paramT',
  'world',
  // coordinate fields
  'x',
  'y',
  'z',
  'xPct',
  'yPct',
  'coordinate',
  'imagePct',
  // canonical-layer identifiers/flags this contract must never carry
  'canonicalVertexId',
  'canonicalEdgeId',
  'candidateId',
  'isFullyClosed',
  'executionAllowed',
  'executionDeterministic',
  'planningDecisionDeterministic',
  'candidateState',
  'stateFlags',
] as const;

export class SemanticPlanProposalForbiddenFieldError extends Error {
  constructor(
    public path: string,
    public field: string,
  ) {
    super(
      `SemanticPlanProposal payload contains forbidden field "${field}" at ${path}. ` +
        'The semantic-planning AI call must never emit metric/coordinate/scale data or ' +
        'canonical-layer identifiers/execution flags -- those belong exclusively to ' +
        'PageDimensions/measurements (Phase 2/3) or to the deterministic ApprovedPlan ' +
        'builder (Part D), never to this proposal.',
    );
    this.name = 'SemanticPlanProposalForbiddenFieldError';
  }
}

export function assertNoForbiddenSemanticPlanFields(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenSemanticPlanFields(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if ((SEMANTIC_PLAN_PROPOSAL_FORBIDDEN_FIELD_NAMES as readonly string[]).includes(key)) {
        throw new SemanticPlanProposalForbiddenFieldError(path, key);
      }
      assertNoForbiddenSemanticPlanFields((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

/**
 * Also verifies no forbidden ENUM VALUE (as opposed to field name) appears
 * anywhere in the payload -- specifically 'CONSTRAINT_SOLVED', which is not
 * a valid literal on any enum in this contract but could still appear if a
 * provider ignores the schema's enum constraint. This is a values-based
 * defense-in-depth check, distinct from (and in addition to) the key-name
 * firewall above.
 */
const FORBIDDEN_ENUM_VALUES = ['CONSTRAINT_SOLVED'] as const;

export function assertNoForbiddenSemanticPlanEnumValues(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenSemanticPlanEnumValues(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      assertNoForbiddenSemanticPlanEnumValues((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && (FORBIDDEN_ENUM_VALUES as readonly string[]).includes(value)) {
    throw new SemanticPlanProposalForbiddenFieldError(path, value);
  }
}

// claude/phase1c-a/src/request/semantic_plan_request_types.ts
//
// Plain, serializable request shape for the future semantic-planning AI
// call. This is infrastructure only -- no HTTP client, no OpenAI SDK type,
// no network execution. Wiring this to a real call is Part F, not this
// package. Shapes are deliberately generic (role/content/text/image_url)
// rather than tied to one provider's SDK types, since no provider call is
// made here.

import type { SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA } from '../schema/semantic_plan_proposal_schema_v1.js';

export interface SemanticPlanProposalTextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface SemanticPlanProposalImagePart {
  readonly type: 'image_url';
  // detail:"high" matches the existing production convention for
  // architectural-perception image calls (see
  // supabase/functions/analyze-sketch-v2-envelope-topology/index.ts's own
  // image_url content part) -- semantic planning is the same kind of
  // fine-detail visual read (wall lines, openings, corners) and must not
  // silently default to a lower-detail image.
  readonly image_url: { readonly url: string; readonly detail: 'high' };
}

export type SemanticPlanProposalUserContentPart = SemanticPlanProposalTextPart | SemanticPlanProposalImagePart;

export interface SemanticPlanProposalSystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface SemanticPlanProposalUserMessage {
  readonly role: 'user';
  readonly content: readonly SemanticPlanProposalUserContentPart[];
}

export type SemanticPlanProposalMessage = SemanticPlanProposalSystemMessage | SemanticPlanProposalUserMessage;

/**
 * The complete, serializable request this package builds. `responseFormat`
 * carries the EXACT SAME schema object exported by Part A
 * (SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA) -- by reference, never copied or
 * redeclared -- so there is exactly one place that schema is defined.
 */
export interface SemanticPlanProposalRequest {
  readonly messages: readonly SemanticPlanProposalMessage[];
  readonly responseFormat: {
    readonly type: 'json_schema';
    readonly json_schema: typeof SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA;
  };
}

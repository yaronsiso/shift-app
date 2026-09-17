// claude/phase1c-a/src/request/build_semantic_plan_request.ts
//
// Pure, deterministic request builder for the future semantic-planning AI
// call. No network execution happens here -- this only assembles the
// serializable request object. Wiring it to a real provider call is Part F.
//
// CRITICAL (per the approved Phase 1C-A Part B design): the AI input is the
// FULL EnvelopeTopologyV1 -- including roleHint, cornerAngleHint,
// polygonOrder, and perceptionNotes -- never the reduced RawTopology that
// the adapter (../adapter.js) produces for constructCanonicalTopology.
// RawTopology stays exclusively on the deterministic path
// (EnvelopeTopologyV1 -> adapter -> RawTopology -> constructCanonicalTopology,
// still not implemented past Part A/adapter). This builder never imports or
// references RawTopology at all -- see the adapter tests for the proof that
// its output drops roleHint/cornerAngleHint/polygonOrder/perceptionNotes;
// this file's own tests prove the opposite direction: that these fields DO
// reach the model's input.
//
// No jobId, no PageDimensions, no measurements are added anywhere in this
// payload -- this function only ever receives an EnvelopeTopologyV1 and an
// image URL string, and has no parameter through which such data could
// enter even by mistake.
//
// Image coordinate semantics: the croppedImageUrl is passed through
// verbatim. No resize/crop/coordinate transform is performed here -- the
// EnvelopeTopologyV1.imagePct values and the cropped image are already in
// the same coordinate frame (verified upstream, in the RAW perception
// stage), and this builder does not touch that relationship.

import type { EnvelopeTopologyV1 } from '../envelope_topology_schema_v1.ts';
import { SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA } from './semantic_plan_proposal_schema_v1.ts';
import { SEMANTIC_PLAN_SYSTEM_PROMPT_V1 } from './semantic_plan_system_prompt_v1.ts';
import type { SemanticPlanProposalRequest } from './semantic_plan_request_types.ts';

const USER_INSTRUCTION_PREFIX =
  'להלן תוצאת שלב התפיסה (EnvelopeTopologyV1) של אותו שרטוט, בפורמט JSON. ' +
  'בדוק כל edge וכל vertex מול התמונה המצורפת בפועל — אל תסתמך רק על הטקסט.\n\n';

export function buildSemanticPlanProposalRequest(
  envelope: EnvelopeTopologyV1,
  croppedImageUrl: string,
): SemanticPlanProposalRequest {
  return {
    messages: [
      { role: 'system', content: SEMANTIC_PLAN_SYSTEM_PROMPT_V1 },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_INSTRUCTION_PREFIX + JSON.stringify(envelope) },
          { type: 'image_url', image_url: { url: croppedImageUrl, detail: 'high' } },
        ],
      },
    ],
    responseFormat: {
      type: 'json_schema',
      json_schema: SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA,
    },
  };
}

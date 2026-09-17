// claude/phase1c-a/src/request/build_semantic_plan_request.ts
//
// Pure, deterministic request builder for the future semantic-planning AI
// call. No network execution happens here -- this only assembles the
// serializable request object. Wiring it to a real provider call is Part F.
//
// CRITICAL (per the approved Phase 1C-A Part B design): the AI input is the
// FULL envelope object -- including roleHint, cornerAngleHint, and
// perceptionNotes -- never the reduced RawTopology that the adapter
// (../adapter.js) produces for constructCanonicalTopology. RawTopology
// stays exclusively on the deterministic path (envelope -> adapter ->
// RawTopology -> constructCanonicalTopology). This builder never imports or
// references RawTopology at all -- see the adapter tests for the proof that
// its output drops roleHint/cornerAngleHint/(polygonOrder, V1 only)/
// perceptionNotes; this file's own tests prove the opposite direction: that
// these fields DO reach the model's input.
//
// V1/V2 NOTE (added when EnvelopeTopologyV2 was introduced -- see
// SHIFT_AGENT_HANDOFF_CURRENT.md §15/§19): this function's body has never
// read any individual field off `envelope` -- it only ever
// `JSON.stringify`s the whole object into the user message text. There is
// therefore no structural dependency on `polygonOrder` (V1-only, absent
// from V2) anywhere in this file. The parameter type below was widened from
// `EnvelopeTopologyV1` to `EnvelopeTopologyV1 | EnvelopeTopologyV2` for
// exactly this reason and for no other -- this is a type-signature widening
// only, not a behavior change, not a Phase1C redesign, and not a relaxation
// of any V1 or V2 contract. The system prompt (SEMANTIC_PLAN_SYSTEM_PROMPT_V1,
// untouched) is written generically enough to describe perception evidence
// without assuming a closed-polygon traversal exists; if that ever proves
// not to hold in practice, that is a prompt-content question to revisit
// separately, not a reason to touch this file again.
//
// No jobId, no PageDimensions, no measurements are added anywhere in this
// payload -- this function only ever receives an envelope object and an
// image URL string, and has no parameter through which such data could
// enter even by mistake.
//
// Image coordinate semantics: the croppedImageUrl is passed through
// verbatim. No resize/crop/coordinate transform is performed here -- the
// envelope's imagePct values and the cropped image are already in the same
// coordinate frame (verified upstream, in the RAW perception stage), and
// this builder does not touch that relationship. True for both V1 and V2,
// since both are produced from the same cropped image path.

import type { EnvelopeTopologyV1 } from '../envelope_topology_schema_v1.ts';
import type { EnvelopeTopologyV2 } from '../envelope_topology_schema_v2.ts';
import { SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA } from './semantic_plan_proposal_schema_v1.ts';
import { SEMANTIC_PLAN_SYSTEM_PROMPT_V1 } from './semantic_plan_system_prompt_v1.ts';
import type { SemanticPlanProposalRequest } from './semantic_plan_request_types.ts';

const USER_INSTRUCTION_PREFIX =
  'להלן תוצאת שלב התפיסה (Envelope Topology) של אותו שרטוט, בפורמט JSON. ' +
  'בדוק כל edge וכל vertex מול התמונה המצורפת בפועל — אל תסתמך רק על הטקסט.\n\n';

export function buildSemanticPlanProposalRequest(
  envelope: EnvelopeTopologyV1 | EnvelopeTopologyV2,
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

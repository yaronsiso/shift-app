// claude/phase1c-a/src/fixtures/sample_semantic_plan_response.ts
//
// A synthetic, hand-written "model response" fixture matching
// ../fixtures/sample_envelope.ts (v1-v4 / e1-e4), used only to test the
// Part B response-parsing pipeline. This is NOT a real model output and NOT
// Attempt3 -- it exists purely so parse_semantic_plan_proposal_response.ts
// has something realistic to run against in tests.
//
// Demonstrates COMPLETE edge coverage (one proposal per e1..e4, per the
// approved Part B correction) and sparse vertex coverage (only v3 has a
// finding; v1/v2/v4 are absent = NOT_AUDITED).

import type { SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';

export const sampleSemanticPlanResponse: SemanticPlanProposal = {
  schemaVersion: 'semantic_plan_proposal_v1',
  edgeProposals: [
    {
      rawEdgeId: 'e1',
      disposition: 'KEEP_ENVELOPE',
      confidence: 'HIGH',
      geometryAlignment: 'ALIGNED',
      verificationScope: 'FULL_SPAN',
      dualFaceOf: null,
      reason: 'Clear, continuous exterior wall line at the top of the drawing.',
    },
    {
      rawEdgeId: 'e2',
      disposition: 'KEEP_ENVELOPE',
      confidence: 'HIGH',
      geometryAlignment: 'ALIGNED',
      verificationScope: 'FULL_SPAN',
      dualFaceOf: null,
      reason: 'Right-side exterior wall, no interruptions visible.',
    },
    {
      rawEdgeId: 'e3',
      disposition: 'UNRESOLVED',
      confidence: 'LOW',
      geometryAlignment: 'UNRESOLVED',
      verificationScope: null,
      dualFaceOf: null,
      reason: 'Marked as an opening (roleHint) but the image is unclear on whether this edge is the wall boundary or door-leaf graphics.',
    },
    {
      rawEdgeId: 'e4',
      disposition: 'KEEP_ENVELOPE',
      confidence: 'MEDIUM_HIGH',
      geometryAlignment: 'NEAR',
      verificationScope: 'VISIBLE_SPAN',
      dualFaceOf: null,
      reason: 'Left-side exterior wall, mostly visible.',
    },
  ],
  vertexProposals: [
    { rawVertexId: 'v3', finding: 'UNRESOLVED', confidence: 'LOW', reason: 'Corner marked uncertain in the perception stage; image is ambiguous here too.' },
  ],
  gapProposals: [],
  notes: null,
};

// claude/phase1c-a/src/types/__typetests__/forbidden-shapes.ts
//
// Compile-time-only proof (no runtime assertions -- this file is checked by
// `tsc`/`npm run typecheck`, not by node --test) that the SemanticPlanProposal
// contract structurally rejects every item on the 9-item checklist in
// ../semantic_plan_proposal_v1.ts. Each block below MUST fail to compile;
// `@ts-expect-error` on the line above each object literal means: if the
// shape below it ever became valid (e.g. because a forbidden field was
// accidentally added to a type), tsc fails on an "Unused '@ts-expect-error'
// directive" error, which functions as an automatic regression guard for
// this whole checklist. Nothing here is ever imported or executed.

import type {
  EdgeSemanticProposal,
  VertexSemanticProposal,
  GapSemanticProposal,
  SemanticPlanProposal,
} from '../semantic_plan_proposal_v1.js';

// 1 & 2. no canonical id, no new-vertex/new-edge id field.
// @ts-expect-error -- EdgeSemanticProposal has no canonicalEdgeId field
const edgeWithCanonicalId: EdgeSemanticProposal = { rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE', confidence: 'HIGH', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN', dualFaceOf: null, reason: 'x', canonicalEdgeId: 'canon-e1' };

// 3. no metric coordinates.
// @ts-expect-error -- EdgeSemanticProposal has no coordinate/xPct field
const edgeWithCoordinate: EdgeSemanticProposal = { rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE', confidence: 'HIGH', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN', dualFaceOf: null, reason: 'x', xPct: 10 };

// 4. no scale.
// @ts-expect-error -- EdgeSemanticProposal has no scale/metersPerPct field
const edgeWithScale: EdgeSemanticProposal = { rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE', confidence: 'HIGH', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN', dualFaceOf: null, reason: 'x', scale: 1 };

// 5. no dimensions/areas.
// @ts-expect-error -- GapSemanticProposal has no areaMeters/lengthMeters field
const gapWithArea: GapSemanticProposal = { gapId: 'g1', gapType: 'SOURCE_OCCLUDED', relatedRawEdgeIds: [], knownEndpointRawVertexIds: ['v1'], confidence: 'LOW', reason: 'x', areaMeters: 4 };

// 6. no isFullyClosed.
// @ts-expect-error -- SemanticPlanProposal has no isFullyClosed field (CANDIDATE-layer only)
const proposalWithIsFullyClosed: SemanticPlanProposal = { schemaVersion: 'semantic_plan_proposal_v1', edgeProposals: [], vertexProposals: [], gapProposals: [], notes: null, isFullyClosed: true };

// 7. no executionAllowed / executionDeterministic.
// @ts-expect-error -- EdgeSemanticProposal has no executionAllowed field (PLAN-layer only, set by Part D)
const edgeWithExecutionAllowed: EdgeSemanticProposal = { rawEdgeId: 'e1', disposition: 'KEEP_ENVELOPE', confidence: 'HIGH', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN', dualFaceOf: null, reason: 'x', executionAllowed: true };

// 8. no CONSTRAINT_SOLVED anywhere.
// @ts-expect-error -- ProposedEdgeDisposition does not include CONSTRAINT_SOLVED
const edgeWithConstraintSolvedDisposition: EdgeSemanticProposal = { rawEdgeId: 'e1', disposition: 'CONSTRAINT_SOLVED', confidence: 'HIGH', geometryAlignment: 'ALIGNED', verificationScope: 'FULL_SPAN', dualFaceOf: null, reason: 'x' };

// 8b. VERTEX_ABSENCE_MEANS_NOT_AUDITED: NOT_AUDITED must never be an explicit
// AI-emitted value -- it is the documented meaning of absence, not a member
// of ProposedVertexCoordinateFinding.
// @ts-expect-error -- ProposedVertexCoordinateFinding does not include NOT_AUDITED (absence encodes it instead)
const vertexWithNotAudited: VertexSemanticProposal = { rawVertexId: 'v1', finding: 'NOT_AUDITED', confidence: 'HIGH', reason: 'x' };

// 9. no topology-mutation instruction field of any kind.
// @ts-expect-error -- SemanticPlanProposal has no operationType/topologyMutation field
const proposalWithMutationInstruction: SemanticPlanProposal = { schemaVersion: 'semantic_plan_proposal_v1', edgeProposals: [], vertexProposals: [], gapProposals: [], notes: null, topologyMutationRequired: 'TRUE' };

// Explicit reference so the "unused variable" situation is visually obvious
// to a reader without relying on noUnusedLocals (which this package does not
// enable) -- these bindings exist purely so the object literals above are
// type-checked as assignments, never for their runtime value.
void edgeWithCanonicalId;
void edgeWithCoordinate;
void edgeWithScale;
void gapWithArea;
void proposalWithIsFullyClosed;
void edgeWithExecutionAllowed;
void edgeWithConstraintSolvedDisposition;
void vertexWithNotAudited;
void proposalWithMutationInstruction;

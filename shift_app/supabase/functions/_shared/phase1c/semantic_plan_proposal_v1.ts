// =====================================================================
// Phase 1C-A — Production-Generalized Semantic Planning
// SemanticPlanProposal contract (Part A: CONTRACTS ONLY)
//
// This is the AI-FACING output contract for the semantic-planning step:
//
//   EnvelopeTopologyV1 + croppedImage  --[future Part B AI call]-->  SemanticPlanProposal
//
// It is deliberately NOT the same type as ApprovedPlan (phase1c-b's
// PlanOperation[] contract). SemanticPlanProposal is a raw, unvetted AI
// proposal. It becomes an ApprovedPlan only after passing through a
// deterministic semantic validator (Part C, not yet implemented) that
// enforces every invariant documented below. No code in this package (or
// anywhere else) may skip that step and treat a SemanticPlanProposal as
// though it were already an ApprovedPlan.
//
// Every enum in this file is intentionally declared as its OWN type,
// distinct from the equivalent-looking enums in
// ../../../../supabase/functions/_shared/canonical_topology_v1.ts and in
// raw_audited_plan_model.ts (the symlinked phase1c-b model). This is not
// duplication for its own sake: it keeps the AI-facing proposal boundary
// decoupled from the CANDIDATE/PLAN layers, so a future change to either
// side does not silently ripple into the other without an explicit mapping
// step (which Part C/D own).
//
// STRUCTURAL IMPOSSIBILITY CHECKLIST (verified by tests in
// ../__tests__/schema-and-forbidden-fields.test.ts and by the TypeScript
// type-level checks in ./__typetests__/forbidden-shapes.ts):
// this contract has NO way for the AI to:
//   1. create/return a canonical id (no field named canonicalVertexId /
//      canonicalEdgeId / candidateId anywhere in this file).
//   2. create a new vertex or edge (every id field below is a REFERENCE --
//      rawEdgeId / rawVertexId / dualFaceOf / relatedRawEdgeIds /
//      knownEndpointRawVertexIds -- to be checked for existence against
//      EnvelopeTopologyV1/RawTopology by Part A's referential-integrity
//      checks; there is no field through which a brand-new id becomes part
//      of the topology).
//   3. return metric coordinates (no x/y/xPct/yPct/coordinate field of any
//      kind on any type in this file).
//   4. return scale (no scale/metersPerPct field).
//   5. return dimensions/areas (no meters/lengthMeters/area/areaMeters/
//      dimensionRefs field).
//   6. set isFullyClosed (not a field anywhere in this contract -- that is
//      a CANDIDATE-layer, constructor-derived flag).
//   7. set executionAllowed / executionDeterministic (PLAN-layer fields,
//      set only by the future ApprovedPlan builder in Part D, never by the
//      AI proposal).
//   8. return CONSTRAINT_SOLVED (not a member of any enum in this file --
//      it belongs only to CoordinateStatus, a CANDIDATE-layer type this
//      contract never touches).
//   9. instruct a topology mutation (disposition/finding/gapType are
//      semantic FINDINGS about existing RAW entities, not execution
//      instructions -- mapping a finding to a PlanOperation is Part D's
//      job, done deterministically, never emitted directly by the AI).
// =====================================================================

/**
 * Confidence the AI attaches to a single proposal. Intentionally its own
 * type (not a re-export of canonical_topology_v1's SemanticConfidence),
 * even though the literal values currently match -- see file header.
 */
export type ProposedConfidence = 'HIGH' | 'MEDIUM_HIGH' | 'MEDIUM' | 'LOW';

/**
 * The AI's semantic disposition for one RAW edge. This is a FINDING, not an
 * execution instruction -- see checklist item 9 above. In particular:
 *   - SPLIT_REQUIRED is a valid, legitimate output. It must NEVER be
 *     silently upgraded to an actual topology split: constructCanonicalTopology
 *     (phase1c-b) has no mechanism to create a canonical vertex/edge that
 *     is not a 1:1 mapping from an existing RAW entity, so any future
 *     ApprovedPlan builder (Part D) must route SPLIT_REQUIRED to a deferred
 *     TOPOLOGY_REPAIR_REQUIRED operation, never to a real split.
 *   - UNRESOLVED is a valid, legitimate output. It must never be forced
 *     into KEEP_ENVELOPE or REJECT_NOT_ENVELOPE merely because a decision
 *     is "due" -- see ../__tests__/split-and-unresolved.test.ts.
 */
export type ProposedEdgeDisposition =
  | 'KEEP_ENVELOPE'
  | 'REJECT_NOT_ENVELOPE'
  | 'REJECT_DUAL_FACE'
  | 'SPLIT_REQUIRED'
  | 'UNRESOLVED';

/**
 * The AI's semantic finding about how well a RAW edge's drawn geometry
 * matches its own perception of the physical wall. Deliberately mirrors
 * GeometryAlignmentStatus's literal values (including NOT_AUDITED) for
 * future mapping convenience in Part C -- but is its own declared type here,
 * per the same decoupling rationale as ProposedConfidence.
 */
export type ProposedGeometryAlignment = 'NOT_AUDITED' | 'ALIGNED' | 'NEAR' | 'MISALIGNED' | 'UNRESOLVED';

/**
 * How much of the edge's span the AI is actually claiming to have verified.
 * Field type on EdgeSemanticProposal is `ProposedVerificationScope | null`
 * -- null is expected and normal whenever disposition is not KEEP_ENVELOPE
 * (a rejected/split/unresolved edge has no "verified span" to state).
 */
export type ProposedVerificationScope = 'FULL_SPAN' | 'VISIBLE_SPAN' | 'LOCAL_ADJACENCY_CONFIRMED';

/**
 * EdgeSemanticProposal -- one RAW edge's semantic finding.
 *
 * dualFaceOf: see the file-level note on DUAL_FACE_EXISTENCE_NOT_PROOF.
 * Part A only checks (a) if disposition === 'REJECT_DUAL_FACE' then
 * dualFaceOf must not be null, (b) dualFaceOf, when non-null, must
 * reference an existing rawEdgeId, and (c) dualFaceOf must not equal this
 * proposal's own rawEdgeId. None of those checks prove the two edges are
 * truly the same physical wall's two faces -- that remains an open Part C
 * design question (see ../__tests__/referential-integrity.test.ts doc
 * comments and the Part C invariants catalog referenced from there).
 *
 * reason: see REASON_IS_NOT_PROOF below (repeated per-field, not just
 * once, so it cannot be missed by anyone reading only this interface).
 */
export interface EdgeSemanticProposal {
  readonly rawEdgeId: string;
  readonly disposition: ProposedEdgeDisposition;
  readonly confidence: ProposedConfidence;
  readonly geometryAlignment: ProposedGeometryAlignment;
  readonly verificationScope: ProposedVerificationScope | null;
  readonly dualFaceOf: string | null;
  /**
   * REASON_IS_NOT_PROOF: free-text explanatory note, non-authoritative.
   * A non-empty (even detailed/persuasive) reason string does NOT
   * constitute semantic proof, provenance, adjacency verification,
   * dual-face verification, or geometry verification. No deterministic
   * validator -- in Part C or any future revision -- may promote, upgrade,
   * or accept a proposal merely because reason is present, long, or
   * well-argued. A future need for actual evidence/proof representation
   * requires its own separate, explicit, structured contract field --
   * never inferred, parsed, or scored from this free-text field.
   */
  readonly reason: string;
}

/**
 * The AI's semantic finding about one RAW vertex's coordinate, when the AI
 * has an affirmative finding to make. See VERTEX_ABSENCE_MEANS_NOT_AUDITED
 * on VertexSemanticProposal / SemanticPlanProposal.vertexProposals below --
 * this enum deliberately does NOT include NOT_AUDITED or CONSTRAINT_SOLVED
 * as values: NOT_AUDITED is never something the AI affirmatively states
 * (it is the documented meaning of ABSENCE from vertexProposals), and
 * CONSTRAINT_SOLVED belongs only to the CANDIDATE-layer CoordinateStatus,
 * never to this AI-facing contract.
 */
export type ProposedVertexCoordinateFinding = 'MISALIGNED' | 'UNRESOLVED';

/**
 * VertexSemanticProposal -- sparse by design. A raw vertex appears here
 * ONLY if the AI has an affirmative finding about its coordinate.
 *
 * CONTRACT RULE -- VERTEX_ABSENCE_MEANS_NOT_AUDITED (binding on every
 * consumer of this type, current and future):
 *   A raw vertex id that does NOT appear in
 *   SemanticPlanProposal.vertexProposals[] carries the semantic status
 *   NOT_AUDITED. This is NOT an approval, NOT a verification, and NOT
 *   equivalent to "raw observation confirmed correct" -- it means only
 *   that the AI produced no finding about this vertex in this pass.
 *
 *   This is strictly independent from CoordinateStatus (the CANDIDATE-layer
 *   field constructCanonicalTopology/ApprovedPlan use, defaulting to
 *   RAW_OBSERVATION -- see raw_audited_plan_model.ts's ensureCanonicalVertex).
 *   That field describes what the constructor does with a coordinate value
 *   downstream (copies it verbatim from RAW); it is not, and must never be
 *   read as, evidence that semantic audit occurred. A vertex can
 *   simultaneously be CoordinateStatus=RAW_OBSERVATION at the candidate
 *   layer AND NOT_AUDITED at the semantic-proposal layer -- that is the
 *   expected, correct state for any vertex the AI didn't examine.
 */
export interface VertexSemanticProposal {
  readonly rawVertexId: string;
  readonly finding: ProposedVertexCoordinateFinding;
  readonly confidence: ProposedConfidence;
  /** REASON_IS_NOT_PROOF -- see EdgeSemanticProposal.reason. */
  readonly reason: string;
}

/**
 * The kind of gap the AI believes exists in the boundary. Deliberately
 * mirrors CanonicalGapType's literal values for future mapping convenience
 * in Part D -- but is its own declared type here (same decoupling
 * rationale as the other Proposed* types).
 */
export type ProposedGapType = 'OPENING_CONTINUATION_UNKNOWN' | 'SOURCE_OCCLUDED' | 'UNSUPPORTED_BOUNDARY_RELATION';

/**
 * GapSemanticProposal -- the AI's proposal that a gap exists in the
 * boundary at/around some existing RAW entities.
 *
 * CONTRACT RULE -- GAP_REQUIRES_TOPOLOGY_CONTEXT (enforced in Part C, NOT
 * at schema level -- see file header and
 * ../__tests__/referential-integrity.test.ts):
 *   relatedRawEdgeIds and knownEndpointRawVertexIds are independent,
 *   individually-optional arrays (either may legitimately be empty on its
 *   own -- e.g. a SOURCE_OCCLUDED gap may have one known endpoint and no
 *   related edge). Both being simultaneously empty is rejected by Part C
 *   as an ungrounded/"floating" gap: the AI must never be allowed to
 *   assert a gap unrelated to any existing raw entity, and no geometry is
 *   invented to satisfy this rule -- a gap that truly cannot be grounded is
 *   not a valid proposal at all.
 */
export interface GapSemanticProposal {
  readonly gapId: string;
  readonly gapType: ProposedGapType;
  readonly relatedRawEdgeIds: readonly string[];
  readonly knownEndpointRawVertexIds: readonly string[];
  readonly confidence: ProposedConfidence;
  /** REASON_IS_NOT_PROOF -- see EdgeSemanticProposal.reason. */
  readonly reason: string;
}

/**
 * Free-text perception note, mirroring EnvelopeTopologyPerceptionNoteV1's
 * shape (vertexId/edgeId/note) for consistency with the RAW perception
 * contract. Non-authoritative, same as `reason` everywhere else in this
 * file: notes are for human/debugging context, never parsed for meaning by
 * any validator.
 */
export interface SemanticPlanNoteV1 {
  readonly rawVertexId: string | null;
  readonly rawEdgeId: string | null;
  readonly note: string;
}

/**
 * SemanticPlanProposal -- the complete AI-facing output of the future
 * semantic-planning call. Top-level arrays are all sparse: an edge/vertex
 * not mentioned is NOT_AUDITED (vertices) or simply has no finding (edges),
 * never an implicit approval.
 */
export interface SemanticPlanProposal {
  readonly schemaVersion: 'semantic_plan_proposal_v1';
  readonly edgeProposals: readonly EdgeSemanticProposal[];
  readonly vertexProposals: readonly VertexSemanticProposal[];
  readonly gapProposals: readonly GapSemanticProposal[];
  readonly notes: readonly SemanticPlanNoteV1[] | null;
}

// claude/phase1c-a/src/validator/semantic_plan_validation_result_v1.ts
//
// Phase 1C-A — Part C: Deterministic Semantic Validator — RESULT CONTRACT.
//
// This file defines ONLY the output shape of Part C (SemanticPlanValidationResultV1)
// and its constituent types. The validator implementation itself lives in
// ./semantic_plan_validator_v1.ts. Splitting these mirrors the existing
// referential_integrity.ts convention (types alongside the function, but a
// dedicated result-shape file here because this result is materially richer
// than ReferentialIntegrityResult[] -- it carries readiness/perEdgeReadiness
// on top of flat rule results).
//
// DESIGN SOURCE: approved PHASE1C-A_PART_C_DESIGN = APPROVED / CLOSED (per
// 00_HANDOFF and the explicit approval message that authorized this
// implementation). Every shape below is a direct, literal transcription of
// that approved design -- nothing here is invented or extrapolated.
//
// SCOPE DISCIPLINE (binding, same spirit as Part A's file-header scope
// notes): this file defines types ONLY. No rule logic, no mutation, no
// mapping to PlanOperation/ApprovedPlan (that is Part D, out of scope here).

/**
 * Part C rule categories. `CONTRACT` reuses Part A's referential-integrity
 * rules (imported, not duplicated) plus ENVELOPE_RAW_CONSISTENCY and
 * NO_DUPLICATE_GAP_PROPOSAL (both new to Part C). `COVERAGE` and
 * `SEMANTIC_POLICY` are entirely new to Part C.
 */
export type SemanticValidationRuleCategory = 'CONTRACT' | 'COVERAGE' | 'SEMANTIC_POLICY';

/**
 * Every rule name Part C reports on, across all three categories. The
 * seven Part A referential-integrity rule names are re-exported verbatim
 * (see semantic_plan_validator_v1.ts -- they are imported and their results
 * are copied into this union's shape, never recomputed or reimplemented)
 * plus the two new CONTRACT rules, the two COVERAGE rules, and the two
 * SEMANTIC_POLICY rules approved for Part C.
 */
export type SemanticValidationRuleName =
  // --- CONTRACT: reused verbatim from Part A (referential_integrity.ts) ---
  | 'EDGE_REF_MUST_EXIST'
  | 'VERTEX_REF_MUST_EXIST'
  | 'GAP_REF_MUST_EXIST'
  | 'NO_DUPLICATE_EDGE_PROPOSAL'
  | 'NO_DUPLICATE_VERTEX_PROPOSAL'
  | 'DUAL_FACE_TARGET_MUST_EXIST'
  | 'DUAL_FACE_NO_SELF_REFERENCE'
  // --- CONTRACT: new to Part C ---
  | 'ENVELOPE_RAW_CONSISTENCY'
  | 'NO_DUPLICATE_GAP_PROPOSAL'
  // --- COVERAGE: new to Part C ---
  | 'EVERY_RAW_EDGE_HAS_PROPOSAL'
  | 'GAP_REQUIRES_TOPOLOGY_CONTEXT'
  // --- SEMANTIC_POLICY: new to Part C ---
  | 'DUAL_FACE_FIELD_MATCHES_DISPOSITION'
  | 'KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE';

/**
 * One rule's outcome, uniform across all three categories -- this is the
 * common shape both the imported Part A results and Part C's own new rules
 * are normalized into.
 */
export interface SemanticValidationRuleResult {
  readonly rule: SemanticValidationRuleName;
  readonly category: SemanticValidationRuleCategory;
  readonly passed: boolean;
  readonly details: string;
}

/**
 * Informational findings are DELIBERATELY separate from ruleResults and
 * DELIBERATELY have no `passed: boolean` field at all -- per design, so
 * that neither this validator nor any future consumer can misread a
 * finding as a pass/fail proof. Both approved findings live here:
 *   - SPLIT_REQUIRED_PRESENT: informational note that >=1 edgeProposal
 *     carries disposition SPLIT_REQUIRED. Not a failure -- SPLIT_REQUIRED
 *     is a first-class legal output (see Part A's split-and-unresolved
 *     test file). Surfaced here purely so a human/Part D consumer notices
 *     it without having to scan edgeProposals directly.
 *   - DUAL_FACE_PROOF_NOT_AVAILABLE: informational note that >=1
 *     edgeProposal has disposition REJECT_DUAL_FACE (and therefore, by
 *     DUAL_FACE_FIELD_MATCHES_DISPOSITION, a non-null dualFaceOf that
 *     passed existence/self-reference checks) -- but Part C has no
 *     deterministic geometric proof source for the dual-face claim, so the
 *     edge remains UNVERIFIED_NOT_EXECUTABLE regardless. This finding
 *     exists to make that gap visible, never to imply the claim was
 *     verified.
 */
export type SemanticValidationFindingKey = 'SPLIT_REQUIRED_PRESENT' | 'DUAL_FACE_PROOF_NOT_AVAILABLE';

/**
 * Field names (key/affectedRawEdgeIds/details) are the approved
 * InformationalFinding contract verbatim -- do not rename.
 */
export interface SemanticValidationFinding {
  readonly key: SemanticValidationFindingKey;
  readonly affectedRawEdgeIds: readonly string[];
  readonly details: string;
}

/**
 * Per-edge readiness status. Every rawEdgeId present in RawTopology.edges
 * gets exactly one entry (see semantic_plan_validator_v1.ts) -- including
 * edges with NO edgeProposal at all (UNRESOLVED-equivalent by absence is
 * NOT a concept in this contract; EVERY_RAW_EDGE_HAS_PROPOSAL is a COVERAGE
 * rule specifically because a missing proposal is a coverage gap, not an
 * implicit UNRESOLVED finding -- see that rule's doc comment in the
 * validator).
 *
 *   - EXECUTION_READY: disposition is KEEP_ENVELOPE or REJECT_NOT_ENVELOPE
 *     (the only two dispositions with no outstanding deterministic
 *     blocker), AND every CONTRACT/COVERAGE/SEMANTIC_POLICY rule touching
 *     this edge passed.
 *   - NOT_EXECUTION_READY_UNRESOLVED: disposition is UNRESOLVED (a
 *     legitimate, non-forced "no decision yet" state -- never upgraded).
 *   - NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR: disposition is
 *     SPLIT_REQUIRED. constructCanonicalTopology (phase1c-b) has no
 *     mechanism to perform a real topology split, so this can never be
 *     EXECUTION_READY regardless of how well-formed the proposal is.
 *   - UNVERIFIED_NOT_EXECUTABLE: disposition is REJECT_DUAL_FACE that
 *     passed every field/reference check available to Part C. Passing
 *     those checks is coherence, not proof (DUAL_FACE_EXISTENCE_NOT_PROOF)
 *     -- there is no deterministic geometric dual-face proof source yet,
 *     so this can never be EXECUTION_READY either.
 */
export type PerEdgeReadinessStatus =
  | 'EXECUTION_READY'
  | 'NOT_EXECUTION_READY_UNRESOLVED'
  | 'NOT_EXECUTABLE_WITH_CURRENT_CONSTRUCTOR'
  | 'UNVERIFIED_NOT_EXECUTABLE';

export interface PerEdgeReadiness {
  readonly rawEdgeId: string;
  readonly status: PerEdgeReadinessStatus;
  readonly details: string;
}

/**
 * Top-level readiness booleans.
 *
 *   - contractValid: AND of every CONTRACT-category rule result.
 *   - coverageValid: AND of every COVERAGE-category rule result.
 *   - semanticPolicyValid: AND of every SEMANTIC_POLICY-category rule result.
 *   - executionReadyForPartD: contractValid && coverageValid &&
 *     semanticPolicyValid && every perEdgeReadiness[i].status ===
 *     'EXECUTION_READY'. Per design: "failure of contract/coverage fails
 *     the WHOLE proposal" -- if either is false, perEdgeReadiness is still
 *     computed (for diagnostic completeness) but executionReadyForPartD is
 *     unconditionally false without even needing to inspect
 *     perEdgeReadiness.
 */
export interface SemanticValidationReadiness {
  readonly contractValid: boolean;
  readonly coverageValid: boolean;
  readonly semanticPolicyValid: boolean;
  readonly executionReadyForPartD: boolean;
}

export interface SemanticPlanValidationResultV1 {
  readonly schemaVersion: 'semantic_plan_validation_result_v1';
  readonly ruleResults: readonly SemanticValidationRuleResult[];
  readonly informationalFindings: readonly SemanticValidationFinding[];
  readonly readiness: SemanticValidationReadiness;
  readonly perEdgeReadiness: readonly PerEdgeReadiness[];
}

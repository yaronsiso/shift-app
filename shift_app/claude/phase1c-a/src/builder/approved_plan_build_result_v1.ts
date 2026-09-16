// claude/phase1c-a/src/builder/approved_plan_build_result_v1.ts
//
// Phase 1C-A — Part D: ApprovedPlan Builder — RESULT CONTRACT.
//
// This file defines ONLY the output shape of Part D
// (ApprovedPlanBuildResultV1) and its constituent types. The builder
// implementation itself lives in ./approved_plan_builder_v1.ts. Mirrors the
// existing Part C convention (semantic_plan_validation_result_v1.ts): types
// alongside the function, split into their own file because the result is a
// discriminated union richer than a flat array.
//
// DESIGN SOURCE: PHASE1C-A_PART_D_DESIGN_V2 = APPROVED / CLOSED (per
// 00_HANDOFF section 17-24). Every shape below is a direct, literal
// transcription of that approved design -- nothing here is invented or
// extrapolated.
//
// SCOPE DISCIPLINE: this file defines types ONLY. No translation logic, no
// mutation, no construction of PlanOperation/ApprovedPlan (that belongs to
// approved_plan_builder_v1.ts).

import type { ApprovedPlan } from '../types/raw_audited_plan_model.js';

/**
 * Blocking reason keys Part D can report. Exactly the three approved for
 * Part D v1 -- no others exist yet:
 *   - VALIDATION_NOT_EXECUTION_READY: validation.readiness.executionReadyForPartD
 *     was not true. Part D never re-runs Part C -- this is Part C's
 *     readiness verdict, taken as authoritative.
 *   - KEEP_EDGE_MISSING_VERIFICATION_SCOPE: defense-in-depth. Part C's
 *     KEEP_ENVELOPE_REQUIRES_VERIFICATION_SCOPE rule should already prevent
 *     this from ever reaching Part D with executionReadyForPartD=true, but
 *     Part D independently re-checks it rather than trusting that alone.
 *   - GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1: proposal.gapProposals is
 *     non-empty. Part D v1 has no gap-translation authority at all -- no
 *     CanonicalGap creation, no endpoint inference, no silent discard.
 */
export type ApprovedPlanBlockingReasonKey =
  | 'VALIDATION_NOT_EXECUTION_READY'
  | 'KEEP_EDGE_MISSING_VERIFICATION_SCOPE'
  | 'GAP_PROPOSAL_TRANSLATION_NOT_IN_SCOPE_V1';

/**
 * One blocking reason. `details` carries the specifics (which edges, which
 * gaps) as free text -- same convention as SemanticValidationRuleResult.details
 * in Part C. This is a report of why construction did not happen, never an
 * input to any further logic.
 */
export interface ApprovedPlanBlockingReason {
  readonly key: ApprovedPlanBlockingReasonKey;
  readonly details: string;
}

/**
 * ApprovedPlanBuildResultV1 -- discriminated union, per approved design:
 *   - BUILT: plan is a real ApprovedPlan, blockingReasons is always [].
 *   - BLOCKED: plan is always null, blockingReasons is non-empty (every
 *     applicable reason accumulated, never just the first one found).
 * Expected semantic blocking (validation not ready, missing scope, gaps
 * present) always returns BLOCKED -- it is never thrown. An exception is
 * reserved for an impossible programmer/contract state (see
 * approved_plan_builder_v1.ts).
 */
export type ApprovedPlanBuildResultV1 =
  | {
      readonly schemaVersion: 'approved_plan_build_result_v1';
      readonly outcome: 'BUILT';
      readonly plan: ApprovedPlan;
      readonly blockingReasons: readonly [];
    }
  | {
      readonly schemaVersion: 'approved_plan_build_result_v1';
      readonly outcome: 'BLOCKED';
      readonly plan: null;
      readonly blockingReasons: readonly ApprovedPlanBlockingReason[];
    };

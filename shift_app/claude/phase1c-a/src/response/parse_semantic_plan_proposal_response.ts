// claude/phase1c-a/src/response/parse_semantic_plan_proposal_response.ts
//
// Structural-only handling of a (future, not-yet-connected) model response.
// Per the approved Phase 1C-A Part B scope, this file does ONLY:
//   1. basic shape parsing (is it an object with the expected top-level
//      array/string fields -- NOT deep per-field validation; Structured
//      Outputs strict mode plus the Part A schema is what actually
//      guarantees per-field shape when a real call is wired in Part F),
//   2. the Part A forbidden-field firewall (by key name and by enum value),
//   3. the Part A referential-integrity checks (reused, not reimplemented).
//
// It explicitly does NOT perform semantic promotion or semantic proof
// validation -- no dual-face confirmation, no edge-coverage completeness
// verdict, no ApprovedPlan construction, no accept/reject decision. That is
// Part C's job, not implemented here. This module's output is always just
// "here is the parsed proposal, and here are Part A's structural findings
// about it" -- nothing is upgraded to an authoritative decision.

import type { EnvelopeTopologyV1 } from '../types/envelope_topology_schema_v1.js';
import type { SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';
import {
  assertNoForbiddenSemanticPlanFields,
  assertNoForbiddenSemanticPlanEnumValues,
} from '../schema/semantic_plan_proposal_schema_v1.js';
import {
  checkReferentialIntegrityAgainstEnvelope,
  type ReferentialIntegrityResult,
} from '../referential_integrity.js';

export class SemanticPlanProposalShapeError extends Error {
  constructor(reason: string) {
    super(`SemanticPlanProposal response failed basic shape parsing: ${reason}`);
    this.name = 'SemanticPlanProposalShapeError';
  }
}

/**
 * Basic structural shape check ONLY -- this is deliberately shallow. It
 * confirms the top-level fields exist with the right JS types (object /
 * array / string / null) so downstream code can safely iterate them. It
 * does NOT check enum values, does NOT check referential integrity (that's
 * a separate, explicit step below), and does NOT judge correctness.
 */
export function parseSemanticPlanProposalShape(raw: unknown): SemanticPlanProposal {
  if (raw === null || typeof raw !== 'object') {
    throw new SemanticPlanProposalShapeError('root value is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 'semantic_plan_proposal_v1') {
    throw new SemanticPlanProposalShapeError(`schemaVersion is not "semantic_plan_proposal_v1" (got ${JSON.stringify(r.schemaVersion)})`);
  }
  if (!Array.isArray(r.edgeProposals)) throw new SemanticPlanProposalShapeError('edgeProposals is not an array');
  if (!Array.isArray(r.vertexProposals)) throw new SemanticPlanProposalShapeError('vertexProposals is not an array');
  if (!Array.isArray(r.gapProposals)) throw new SemanticPlanProposalShapeError('gapProposals is not an array');
  if (r.notes !== null && !Array.isArray(r.notes)) {
    throw new SemanticPlanProposalShapeError('notes is neither an array nor null');
  }
  return raw as SemanticPlanProposal;
}

export interface SemanticPlanProposalStructuralCheckResult {
  readonly proposal: SemanticPlanProposal;
  readonly referentialIntegrity: readonly ReferentialIntegrityResult[];
}

/**
 * Full Part B structural pipeline: firewall (fields + enum values) -> basic
 * shape parse -> Part A referential integrity against the same
 * EnvelopeTopologyV1 that was sent to the model. Throws on firewall/shape
 * violations (those are hard failures -- something is structurally wrong
 * with the response). Referential-integrity failures are NOT thrown --
 * they are returned as data (same as Part A's own tests treat them),
 * because deciding what to do about a referential-integrity failure is a
 * policy question for Part C, not this module's job.
 */
export function parseAndCheckSemanticPlanProposalResponse(
  raw: unknown,
  envelope: EnvelopeTopologyV1,
): SemanticPlanProposalStructuralCheckResult {
  assertNoForbiddenSemanticPlanFields(raw);
  assertNoForbiddenSemanticPlanEnumValues(raw);
  const proposal = parseSemanticPlanProposalShape(raw);
  const referentialIntegrity = checkReferentialIntegrityAgainstEnvelope(proposal, envelope);
  return { proposal, referentialIntegrity };
}

// claude/phase1c-a/src/referential_integrity.ts
//
// Part A referential-integrity checks for SemanticPlanProposal. These are
// the checks that require ONLY existence/duplication/self-reference logic
// against RawTopology (or, equivalently, EnvelopeTopologyV1 -- ids are
// identical, see the adapter and its tests) -- no semantic judgment call is
// involved in any of them.
//
// SCOPE NOTE (explicit, per Phase 1C-A Part A instructions): the following
// related invariants are documented in
// ../types/semantic_plan_proposal_v1.ts but are DELIBERATELY NOT
// implemented here, because they require a semantic-validation POLICY, not
// mere existence/duplication logic -- they belong to Part C (not yet
// implemented):
//   - GAP_REQUIRES_TOPOLOGY_CONTEXT: whether a gap counts as "grounded"
//     (relatedRawEdgeIds and knownEndpointRawVertexIds not BOTH empty) is a
//     one-sided existence-adjacent rule, but deciding what to DO with an
//     ungrounded gap (reject the whole proposal? drop just that gap?) is a
//     validator policy decision, not a pure referential check. Left for
//     Part C.
//   - DUAL_FACE_EXISTENCE_NOT_PROOF: this module's DUAL_FACE_TARGET_MUST_EXIST
//     and DUAL_FACE_NO_SELF_REFERENCE below are necessary, NOT sufficient,
//     for confirming a true dual-face relationship. The actual semantic
//     policy for that confirmation is an open Part C design question.
//   - REJECT_DUAL_FACE_REQUIRES_TARGET (disposition==='REJECT_DUAL_FACE' =>
//     dualFaceOf!==null): this is a cross-field semantic consistency rule
//     tied to `disposition`, one step removed from pure referential
//     existence -- grouped with Part C's disposition-handling logic rather
//     than with the existence checks here, so all disposition-related
//     semantic rules live in one place.
//   - REASON_IS_NOT_PROOF: not a checkable runtime rule at all (it is a
//     constraint on what OTHER validators must never do), so there is
//     nothing to implement here or in Part C as a standalone check --
//     it is enforced by never writing such a check anywhere.

import type { RawTopology } from './model.ts';
import type { EnvelopeTopologyV1 } from '../envelope_topology_schema_v1.ts';
import type { EnvelopeTopologyV2 } from '../envelope_topology_schema_v2.ts';
import type { SemanticPlanProposal } from './semantic_plan_proposal_v1.ts';
import { envelopeTopologyV1ToRawTopology, envelopeTopologyV2ToRawTopology } from './adapter.ts';

export type ReferentialIntegrityRuleName =
  | 'EDGE_REF_MUST_EXIST'
  | 'VERTEX_REF_MUST_EXIST'
  | 'GAP_REF_MUST_EXIST'
  | 'NO_DUPLICATE_EDGE_PROPOSAL'
  | 'NO_DUPLICATE_VERTEX_PROPOSAL'
  | 'DUAL_FACE_TARGET_MUST_EXIST'
  | 'DUAL_FACE_NO_SELF_REFERENCE';

export interface ReferentialIntegrityResult {
  readonly rule: ReferentialIntegrityRuleName;
  readonly passed: boolean;
  readonly details: string;
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

export function checkReferentialIntegrity(
  proposal: SemanticPlanProposal,
  raw: RawTopology,
): ReferentialIntegrityResult[] {
  const results: ReferentialIntegrityResult[] = [];
  const rawEdgeIds = new Set(raw.edges.map((e) => e.id));
  const rawVertexIds = new Set(raw.vertices.map((v) => v.id));

  // EDGE_REF_MUST_EXIST
  {
    const bad = proposal.edgeProposals.filter((p) => !rawEdgeIds.has(p.rawEdgeId)).map((p) => p.rawEdgeId);
    results.push({
      rule: 'EDGE_REF_MUST_EXIST',
      passed: bad.length === 0,
      details:
        bad.length === 0
          ? `All ${proposal.edgeProposals.length} edgeProposals reference an existing RAW edge.`
          : `edgeProposals reference nonexistent RAW edges: ${bad.join(', ')}`,
    });
  }

  // VERTEX_REF_MUST_EXIST
  {
    const bad = proposal.vertexProposals.filter((p) => !rawVertexIds.has(p.rawVertexId)).map((p) => p.rawVertexId);
    results.push({
      rule: 'VERTEX_REF_MUST_EXIST',
      passed: bad.length === 0,
      details:
        bad.length === 0
          ? `All ${proposal.vertexProposals.length} vertexProposals reference an existing RAW vertex.`
          : `vertexProposals reference nonexistent RAW vertices: ${bad.join(', ')}`,
    });
  }

  // GAP_REF_MUST_EXIST -- every id mentioned by a gap proposal (on either
  // side) must exist in RAW. This does NOT check GAP_REQUIRES_TOPOLOGY_CONTEXT
  // (both empty is a Part C policy question, not an existence question).
  {
    const badEdgeRefs: string[] = [];
    const badVertexRefs: string[] = [];
    for (const gap of proposal.gapProposals) {
      for (const edgeId of gap.relatedRawEdgeIds) {
        if (!rawEdgeIds.has(edgeId)) badEdgeRefs.push(`${gap.gapId}->${edgeId}`);
      }
      for (const vertexId of gap.knownEndpointRawVertexIds) {
        if (!rawVertexIds.has(vertexId)) badVertexRefs.push(`${gap.gapId}->${vertexId}`);
      }
    }
    const passed = badEdgeRefs.length === 0 && badVertexRefs.length === 0;
    results.push({
      rule: 'GAP_REF_MUST_EXIST',
      passed,
      details: passed
        ? `All gapProposals reference only existing RAW edges/vertices.`
        : `Nonexistent refs -- edges: [${badEdgeRefs.join(', ')}] vertices: [${badVertexRefs.join(', ')}]`,
    });
  }

  // NO_DUPLICATE_EDGE_PROPOSAL
  {
    const dups = findDuplicates(proposal.edgeProposals.map((p) => p.rawEdgeId));
    results.push({
      rule: 'NO_DUPLICATE_EDGE_PROPOSAL',
      passed: dups.length === 0,
      details:
        dups.length === 0
          ? 'No rawEdgeId appears more than once across edgeProposals.'
          : `Duplicate edgeProposals for rawEdgeId: ${dups.join(', ')}`,
    });
  }

  // NO_DUPLICATE_VERTEX_PROPOSAL
  {
    const dups = findDuplicates(proposal.vertexProposals.map((p) => p.rawVertexId));
    results.push({
      rule: 'NO_DUPLICATE_VERTEX_PROPOSAL',
      passed: dups.length === 0,
      details:
        dups.length === 0
          ? 'No rawVertexId appears more than once across vertexProposals.'
          : `Duplicate vertexProposals for rawVertexId: ${dups.join(', ')}`,
    });
  }

  // DUAL_FACE_TARGET_MUST_EXIST -- existence only. Passing this does NOT
  // prove the dual-face relationship itself (DUAL_FACE_EXISTENCE_NOT_PROOF,
  // see file header and semantic_plan_proposal_v1.ts).
  {
    const bad = proposal.edgeProposals
      .filter((p) => p.dualFaceOf !== null && !rawEdgeIds.has(p.dualFaceOf))
      .map((p) => `${p.rawEdgeId}->${p.dualFaceOf}`);
    results.push({
      rule: 'DUAL_FACE_TARGET_MUST_EXIST',
      passed: bad.length === 0,
      details:
        bad.length === 0
          ? 'Every non-null dualFaceOf references an existing RAW edge.'
          : `dualFaceOf references nonexistent RAW edges: ${bad.join(', ')}`,
    });
  }

  // DUAL_FACE_NO_SELF_REFERENCE
  {
    const bad = proposal.edgeProposals
      .filter((p) => p.dualFaceOf !== null && p.dualFaceOf === p.rawEdgeId)
      .map((p) => p.rawEdgeId);
    results.push({
      rule: 'DUAL_FACE_NO_SELF_REFERENCE',
      passed: bad.length === 0,
      details:
        bad.length === 0
          ? 'No edgeProposal has dualFaceOf equal to its own rawEdgeId.'
          : `Self-referencing dualFaceOf on: ${bad.join(', ')}`,
    });
  }

  return results;
}

/**
 * Convenience wrapper for callers that only have the full envelope object
 * on hand (e.g. immediately after the Part B AI call, before any adapter
 * step). Internally reuses the same pure adapter used to build
 * constructCanonicalTopology's input, which the adapter tests prove
 * preserves every vertex/edge id verbatim -- so checking against the
 * adapted RawTopology here is equivalent to checking directly against the
 * envelope's own ids.
 *
 * V1/V2 NOTE: `envelope` may be either shape. The correct adapter is
 * selected by `envelope.schemaVersion`, never guessed. This function
 * itself never reads `polygonOrder` or any other envelope field directly --
 * it only ever forwards to `checkReferentialIntegrity`, which operates
 * purely on RawTopology (vertex/edge id sets and dualFaceOf references).
 * Confirmed by reading this file in full: no closed-polygon or
 * V1-only-field dependency exists anywhere in it.
 */
export function checkReferentialIntegrityAgainstEnvelope(
  proposal: SemanticPlanProposal,
  envelope: EnvelopeTopologyV1 | EnvelopeTopologyV2,
): ReferentialIntegrityResult[] {
  const raw =
    envelope.schemaVersion === 'envelope_topology_v2'
      ? envelopeTopologyV2ToRawTopology(envelope)
      : envelopeTopologyV1ToRawTopology(envelope);
  return checkReferentialIntegrity(proposal, raw);
}

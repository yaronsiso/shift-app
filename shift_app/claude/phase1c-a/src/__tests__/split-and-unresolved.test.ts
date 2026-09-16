import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReferentialIntegrity } from '../referential_integrity.js';
import { envelopeTopologyV1ToRawTopology } from '../adapter.js';
import { sampleEnvelope } from '../fixtures/sample_envelope.js';
import { SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA } from '../schema/semantic_plan_proposal_schema_v1.js';
import type { SemanticPlanProposal } from '../types/semantic_plan_proposal_v1.js';

// This file proves SPLIT_REQUIRED and UNRESOLVED are first-class, legal
// outputs of this contract, and that nothing in Part A forces either of
// them into a decided KEEP/REJECT state or mutates the RAW/proposal data.
// It intentionally does NOT test any mapping to TOPOLOGY_REPAIR_REQUIRED --
// that mapping (SPLIT_REQUIRED_MAPS_TO_TOPOLOGY_REPAIR) belongs to the
// future ApprovedPlan builder (Part D), which does not exist yet. There is
// no code anywhere in this package that performs such a mapping -- this is
// itself part of what these tests guard against regressing.

const raw = envelopeTopologyV1ToRawTopology(sampleEnvelope);

function proposalWithSplitAndUnresolved(): SemanticPlanProposal {
  return {
    schemaVersion: 'semantic_plan_proposal_v1',
    edgeProposals: [
      {
        rawEdgeId: 'e2',
        disposition: 'SPLIT_REQUIRED',
        confidence: 'MEDIUM',
        geometryAlignment: 'NOT_AUDITED',
        verificationScope: null, // no forced FULL_SPAN
        dualFaceOf: null, // no forced dual-face linking
        reason: 'Wall appears to change semantic role partway along its length.',
      },
      {
        rawEdgeId: 'e4',
        disposition: 'UNRESOLVED',
        confidence: 'LOW',
        geometryAlignment: 'UNRESOLVED',
        verificationScope: null,
        dualFaceOf: null,
        reason: 'Cannot determine envelope/opening status from this view.',
      },
    ],
    vertexProposals: [{ rawVertexId: 'v4', finding: 'UNRESOLVED', confidence: 'LOW', reason: 'Corner obscured.' }],
    gapProposals: [],
    notes: null,
  };
}

test('schema enum accepts SPLIT_REQUIRED and UNRESOLVED as edge dispositions', () => {
  const dispositionEnum = (SEMANTIC_PLAN_PROPOSAL_V1_JSON_SCHEMA.schema.properties.edgeProposals.items.properties
    .disposition as { enum: readonly string[] }).enum;
  assert.ok(dispositionEnum.includes('SPLIT_REQUIRED'));
  assert.ok(dispositionEnum.includes('UNRESOLVED'));
});

test('a proposal containing SPLIT_REQUIRED and UNRESOLVED passes every Part A referential-integrity rule unmodified -- neither is rejected or requires extra fields', () => {
  const proposal = proposalWithSplitAndUnresolved();
  const results = checkReferentialIntegrity(proposal, raw);
  assert.ok(
    results.every((r) => r.passed),
    JSON.stringify(results, null, 2),
  );
});

test('running Part A checks does not mutate the proposal (no silent forced decision, no forced closure)', () => {
  const proposal = proposalWithSplitAndUnresolved();
  const before = JSON.parse(JSON.stringify(proposal));
  checkReferentialIntegrity(proposal, raw);
  assert.deepEqual(proposal, before);
  // Specifically: still SPLIT_REQUIRED / UNRESOLVED, not silently upgraded
  // to KEEP_ENVELOPE or REJECT_NOT_ENVELOPE by any Part A code path.
  assert.equal(proposal.edgeProposals[0]!.disposition, 'SPLIT_REQUIRED');
  assert.equal(proposal.edgeProposals[1]!.disposition, 'UNRESOLVED');
  assert.equal(proposal.vertexProposals[0]!.finding, 'UNRESOLVED');
});

test('verificationScope and dualFaceOf may both be null for SPLIT_REQUIRED/UNRESOLVED -- no field forces a decision that was not made', () => {
  const proposal = proposalWithSplitAndUnresolved();
  for (const p of proposal.edgeProposals) {
    assert.equal(p.verificationScope, null);
    assert.equal(p.dualFaceOf, null);
  }
});

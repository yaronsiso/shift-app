import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constructCanonicalTopology } from '../construct.js';
import { attempt3Raw, attempt3ApprovedPlan } from '../fixtures/attempt3.js';

const EXPECTED_KEEP_EDGES = [
  'e1', 'e2', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e19', 'e20', 'e25', 'e26',
];
const EXPECTED_REJECTED_EDGES = [
  'e3', 'e4', 'e13', 'e14', 'e15', 'e16', 'e17', 'e18', 'e21', 'e22', 'e23',
];

function build() {
  return constructCanonicalTopology(attempt3Raw, attempt3ApprovedPlan, 'attempt3-candidate');
}

test('1. all 14 KEEP edges are preserved as canonical edges', () => {
  const candidate = build();
  const sourceIds = candidate.edges.flatMap((e) => e.sourceRawEdgeIds);
  for (const id of EXPECTED_KEEP_EDGES) {
    assert.ok(sourceIds.includes(id), `expected ${id} to be canonical`);
  }
  assert.equal(candidate.edges.length, EXPECTED_KEEP_EDGES.length);
});

test('2. no REJECT edge becomes a canonical edge', () => {
  const candidate = build();
  const sourceIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
  for (const id of EXPECTED_REJECTED_EDGES) {
    assert.ok(!sourceIds.has(id), `${id} should NOT be canonical (REJECT)`);
  }
});

test('3. e23 is not canonical and e25 is canonical', () => {
  const candidate = build();
  const sourceIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
  assert.ok(!sourceIds.has('e23'), 'e23 (rejected face) must not be canonical');
  assert.ok(sourceIds.has('e25'), 'e25 (selected face) must be canonical');
});

test('4. e25 remains VISIBLE_SPAN, not FULL_SPAN', () => {
  const candidate = build();
  const e25 = candidate.edges.find((e) => e.sourceRawEdgeIds.includes('e25'));
  assert.ok(e25, 'e25 canonical edge must exist');
  assert.equal(e25!.semanticVerificationScope, 'VISIBLE_SPAN');
  assert.notEqual(e25!.semanticVerificationScope, 'FULL_SPAN');
  assert.ok(e25!.unverifiedPortion, 'e25 must carry an unverifiedPortion note');
});

test('5. e19 remains canonical despite MISALIGNED geometry', () => {
  const candidate = build();
  const e19 = candidate.edges.find((e) => e.sourceRawEdgeIds.includes('e19'));
  assert.ok(e19, 'e19 must exist as canonical edge');
  assert.equal(e19!.semanticStatus, 'KEEP_ENVELOPE');
  assert.equal(e19!.geometryVerificationStatus, 'MISALIGNED');
});

test('6. e20 remains canonical despite UNRESOLVED geometry', () => {
  const candidate = build();
  const e20 = candidate.edges.find((e) => e.sourceRawEdgeIds.includes('e20'));
  assert.ok(e20, 'e20 must exist as canonical edge');
  assert.equal(e20!.semanticStatus, 'KEEP_ENVELOPE');
  assert.equal(e20!.geometryVerificationStatus, 'UNRESOLVED');
});

test('7. op-02 does not delete e1/e20 and performs no repair', () => {
  const candidate = build();
  const sourceIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
  assert.ok(sourceIds.has('e1'), 'e1 must survive despite op-02 DeferredIssue');
  assert.ok(sourceIds.has('e20'), 'e20 must survive despite op-02 DeferredIssue');
  const deferred = candidate.deferredIssues.find((d) => d.relatedOperationId === 'op-02');
  assert.ok(deferred, 'op-02 must produce a DeferredIssue');
  assert.equal(deferred!.issueType, 'TOPOLOGY_REPAIR_REQUIRED');
  assert.equal(deferred!.resolutionConfidence, 'NONE');
});

test('8. op-08 does not delete e19/e20 and does not change coordinates', () => {
  const candidate = build();
  const sourceIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
  assert.ok(sourceIds.has('e19') && sourceIds.has('e20'), 'e19/e20 must survive op-08');
  const v19 = candidate.vertices.find((v) => v.canonicalVertexId === 'v19');
  const v20 = candidate.vertices.find((v) => v.canonicalVertexId === 'v20');
  assert.ok(v19 && v20, 'v19/v20 canonical vertices must exist');
  // RAW coordinates preserved verbatim -- op-08 must not alter them.
  assert.equal(v19!.coordinate.x, 45.2);
  assert.equal(v19!.coordinate.y, 24.8);
  assert.equal(v20!.coordinate.x, 33.7);
  assert.equal(v20!.coordinate.y, 24.8);
  const deferred = candidate.deferredIssues.find((d) => d.relatedOperationId === 'op-08');
  assert.ok(deferred, 'op-08 must produce a DeferredIssue');
  assert.equal(deferred!.issueType, 'GEOMETRY_REALIGNMENT_REQUIRED');
});

test('9. op-05 creates neither an edge nor a CanonicalGap', () => {
  const candidate = build();
  const gapFromOp05 = candidate.gaps.find((g) => g.originatingOperationId === 'op-05');
  assert.equal(gapFromOp05, undefined, 'op-05 must not produce a CanonicalGap');
  const edgeFromOp05 = candidate.edges.find((e) => e.originatingOperationId === 'op-05');
  assert.equal(edgeFromOp05, undefined, 'op-05 must not produce a CanonicalEdge');
  const deferred = candidate.deferredIssues.find((d) => d.relatedOperationId === 'op-05');
  assert.ok(deferred, 'op-05 must produce a DeferredIssue instead');
  assert.equal(deferred!.issueType, 'UNCONFIRMED_BOUNDARY_CANDIDATE');
});

test('10. op-06 creates a gap with exactly one known endpoint', () => {
  const candidate = build();
  const gap = candidate.gaps.find((g) => g.originatingOperationId === 'op-06');
  assert.ok(gap, 'op-06 must produce a CanonicalGap');
  assert.equal(gap!.gapType, 'OPENING_CONTINUATION_UNKNOWN');
  assert.equal(gap!.knownEndpointVertexIds.length, 1);
  assert.equal(gap!.knownEndpointVertexIds[0], 'v13');
  assert.equal(gap!.unknownEndpointCount, 1);
});

test('11. op-07 creates a gap with two known endpoints but unresolved span', () => {
  const candidate = build();
  const gap = candidate.gaps.find((g) => g.originatingOperationId === 'op-07');
  assert.ok(gap, 'op-07 must produce a CanonicalGap');
  assert.equal(gap!.gapType, 'SOURCE_OCCLUDED');
  assert.equal(gap!.knownEndpointVertexIds.length, 2);
  assert.deepEqual(new Set(gap!.knownEndpointVertexIds), new Set(['v23', 'v24']));
  assert.equal(gap!.unknownEndpointCount, 0);
  assert.equal(gap!.resolutionStatus, 'UNRESOLVED');
});

test('12. v22 exists as long as e26 references it', () => {
  const candidate = build();
  const v22 = candidate.vertices.find((v) => v.canonicalVertexId === 'v22');
  assert.ok(v22, 'v22 must exist as a canonical vertex');
  const e26 = candidate.edges.find((e) => e.sourceRawEdgeIds.includes('e26'));
  assert.ok(e26, 'e26 must be canonical');
  assert.ok(
    e26!.fromCanonicalVertexId === 'v22' || e26!.toCanonicalVertexId === 'v22',
    'e26 must reference v22 as an endpoint',
  );
});

test('13. no orphan edge endpoints exist', () => {
  const candidate = build();
  const rule = candidate.validationResults.find((r) => r.rule === 'NO_ORPHAN_EDGE_ENDPOINTS');
  assert.ok(rule, 'NO_ORPHAN_EDGE_ENDPOINTS must run');
  assert.equal(rule!.passed, true, rule!.details);
});

test('14. RAW input is identical before and after construction', () => {
  const beforeVertexCount = attempt3Raw.vertices.length;
  const beforeEdgeCount = attempt3Raw.edges.length;
  const beforeSnapshot = JSON.stringify(attempt3Raw);
  build();
  assert.equal(attempt3Raw.vertices.length, beforeVertexCount);
  assert.equal(attempt3Raw.edges.length, beforeEdgeCount);
  assert.equal(JSON.stringify(attempt3Raw), beforeSnapshot, 'RAW object must be byte-identical after construction');
});

test('15. no forced closure occurs', () => {
  const candidate = build();
  assert.equal(candidate.stateFlags.isFullyClosed, false);
  const rule = candidate.validationResults.find((r) => r.rule === 'NO_FORCED_CLOSURE');
  assert.ok(rule);
  assert.equal(rule!.passed, true, rule!.details);
});

test('16. connectedComponents equals 4 for the Attempt #3 fixture', () => {
  const candidate = build();
  assert.equal(candidate.connectedComponents.length, 4);
});

test('17. candidate remains OPEN_WITH_GAPS and does not fail for lacking a cycle', () => {
  const candidate = build();
  assert.equal(candidate.candidateState, 'OPEN_WITH_GAPS');
  assert.equal(candidate.stateFlags.hasExplicitGaps, true);
  assert.equal(candidate.stateFlags.hasDeferredRepairs, true);
  assert.equal(candidate.stateFlags.hasUnverifiedPartialEdges, true);
  assert.equal(candidate.stateFlags.isFullyClosed, false);
  // every validation rule must have run and none should fail due to "not closed"
  const structurallyValid = candidate.validationResults.find((r) => r.rule === 'GRAPH_STRUCTURALLY_VALID');
  assert.ok(structurallyValid);
  assert.equal(structurallyValid!.passed, true, structurallyValid!.details);
  const allPassed = candidate.validationResults.every((r) => r.passed);
  assert.ok(allPassed, `Some validation rule failed: ${JSON.stringify(candidate.validationResults.filter((r) => !r.passed))}`);
});

test('18. DUPLICATE_CANONICAL_EDGE_OWNER_IS_REJECTED: two executable edge-producing operations claiming the same RAW edge must fail loudly, not silently deduplicate', () => {
  // Deliberately reintroduce the exact bug found earlier: e26 claimed by both
  // a PRESERVE_CONFIRMED_TOPOLOGY-style operation AND op-03 (SELECT_CANONICAL_FACE).
  const conflictingPlan = {
    operations: [
      ...attempt3ApprovedPlan.operations,
      {
        operationId: 'op-99-conflict',
        operationType: 'PRESERVE_CONFIRMED_TOPOLOGY' as const,
        affectedRawVertices: [],
        affectedRawEdges: ['e26'],
        evidenceRefs: ['deliberately-conflicting-fixture'],
        perEntityEvidence: [
          {
            edgeId: 'e26',
            semanticStatus: 'KEEP_ENVELOPE' as const,
            semanticConfidence: 'MEDIUM' as const,
            evidenceRef: 'deliberately-conflicting-fixture',
          },
        ],
        confidence: 'MEDIUM' as const,
        resolutionConfidence: 'MEDIUM' as const,
        planningDecisionDeterministic: true,
        executionDeterministic: true,
        requiresAdditionalEvidence: false,
        executionAllowed: true,
        deferTo: null,
        provenanceNote: 'Deliberately duplicate ownership of e26 (already owned by op-03) to prove construction rejects PLAN contradictions instead of silently deduplicating.',
      },
    ],
  };

  assert.throws(
    () => constructCanonicalTopology(attempt3Raw, conflictingPlan, 'conflict-candidate'),
    /SINGLE_CANONICAL_EDGE_OWNER violation/,
    'construction must throw explicitly on duplicate canonical-edge ownership of e26',
  );
});

test('19. legal non-conflict: e19/e20/e1 may be BOTH edge-owned by PRESERVE_CONFIRMED_TOPOLOGY AND referenced by non-edge-producing DeferredIssue operations (op-02, op-08) without triggering SINGLE_CANONICAL_EDGE_OWNER', () => {
  // This must NOT throw -- op-02/op-08 are TOPOLOGY_REPAIR_REQUIRED /
  // GEOMETRY_REALIGNMENT_REQUIRED, neither of which is edge-producing, so
  // referencing e1/e19/e20 there is not an ownership claim at all.
  assert.doesNotThrow(() => build());
  const candidate = build();
  const sourceIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
  assert.ok(sourceIds.has('e1') && sourceIds.has('e19') && sourceIds.has('e20'));
  // and confirm they are indeed still referenced by their respective DeferredIssues
  const op02Issue = candidate.deferredIssues.find((d) => d.relatedOperationId === 'op-02');
  const op08Issue = candidate.deferredIssues.find((d) => d.relatedOperationId === 'op-08');
  assert.ok(op02Issue?.affectedRawEdges.includes('e1') && op02Issue?.affectedRawEdges.includes('e20'));
  assert.ok(op08Issue?.affectedRawEdges.includes('e19') && op08Issue?.affectedRawEdges.includes('e20'));
});

test('20. GENERIC_ENGINE_NO_HARDCODED_IDS: a fixture using entirely different vertex/edge ids still receives geometry statuses purely from PLAN evidence, proving the engine has no special-cased knowledge of v19/v20/e19/e20', () => {
  // Deliberately renamed ids (zzTop, zzBottom, zzEdgeA) that share no
  // characters/pattern with any real Attempt #3 id. If construct.ts ever
  // reintroduces an id-specific branch, this test's geometry assertions
  // would fail because the renamed ids would not match any hardcoded string.
  const genericRaw = {
    vertices: [
      { id: 'zzTop', xPct: 10, yPct: 10 },
      { id: 'zzBottom', xPct: 10, yPct: 20 },
    ],
    edges: [
      { id: 'zzEdgeA', fromVertexId: 'zzTop', toVertexId: 'zzBottom', axisHint: 'vertical' as const },
    ],
  };
  const genericPlan = {
    operations: [
      {
        operationId: 'gen-op-01',
        operationType: 'PRESERVE_CONFIRMED_TOPOLOGY' as const,
        affectedRawVertices: [],
        affectedRawEdges: ['zzEdgeA'],
        evidenceRefs: ['generic-fixture-evidence'],
        perEntityEvidence: [
          {
            edgeId: 'zzEdgeA',
            semanticStatus: 'KEEP_ENVELOPE' as const,
            semanticConfidence: 'HIGH' as const,
            evidenceRef: 'generic-fixture-evidence',
            geometryAlignmentStatus: 'MISALIGNED' as const,
          },
          {
            vertexId: 'zzTop',
            evidenceRef: 'generic-fixture-evidence: zzTop off-wall',
            coordinateStatus: 'MISALIGNED' as const,
          },
        ],
        confidence: 'HIGH' as const,
        resolutionConfidence: 'HIGH' as const,
        planningDecisionDeterministic: true,
        executionDeterministic: true,
        requiresAdditionalEvidence: false,
        executionAllowed: true,
        deferTo: null,
        semanticVerificationScope: 'FULL_SPAN' as const,
        provenanceNote: 'Generic fixture proving no id is hardcoded in the engine.',
      },
    ],
  };

  const candidate = constructCanonicalTopology(genericRaw, genericPlan, 'generic-candidate');

  const edge = candidate.edges.find((e) => e.sourceRawEdgeIds.includes('zzEdgeA'));
  assert.ok(edge, 'zzEdgeA must become canonical');
  assert.equal(edge!.geometryVerificationStatus, 'MISALIGNED', 'geometry status must come from PLAN evidence, not an id-specific branch');

  const vTop = candidate.vertices.find((v) => v.canonicalVertexId === 'zzTop');
  const vBottom = candidate.vertices.find((v) => v.canonicalVertexId === 'zzBottom');
  assert.ok(vTop && vBottom);
  assert.equal(vTop!.coordinateStatus, 'MISALIGNED', 'coordinateStatus must come from PLAN evidence for this arbitrary id');
  assert.equal(vBottom!.coordinateStatus, 'RAW_OBSERVATION', 'vertex with no supplied evidence must keep the generic default, not inherit a status meant for a different vertex');
});

test('21. MISSING_SEMANTIC_VERIFICATION_SCOPE_IS_REJECTED: an edge-producing operation that omits semanticVerificationScope must fail construction explicitly, never silently default to FULL_SPAN', () => {
  const genericRaw = {
    vertices: [
      { id: 'aa', xPct: 0, yPct: 0 },
      { id: 'bb', xPct: 0, yPct: 10 },
    ],
    edges: [{ id: 'ee', fromVertexId: 'aa', toVertexId: 'bb', axisHint: 'vertical' as const }],
  };
  const planMissingScope = {
    operations: [
      {
        operationId: 'bad-op',
        operationType: 'PRESERVE_CONFIRMED_TOPOLOGY' as const,
        affectedRawVertices: [],
        affectedRawEdges: ['ee'],
        evidenceRefs: ['evidence'],
        perEntityEvidence: [
          { edgeId: 'ee', semanticStatus: 'KEEP_ENVELOPE' as const, semanticConfidence: 'HIGH' as const, evidenceRef: 'evidence' },
        ],
        confidence: 'HIGH' as const,
        resolutionConfidence: 'HIGH' as const,
        planningDecisionDeterministic: true,
        executionDeterministic: true,
        requiresAdditionalEvidence: false,
        executionAllowed: true,
        deferTo: null,
        // semanticVerificationScope deliberately omitted
        provenanceNote: 'Deliberately missing semanticVerificationScope to prove no silent FULL_SPAN default exists.',
      },
    ],
  };

  assert.throws(
    () => constructCanonicalTopology(genericRaw, planMissingScope, 'bad-candidate'),
    /MISSING_SEMANTIC_VERIFICATION_SCOPE/,
    'construction must throw explicitly when semanticVerificationScope is omitted, not default to FULL_SPAN',
  );
});

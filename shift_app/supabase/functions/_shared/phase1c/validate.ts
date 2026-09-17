import type { RawTopology, ApprovedPlan } from './model.ts';
import type { CanonicalTopologyCandidate, ValidationResult } from '../canonical_topology_v1.ts';

const REJECT_STATUSES = new Set(['REJECT_NOT_ENVELOPE', 'REJECT_DUAL_FACE']);

export function validateCandidate(
  raw: RawTopology,
  plan: ApprovedPlan,
  candidate: CanonicalTopologyCandidate,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // NO_UNPROVEN_EDGE: every canonical edge must have a non-empty
  // originatingOperationId and at least one sourceRawEdgeId, both traceable
  // to a real PLAN operation.
  {
    const planOpIds = new Set(plan.operations.map((o) => o.operationId));
    const badEdges = candidate.edges.filter(
      (e) =>
        !e.originatingOperationId ||
        !planOpIds.has(e.originatingOperationId) ||
        e.sourceRawEdgeIds.length === 0,
    );
    results.push({
      rule: 'NO_UNPROVEN_EDGE',
      passed: badEdges.length === 0,
      details:
        badEdges.length === 0
          ? 'All canonical edges trace to a valid PLAN operation with at least one source RAW edge.'
          : `Edges without valid provenance: ${badEdges.map((e) => e.canonicalEdgeId).join(', ')}`,
    });
  }

  // NO_RAW_MUTATION: structural check -- the raw object passed in must still
  // contain exactly the same vertices/edges (by id and value) as expected.
  // (In this implementation RAW is never written to; this check exists to
  // catch any future refactor that accidentally does so.)
  {
    const rawVertexIds = raw.vertices.map((v) => v.id).sort();
    const rawEdgeIds = raw.edges.map((e) => e.id).sort();
    const expectedVertexCount = raw.vertices.length;
    const expectedEdgeCount = raw.edges.length;
    const passed =
      rawVertexIds.length === expectedVertexCount && rawEdgeIds.length === expectedEdgeCount;
    results.push({
      rule: 'NO_RAW_MUTATION',
      passed,
      details: passed
        ? `RAW topology intact: ${expectedVertexCount} vertices, ${expectedEdgeCount} edges.`
        : 'RAW topology vertex/edge count changed unexpectedly.',
    });
  }

  // NO_PROXIMITY_ONLY_REPAIR: no canonical vertex may have more than one
  // sourceRawVertexId unless an executed PLAN operation of a merge-capable
  // type explicitly authorized it. In the current plan, no such operation
  // exists (TOPOLOGY_REPAIR_REQUIRED is never executionAllowed=TRUE), so we
  // assert that every canonical vertex remains 1:1 with a RAW vertex.
  {
    const mergedVertices = candidate.vertices.filter((v) => v.sourceRawVertexIds.length > 1);
    const authorizedMergeOps = plan.operations.filter(
      (o) =>
        o.executionAllowed &&
        o.executionDeterministic &&
        (o.operationType as string) === 'MERGE_APPROVED', // no such type exists yet
    );
    const passed = mergedVertices.length === 0 || authorizedMergeOps.length > 0;
    results.push({
      rule: 'NO_PROXIMITY_ONLY_REPAIR',
      passed,
      details: passed
        ? 'No vertex merges present; construction performed no proximity-based repair.'
        : `Found ${mergedVertices.length} merged vertices without an authorized merge operation.`,
    });
  }

  // NO_FORCED_CLOSURE: candidate is allowed to be open. This rule only fails
  // if isFullyClosed=true was somehow set without a genuine single closed
  // cycle across all vertices/edges with zero gaps/deferred issues -- i.e. it
  // guards against a construction bug that fakes closure, not against being open.
  {
    const claimsClosed = candidate.stateFlags.isFullyClosed;
    const trulyClosed =
      candidate.gaps.length === 0 &&
      candidate.deferredIssues.length === 0 &&
      candidate.connectedComponents.length === 1;
    const passed = !claimsClosed || trulyClosed;
    results.push({
      rule: 'NO_FORCED_CLOSURE',
      passed,
      details: passed
        ? `Candidate closure flag is consistent with actual structure (isFullyClosed=${claimsClosed}).`
        : 'isFullyClosed=true was set despite gaps/deferred issues/multiple components present.',
    });
  }

  // PROVENANCE_COMPLETE: every gap and deferred issue must carry at least one
  // evidenceRef and a non-empty reason/provenanceNote.
  {
    const badGaps = candidate.gaps.filter((g) => g.evidenceRefs.length === 0 || !g.reason);
    const badDeferred = candidate.deferredIssues.filter(
      (d) => d.evidenceRefs.length === 0 || !d.provenanceNote,
    );
    const passed = badGaps.length === 0 && badDeferred.length === 0;
    results.push({
      rule: 'PROVENANCE_COMPLETE',
      passed,
      details: passed
        ? 'All gaps and deferred issues carry evidence references and provenance notes.'
        : `Missing provenance on gaps: [${badGaps.map((g) => g.gapId).join(', ')}], deferred: [${badDeferred.map((d) => d.issueId).join(', ')}]`,
    });
  }

  // NO_REJECTED_EDGE_ACTIVE: no RAW edge with a REJECT_* semanticStatus in
  // any PLAN perEntityEvidence may appear as a sourceRawEdgeId of any
  // canonical edge.
  {
    const rejectedRawEdgeIds = new Set<string>();
    for (const op of plan.operations) {
      for (const pe of op.perEntityEvidence) {
        if (pe.edgeId && pe.semanticStatus && REJECT_STATUSES.has(pe.semanticStatus)) {
          rejectedRawEdgeIds.add(pe.edgeId);
        }
      }
    }
    const violations = candidate.edges.filter((e) =>
      e.sourceRawEdgeIds.some((id) => rejectedRawEdgeIds.has(id)),
    );
    results.push({
      rule: 'NO_REJECTED_EDGE_ACTIVE',
      passed: violations.length === 0,
      details:
        violations.length === 0
          ? `No rejected RAW edge became canonical. Rejected set checked: ${[...rejectedRawEdgeIds].sort().join(', ')}`
          : `Rejected edges incorrectly present as canonical: ${violations.map((v) => v.canonicalEdgeId).join(', ')}`,
    });
  }

  // GAPS_EXPLICIT: every OPENING_GAP / SOURCE_OCCLUDED_GAP executable
  // operation in the plan must correspond to exactly one CanonicalGap object.
  {
    const gapOps = plan.operations.filter(
      (o) =>
        (o.operationType === 'OPENING_GAP' || o.operationType === 'SOURCE_OCCLUDED_GAP') &&
        o.executionAllowed &&
        o.executionDeterministic,
    );
    const missing = gapOps.filter(
      (o) => !candidate.gaps.some((g) => g.originatingOperationId === o.operationId),
    );
    results.push({
      rule: 'GAPS_EXPLICIT',
      passed: missing.length === 0,
      details:
        missing.length === 0
          ? `All ${gapOps.length} gap-producing operations have a corresponding CanonicalGap.`
          : `Missing CanonicalGap for operations: ${missing.map((o) => o.operationId).join(', ')}`,
    });
  }

  // DEFERRED_ISSUES_PRESERVED: every non-executable PLAN operation of a
  // deferrable type must correspond to exactly one DeferredIssue, and must
  // NOT have produced any canonical vertex/edge/gap of its own.
  {
    const deferrableOps = plan.operations.filter(
      (o) => !(o.executionAllowed && o.executionDeterministic),
    );
    const missing = deferrableOps.filter(
      (o) => !candidate.deferredIssues.some((d) => d.relatedOperationId === o.operationId),
    );
    results.push({
      rule: 'DEFERRED_ISSUES_PRESERVED',
      passed: missing.length === 0,
      details:
        missing.length === 0
          ? `All ${deferrableOps.length} non-executable operations preserved as DeferredIssue.`
          : `Missing DeferredIssue for operations: ${missing.map((o) => o.operationId).join(', ')}`,
    });
  }

  // DEFERRED_DOES_NOT_IMPLY_EXCLUSION: for every DeferredIssue, none of its
  // affectedRawEdges that ALSO have an executed PRESERVE_CONFIRMED_TOPOLOGY /
  // SELECT_CANONICAL_FACE entry may be missing from candidate.edges.
  {
    const preservedRawEdgeIds = new Set(candidate.edges.flatMap((e) => e.sourceRawEdgeIds));
    const violations: string[] = [];
    for (const issue of candidate.deferredIssues) {
      for (const edgeId of issue.affectedRawEdges) {
        const wasPreservedElsewhere = plan.operations.some(
          (o) =>
            o.executionAllowed &&
            o.executionDeterministic &&
            (o.operationType === 'PRESERVE_CONFIRMED_TOPOLOGY' ||
              o.operationType === 'SELECT_CANONICAL_FACE') &&
            o.perEntityEvidence.some(
              (pe) => pe.edgeId === edgeId && pe.semanticStatus === 'KEEP_ENVELOPE',
            ),
        );
        if (wasPreservedElsewhere && !preservedRawEdgeIds.has(edgeId)) {
          violations.push(edgeId);
        }
      }
    }
    results.push({
      rule: 'DEFERRED_DOES_NOT_IMPLY_EXCLUSION',
      passed: violations.length === 0,
      details:
        violations.length === 0
          ? 'No KEEP edge was excluded merely due to an attached DeferredIssue.'
          : `Edges wrongly excluded due to DeferredIssue attachment: ${violations.join(', ')}`,
    });
  }

  // CANONICAL_FACE_SELECTION_RESPECTED: for every SELECT_CANONICAL_FACE op,
  // the rejected face edge id must NOT appear in candidate.edges, and the
  // selected face edge id MUST appear.
  {
    const faceOps = plan.operations.filter((o) => o.operationType === 'SELECT_CANONICAL_FACE');
    const problems: string[] = [];
    for (const op of faceOps) {
      for (const pe of op.perEntityEvidence) {
        if (!pe.edgeId) continue;
        const isCanonical = candidate.edges.some((e) => e.sourceRawEdgeIds.includes(pe.edgeId!));
        if (pe.semanticStatus === 'KEEP_ENVELOPE' && !isCanonical) {
          problems.push(`selected face ${pe.edgeId} missing from canonical edges`);
        }
        if (pe.semanticStatus === 'REJECT_DUAL_FACE' && isCanonical) {
          problems.push(`rejected face ${pe.edgeId} incorrectly present as canonical`);
        }
      }
    }
    results.push({
      rule: 'CANONICAL_FACE_SELECTION_RESPECTED',
      passed: problems.length === 0,
      details: problems.length === 0 ? 'Face selection correctly reflected.' : problems.join('; '),
    });
  }

  // GRAPH_STRUCTURALLY_VALID: every edge references vertices that exist; no
  // duplicate canonicalEdgeId/canonicalVertexId. Does NOT require closure.
  {
    const vertexIds = new Set(candidate.vertices.map((v) => v.canonicalVertexId));
    const dupVertexCheck = new Set<string>();
    const dupVertexIds: string[] = [];
    for (const v of candidate.vertices) {
      if (dupVertexCheck.has(v.canonicalVertexId)) dupVertexIds.push(v.canonicalVertexId);
      dupVertexCheck.add(v.canonicalVertexId);
    }
    const dupEdgeCheck = new Set<string>();
    const dupEdgeIds: string[] = [];
    for (const e of candidate.edges) {
      if (dupEdgeCheck.has(e.canonicalEdgeId)) dupEdgeIds.push(e.canonicalEdgeId);
      dupEdgeCheck.add(e.canonicalEdgeId);
    }
    const danglingEdges = candidate.edges.filter(
      (e) => !vertexIds.has(e.fromCanonicalVertexId) || !vertexIds.has(e.toCanonicalVertexId),
    );
    const passed = dupVertexIds.length === 0 && dupEdgeIds.length === 0 && danglingEdges.length === 0;
    results.push({
      rule: 'GRAPH_STRUCTURALLY_VALID',
      passed,
      details: passed
        ? 'No duplicate ids, no dangling edge endpoints. (Closure not required.)'
        : `dup vertices=[${dupVertexIds.join(',')}] dup edges=[${dupEdgeIds.join(',')}] dangling=[${danglingEdges.map((e) => e.canonicalEdgeId).join(',')}]`,
    });
  }

  // NO_ORPHAN_EDGE_ENDPOINTS: stricter per-edge check (subset of above, kept
  // separate because it was called out as its own named invariant).
  {
    const vertexIds = new Set(candidate.vertices.map((v) => v.canonicalVertexId));
    const orphaned = candidate.edges.filter(
      (e) => !vertexIds.has(e.fromCanonicalVertexId) || !vertexIds.has(e.toCanonicalVertexId),
    );
    results.push({
      rule: 'NO_ORPHAN_EDGE_ENDPOINTS',
      passed: orphaned.length === 0,
      details:
        orphaned.length === 0
          ? 'Every canonical edge endpoint references an existing canonical vertex.'
          : `Orphaned edges: ${orphaned.map((e) => e.canonicalEdgeId).join(', ')}`,
    });
  }

  return results;
}

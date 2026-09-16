import type {
  RawTopology,
  RawVertex,
  ApprovedPlan,
  PlanOperation,
  PerEntityEvidence,
} from './types/model.js';
import type {
  CanonicalVertex,
  CanonicalEdge,
  CanonicalGap,
  DeferredIssue,
  ConnectedComponent,
  CanonicalTopologyCandidate,
  StateFlags,
  CandidateState,
  CoordinateStatus,
  DeferredIssueType,
} from './types/canonical_topology_v1.js';
import { validateCandidate } from './validate.js';

/**
 * Deterministic construction: approved PLAN operations -> canonical entities.
 *
 * Hard rules enforced structurally by this function (not just checked after
 * the fact):
 *   - RAW is read-only: we only ever read from `raw`, never write to it.
 *   - Only operations with executionAllowed=TRUE AND executionDeterministic=TRUE
 *     may produce CanonicalVertex/CanonicalEdge/CanonicalGap entities.
 *   - DeferredIssue is the *only* thing produced for operations that don't meet
 *     that bar; it never removes or alters an already-constructed edge/vertex.
 *   - No proximity/coordinate-based decisions are made anywhere in this file.
 *   - This engine is fully generic: it has NO built-in knowledge of any
 *     specific vertex or edge id from any specific attempt/job. All
 *     semantic status, confidence, geometry alignment, and coordinate status
 *     values come exclusively from the PLAN's PerEntityEvidence. If a
 *     PLAN omits required evidence, construction fails explicitly rather
 *     than silently defaulting to a value that looks "safe".
 */
export function constructCanonicalTopology(
  raw: RawTopology,
  plan: ApprovedPlan,
  candidateId: string,
): CanonicalTopologyCandidate {
  const rawVertexById = new Map<string, RawVertex>(raw.vertices.map((v) => [v.id, v]));

  const canonicalVertices = new Map<string, CanonicalVertex>();
  const canonicalEdges: CanonicalEdge[] = [];
  const gaps: CanonicalGap[] = [];
  const deferredIssues: DeferredIssue[] = [];

  // SINGLE_CANONICAL_EDGE_OWNER enforcement: track which operation first
  // claims each RAW edge as a canonical-edge source. If a second executable
  // operation tries to claim the same RAW edge, construction MUST fail loudly
  // -- never silently dedupe or skip. A duplicate owner is a PLAN
  // contradiction, not a runtime nuisance to paper over.
  const canonicalEdgeOwner = new Map<string, string>(); // rawEdgeId -> operationId

  function claimEdgeOwnership(rawEdgeId: string, operationId: string): void {
    const existingOwner = canonicalEdgeOwner.get(rawEdgeId);
    if (existingOwner && existingOwner !== operationId) {
      throw new Error(
        `SINGLE_CANONICAL_EDGE_OWNER violation: RAW edge "${rawEdgeId}" is claimed as a canonical-edge source by both "${existingOwner}" and "${operationId}". This is a PLAN contradiction and must be fixed in the PLAN, not silently deduplicated.`,
      );
    }
    canonicalEdgeOwner.set(rawEdgeId, operationId);
  }

  // A RAW vertex always maps 1:1 to a canonical vertex in this stage, since no
  // PLAN operation here performs a merge. The canonical id intentionally
  // mirrors the RAW id for traceability, but is a distinct namespace concept
  // (sourceRawVertexIds is the actual provenance link, not the id string).
  //
  // coordinateStatus always starts at RAW_OBSERVATION here -- a generic,
  // evidence-free default that makes no claim about alignment either way.
  // Any more specific status (MISALIGNED, UNRESOLVED, CONSTRAINT_SOLVED) must
  // come from applyVertexCoordinateStatusFromEvidence, driven entirely by
  // PLAN-supplied PerEntityEvidence, never by this function recognizing an id.
  function ensureCanonicalVertex(rawVertexId: string, evidenceRef: string): CanonicalVertex {
    const existing = canonicalVertices.get(rawVertexId);
    if (existing) return existing;

    const rv = rawVertexById.get(rawVertexId);
    if (!rv) {
      throw new Error(
        `Construction invariant violation: PLAN references RAW vertex "${rawVertexId}" which does not exist in RAW topology.`,
      );
    }

    const coordinateStatus: CoordinateStatus = 'RAW_OBSERVATION';

    const cv: CanonicalVertex = {
      canonicalVertexId: rv.id,
      sourceRawVertexIds: [rv.id],
      coordinate: { x: rv.xPct, y: rv.yPct },
      coordinateStatus,
      coordinateEvidenceRef: evidenceRef,
      provenanceNote: `Derived 1:1 from RAW vertex ${rv.id}. No merge/snap has been approved for this vertex.`,
    };
    canonicalVertices.set(rawVertexId, cv);
    return cv;
  }

  // Generic evidence-driven coordinate status patch. Reads ONLY what the
  // PerEntityEvidence supplies for the named vertexId -- no id is special
  // cased. If the PLAN's evidence entries never mention a vertex's
  // coordinateStatus, that vertex simply keeps RAW_OBSERVATION.
  function applyVertexCoordinateStatusFromEvidence(
    rawVertexId: string,
    perEntity: PerEntityEvidence,
  ): void {
    if (!perEntity.coordinateStatus) return;
    if (perEntity.vertexId !== rawVertexId) return;
    const existing = canonicalVertices.get(rawVertexId);
    if (!existing) return;
    canonicalVertices.set(rawVertexId, {
      ...existing,
      coordinateStatus: perEntity.coordinateStatus,
      coordinateEvidenceRef: perEntity.evidenceRef,
    });
  }

  function isExecutable(op: PlanOperation): boolean {
    return op.executionAllowed === true && op.executionDeterministic === true;
  }

  // Every executable edge-producing operation MUST supply a
  // semanticVerificationScope explicitly, either at the operation level or
  // per-entity. There is no default. FULL_SPAN is never inferred silently --
  // omitting it is a PLAN authoring error and construction must fail loudly
  // so the gap in the PLAN is visible, not papered over.
  function resolveRequiredVerificationScope(
    op: PlanOperation,
    edgeId: string,
  ): NonNullable<PlanOperation['semanticVerificationScope']> {
    if (op.semanticVerificationScope) return op.semanticVerificationScope;
    throw new Error(
      `MISSING_SEMANTIC_VERIFICATION_SCOPE: operation "${op.operationId}" produces canonical edge "${edgeId}" but supplies no semanticVerificationScope. This must be explicit in the PLAN (FULL_SPAN, VISIBLE_SPAN, or LOCAL_ADJACENCY_CONFIRMED) -- it is never inferred or defaulted.`,
    );
  }

  for (const op of plan.operations) {
    if (!isExecutable(op)) {
      // Not executable here => becomes a DeferredIssue only. It must never
      // delete, exclude, or otherwise touch any CanonicalEdge/Vertex that a
      // *different*, executable operation has legitimately constructed.
      // (DEFERRED_DOES_NOT_IMPLY_EXCLUSION)
      if (
        op.operationType === 'TOPOLOGY_REPAIR_REQUIRED' ||
        op.operationType === 'GEOMETRY_REALIGNMENT_REQUIRED' ||
        op.operationType === 'MISSING_BOUNDARY_CANDIDATE'
      ) {
        const issueType: DeferredIssueType =
          op.operationType === 'MISSING_BOUNDARY_CANDIDATE'
            ? 'UNCONFIRMED_BOUNDARY_CANDIDATE'
            : op.operationType;
        deferredIssues.push({
          issueId: `deferred-${op.operationId}`,
          relatedOperationId: op.operationId,
          issueType,
          affectedRawVertices: op.affectedRawVertices,
          affectedRawEdges: op.affectedRawEdges,
          evidenceRefs: op.evidenceRefs,
          resolutionConfidence: 'NONE',
          deferTo: op.deferTo ?? 'UNSPECIFIED',
          provenanceNote: op.provenanceNote,
        });
      }
      continue;
    }

    switch (op.operationType) {
      case 'PRESERVE_CONFIRMED_TOPOLOGY': {
        for (const edgeId of op.affectedRawEdges) {
          const rawEdge = raw.edges.find((e) => e.id === edgeId);
          if (!rawEdge) {
            throw new Error(
              `Construction invariant violation: op ${op.operationId} references RAW edge "${edgeId}" not present in RAW topology.`,
            );
          }
          const perEntity = op.perEntityEvidence.find((pe) => pe.edgeId === edgeId);
          if (!perEntity) {
            throw new Error(
              `PROVENANCE_COMPLETE violation: op ${op.operationId} affects edge ${edgeId} but has no perEntityEvidence for it.`,
            );
          }

          claimEdgeOwnership(edgeId, op.operationId);

          const fromV = ensureCanonicalVertex(rawEdge.fromVertexId, perEntity.evidenceRef);
          const toV = ensureCanonicalVertex(rawEdge.toVertexId, perEntity.evidenceRef);

          // Apply any generic per-entity coordinate evidence for this edge's
          // own endpoints, if the PLAN supplied it under this same edge's
          // perEntityEvidence list (vertex-scoped entries may also appear
          // there -- see fixture for the shape).
          for (const pe of op.perEntityEvidence) {
            if (pe.vertexId === rawEdge.fromVertexId || pe.vertexId === rawEdge.toVertexId) {
              applyVertexCoordinateStatusFromEvidence(pe.vertexId, pe);
            }
          }

          const scope = resolveRequiredVerificationScope(op, edgeId);

          canonicalEdges.push({
            canonicalEdgeId: `canon-${edgeId}`,
            sourceRawEdgeIds: [edgeId],
            fromCanonicalVertexId: fromV.canonicalVertexId,
            toCanonicalVertexId: toV.canonicalVertexId,
            originatingOperationId: op.operationId,
            semanticStatus: 'KEEP_ENVELOPE',
            semanticConfidence: perEntity.semanticConfidence ?? op.confidence,
            semanticVerificationScope: scope,
            geometryVerificationStatus: perEntity.geometryAlignmentStatus ?? 'NOT_AUDITED',
            unverifiedPortion: null,
            provenanceNote: `Preserved via ${op.operationId} (${op.operationType}). Semantic evidence: ${perEntity.evidenceRef}.`,
          });
        }
        break;
      }

      case 'SELECT_CANONICAL_FACE': {
        // Only the *selected* edge(s) become canonical. Rejected face(s) in
        // the same operation are intentionally NOT constructed here -- they
        // are excluded by this very selection, not merely "not yet decided".
        for (const perEntity of op.perEntityEvidence) {
          if (perEntity.edgeId && perEntity.semanticStatus === 'KEEP_ENVELOPE') {
            const rawEdge = raw.edges.find((e) => e.id === perEntity.edgeId);
            if (!rawEdge) {
              throw new Error(
                `Construction invariant violation: op ${op.operationId} references RAW edge "${perEntity.edgeId}" not present in RAW topology.`,
              );
            }
            claimEdgeOwnership(perEntity.edgeId, op.operationId);

            const fromV = ensureCanonicalVertex(rawEdge.fromVertexId, perEntity.evidenceRef);
            const toV = ensureCanonicalVertex(rawEdge.toVertexId, perEntity.evidenceRef);

            const scope = resolveRequiredVerificationScope(op, perEntity.edgeId);
            const unverified =
              scope !== 'FULL_SPAN' && op.southEndpointVerification === 'OCCLUDED'
                ? 'South endpoint occluded by legend (see corresponding SOURCE_OCCLUDED_GAP).'
                : null;

            canonicalEdges.push({
              canonicalEdgeId: `canon-${perEntity.edgeId}`,
              sourceRawEdgeIds: [perEntity.edgeId],
              fromCanonicalVertexId: fromV.canonicalVertexId,
              toCanonicalVertexId: toV.canonicalVertexId,
              originatingOperationId: op.operationId,
              semanticStatus: 'KEEP_ENVELOPE',
              semanticConfidence: perEntity.semanticConfidence ?? op.confidence,
              semanticVerificationScope: scope,
              geometryVerificationStatus: perEntity.geometryAlignmentStatus ?? 'NOT_AUDITED',
              unverifiedPortion: unverified,
              provenanceNote: `Selected as canonical inner face via ${op.operationId}. Rejected face(s) in same operation intentionally excluded, not constructed.`,
            });
          }
          // perEntity with semanticStatus REJECT_DUAL_FACE (e.g. e23):
          // deliberately no CanonicalEdge is created. This is the exclusion
          // mechanism for the rejected face -- not an oversight.
        }
        break;
      }

      case 'DROP_REJECTED_EDGE': {
        // Deliberately produces no canonical entity. Recorded only implicitly
        // by its absence; NO_REJECTED_EDGE_ACTIVE validates this after the fact.
        break;
      }

      case 'OPENING_GAP': {
        const knownEndpoints: string[] = [];
        for (const v of op.affectedRawVertices) {
          const cv = ensureCanonicalVertex(v, op.evidenceRefs[0] ?? op.operationId);
          knownEndpoints.push(cv.canonicalVertexId);
        }
        gaps.push({
          gapId: `gap-${op.operationId}`,
          gapType: op.gapType ?? 'OPENING_CONTINUATION_UNKNOWN',
          knownEndpointVertexIds: knownEndpoints,
          unknownEndpointCount: Math.max(0, 2 - knownEndpoints.length),
          reason: op.provenanceNote,
          evidenceRefs: op.evidenceRefs,
          resolutionStatus: 'UNRESOLVED',
          deferTo: op.deferTo ?? 'ADDITIONAL_PERCEPTION',
          originatingOperationId: op.operationId,
        });
        break;
      }

      case 'SOURCE_OCCLUDED_GAP': {
        const knownEndpoints: string[] = [];
        for (const v of op.affectedRawVertices) {
          const cv = ensureCanonicalVertex(v, op.evidenceRefs[0] ?? op.operationId);
          knownEndpoints.push(cv.canonicalVertexId);
        }
        gaps.push({
          gapId: `gap-${op.operationId}`,
          gapType: 'SOURCE_OCCLUDED',
          knownEndpointVertexIds: knownEndpoints,
          unknownEndpointCount: Math.max(0, 2 - knownEndpoints.length),
          reason: op.provenanceNote,
          evidenceRefs: op.evidenceRefs,
          resolutionStatus: 'UNRESOLVED',
          deferTo: op.deferTo ?? 'CLEAN_SOURCE_IMAGE',
          originatingOperationId: op.operationId,
        });
        break;
      }

      case 'TOPOLOGY_REPAIR_REQUIRED':
      case 'GEOMETRY_REALIGNMENT_REQUIRED':
      case 'MISSING_BOUNDARY_CANDIDATE':
      case 'UNSUPPORTED_GAP':
        // These should never be executionAllowed=TRUE in the current plan.
        // If they were, that is itself a deviation to surface, not silently
        // handle as a gap or edge.
        throw new Error(
          `Unexpected executable operation of type ${op.operationType} (${op.operationId}). This type is expected to be non-executable in the current PLAN and should route through the DeferredIssue path.`,
        );

      default: {
        const _exhaustive: never = op.operationType;
        throw new Error(`Unhandled operation type: ${_exhaustive}`);
      }
    }
  }

  const connectedComponents = computeConnectedComponents(canonicalVertices, canonicalEdges);

  const stateFlags: StateFlags = {
    hasExplicitGaps: gaps.length > 0,
    hasDeferredRepairs: deferredIssues.length > 0,
    hasUnverifiedPartialEdges: canonicalEdges.some((e) => e.unverifiedPortion !== null),
    isFullyClosed:
      gaps.length === 0 &&
      deferredIssues.length === 0 &&
      connectedComponents.length === 1 &&
      isSingleClosedCycle(connectedComponents[0], canonicalEdges),
  };

  const candidateState: CandidateState = deriveCandidateState(stateFlags);

  const candidate: CanonicalTopologyCandidate = {
    candidateId,
    vertices: [...canonicalVertices.values()],
    edges: canonicalEdges,
    gaps,
    deferredIssues,
    connectedComponents,
    validationResults: [], // filled below
    stateFlags,
    candidateState,
  };

  const validationResults = validateCandidate(raw, plan, candidate);
  return { ...candidate, validationResults };
}

function computeConnectedComponents(
  vertices: Map<string, CanonicalVertex>,
  edges: readonly CanonicalEdge[],
): ConnectedComponent[] {
  // Only vertices that participate in at least one canonical edge are
  // considered for connectivity. A vertex that exists solely because a gap
  // operation (e.g. SOURCE_OCCLUDED_GAP) needed to reference it as a known
  // endpoint is not, by itself, a "connected component" -- it is a
  // gap-anchor, not a topological region. Excluding such vertices here keeps
  // connectedComponents answering the specific question it exists to answer:
  // which parts of the graph are linked by canonical edges. Gap-anchor
  // vertices remain fully visible via candidate.vertices and via the gap's
  // own knownEndpointVertexIds -- they are not hidden, just not miscounted
  // as an isolated region.
  const verticesWithEdges = new Set<string>();
  for (const e of edges) {
    verticesWithEdges.add(e.fromCanonicalVertexId);
    verticesWithEdges.add(e.toCanonicalVertexId);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const v of vertices.values()) {
    if (verticesWithEdges.has(v.canonicalVertexId)) {
      adjacency.set(v.canonicalVertexId, new Set());
    }
  }
  for (const e of edges) {
    adjacency.get(e.fromCanonicalVertexId)?.add(e.toCanonicalVertexId);
    adjacency.get(e.toCanonicalVertexId)?.add(e.fromCanonicalVertexId);
  }

  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];
  let componentIndex = 0;

  for (const vertexId of adjacency.keys()) {
    if (visited.has(vertexId)) continue;
    const stack = [vertexId];
    const componentVertexIds: string[] = [];
    visited.add(vertexId);
    while (stack.length > 0) {
      const current = stack.pop()!;
      componentVertexIds.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    const componentVertexSet = new Set(componentVertexIds);
    const componentEdgeIds = edges
      .filter(
        (e) =>
          componentVertexSet.has(e.fromCanonicalVertexId) &&
          componentVertexSet.has(e.toCanonicalVertexId),
      )
      .map((e) => e.canonicalEdgeId);

    components.push({
      componentId: `component-${componentIndex++}`,
      vertexIds: componentVertexIds,
      edgeIds: componentEdgeIds,
    });
  }

  return components;
}

function isSingleClosedCycle(
  component: ConnectedComponent | undefined,
  edges: readonly CanonicalEdge[],
): boolean {
  if (!component) return false;
  const degree = new Map<string, number>();
  for (const v of component.vertexIds) degree.set(v, 0);
  for (const e of edges) {
    if (!component.edgeIds.includes(e.canonicalEdgeId)) continue;
    degree.set(e.fromCanonicalVertexId, (degree.get(e.fromCanonicalVertexId) ?? 0) + 1);
    degree.set(e.toCanonicalVertexId, (degree.get(e.toCanonicalVertexId) ?? 0) + 1);
  }
  return [...degree.values()].every((d) => d === 2) && component.edgeIds.length === component.vertexIds.length;
}

function deriveCandidateState(flags: StateFlags): CandidateState {
  if (flags.isFullyClosed && !flags.hasDeferredRepairs && !flags.hasUnverifiedPartialEdges) {
    return 'CLOSED_CONFIRMED';
  }
  if (flags.hasExplicitGaps) return 'OPEN_WITH_GAPS';
  if (flags.hasDeferredRepairs) return 'OPEN_WITH_DEFERRED_REPAIR';
  return 'INVALID';
}

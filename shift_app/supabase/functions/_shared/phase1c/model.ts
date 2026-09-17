// =====================================================================
// Phase 1C-B — Canonical Topology Construction: Type Model
//
// Layer separation (enforced by construction, not just convention):
//   RAW               — immutable AI perception output (never mutated)
//   AUDITED           — immutable 1B semantic/geometry findings (never mutated)
//   PLAN              — immutable, approved 1C-A operations (never mutated)
//   CANONICAL_CANDIDATE — new artifact built from PLAN + AUDITED references
//
// Session 25/26 (CANONICAL CONTRACT IMPLEMENTATION) note: this file used to
// also define the CANONICAL_CANDIDATE layer itself (CanonicalVertex,
// CanonicalEdge, CanonicalGap, DeferredIssue, ConnectedComponent,
// CanonicalTopologyCandidate, StateFlags, CandidateState, and the shared enum
// types that layer depends on: CoordinateStatus, SemanticVerificationScope,
// CanonicalGapType, DeferredIssueType). That layer is now the single
// source-of-truth contract at
// ../../../../supabase/functions/_shared/canonical_topology_v1.ts (imported
// below through the ./canonical_topology_v1.js symlink — Phase 2-B Part A
// and Part B import the very same physical file). This file keeps ONLY the
// RAW/AUDITED/PLAN layers, which are internal to Phase 1C-B and never shared
// with a consumer. This is a mechanical refactor only: no field was renamed,
// no enum value changed, and constructCanonicalTopology's behavior is
// unchanged (see construct.ts/validate.ts — only their import statements
// were split, the algorithm bodies are byte-for-byte identical to the
// verified phase1c-b-complete.zip source).
// =====================================================================

import type {
  SemanticConfidence,
  GeometryAlignmentStatus,
  CoordinateStatus,
  SemanticVerificationScope,
  CanonicalGapType,
} from '../canonical_topology_v1.ts';

// --- RAW layer (read-only source; mirrors the Attempt #3 artifact shape) ---

export interface RawVertex {
  readonly id: string;
  readonly xPct: number;
  readonly yPct: number;
}

export interface RawEdge {
  readonly id: string;
  readonly fromVertexId: string;
  readonly toVertexId: string;
  readonly axisHint?: 'horizontal' | 'vertical';
}

export interface RawTopology {
  readonly vertices: readonly RawVertex[];
  readonly edges: readonly RawEdge[];
}

// --- AUDITED layer (1B semantic + geometry findings, immutable) ---

export type SemanticStatus =
  | 'KEEP_ENVELOPE'
  | 'REJECT_NOT_ENVELOPE'
  | 'REJECT_DUAL_FACE'
  | 'SPLIT_REQUIRED'
  | 'UNRESOLVED';

export interface EdgeAuditRecord {
  readonly edgeId: string;
  readonly semanticStatus: SemanticStatus;
  readonly semanticConfidence: SemanticConfidence | null;
  readonly geometryAlignmentStatus: GeometryAlignmentStatus;
  readonly alignmentPattern?: string;
  readonly reason: string;
  readonly unresolvedReason?: string;
}

export interface AuditedSnapshot {
  readonly edgeAudits: ReadonlyMap<string, EdgeAuditRecord>;
}

// --- PLAN layer (1C-A approved operations, immutable input to 1C-B) ---

export type OperationType =
  | 'PRESERVE_CONFIRMED_TOPOLOGY'
  | 'TOPOLOGY_REPAIR_REQUIRED'
  | 'DROP_REJECTED_EDGE'
  | 'SELECT_CANONICAL_FACE'
  | 'MISSING_BOUNDARY_CANDIDATE'
  | 'GEOMETRY_REALIGNMENT_REQUIRED'
  | 'OPENING_GAP'
  | 'SOURCE_OCCLUDED_GAP'
  | 'UNSUPPORTED_GAP';

export interface PerEntityEvidence {
  readonly edgeId?: string;
  readonly vertexId?: string;
  readonly semanticStatus?: SemanticStatus;
  readonly semanticConfidence?: SemanticConfidence;
  readonly evidenceRef: string;
  // Optional geometry findings, generic to any entity. When present, the
  // construction engine applies these verbatim -- it never infers or
  // hardcodes geometry status for any specific vertex/edge id. Absence means
  // "no geometry finding was supplied", not "assume aligned".
  readonly geometryAlignmentStatus?: GeometryAlignmentStatus;
  readonly coordinateStatus?: CoordinateStatus;
}

export interface PlanOperation {
  readonly operationId: string;
  readonly operationType: OperationType;
  readonly affectedRawVertices: readonly string[];
  readonly affectedRawEdges: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly perEntityEvidence: readonly PerEntityEvidence[];
  readonly confidence: SemanticConfidence;
  readonly confidenceAggregation?: 'MIN_PER_ENTITY';
  readonly resolutionConfidence: SemanticConfidence | 'NONE';
  readonly planningDecisionDeterministic: boolean;
  readonly executionDeterministic: boolean;
  readonly requiresAdditionalEvidence: boolean;
  readonly executionAllowed: boolean;
  readonly deferTo: string | null;
  readonly semanticVerificationScope?: SemanticVerificationScope;
  readonly provenanceNote: string;
  // op-03 specific
  readonly southEndpointVerification?: 'OCCLUDED' | 'VERIFIED';
  // op-06 specific
  readonly gapType?: CanonicalGapType;
  // op-05/op-08/op-02 specific
  readonly topologyMutationRequired?: 'UNKNOWN' | 'TRUE' | 'FALSE';
  readonly coordinateCorrectionRequired?: boolean;
  readonly exactCorrection?: 'UNRESOLVED';
  readonly repairForm?: 'UNRESOLVED';
  readonly candidateStatus?: 'UNCONFIRMED';
}

export interface ApprovedPlan {
  readonly operations: readonly PlanOperation[];
}

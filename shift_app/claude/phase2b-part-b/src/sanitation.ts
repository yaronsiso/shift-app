// Phase 2-B Part B — deterministic post-output sanitation.
//
// This is the ONLY processing applied to the AI's raw output in Part B.
// Explicitly, by scope: no selectedAnchor resolution, no proof validation,
// no binding derivation, no promotion. Those remain Part A's job, invoked
// later (Part C, not built here) against SANITIZED WitnessPerceptionCandidate
// output — this file only decides whether the AI's response is
// structurally usable at all.

import {
  CanonicalTopologyCandidate,
  canonicalVertexExists,
  canonicalEdgeExists,
} from "./types/canonical_topology_v1";
import {
  WitnessPerceptionCandidate,
  WitnessPerceptionResponse,
  EndpointPerceptionProposal,
  TopologyAnchor,
} from "./types/witness-perception";

export type SanitationIssueCode =
  | "UNKNOWN_MEASUREMENT_ID"
  | "DUPLICATE_MEASUREMENT_ID"
  | "CANONICAL_VERTEX_NOT_FOUND"
  | "CANONICAL_EDGE_NOT_FOUND"
  | "PARAM_T_OUT_OF_RANGE"
  | "SUGGESTED_ANCHOR_NOT_IN_CANDIDATES"
  | "MALFORMED_ANCHOR_SHAPE";

export interface SanitationIssue {
  readonly code: SanitationIssueCode;
  readonly measurementId: string;
  readonly detail: string;
}

export interface SanitationResult {
  // Only candidates that passed every check. A candidate with ANY issue on
  // either endpoint is dropped entirely (not partially kept) — a partially
  // sanitized candidate is worse than no candidate, since it would silently
  // misrepresent what the AI actually proposed.
  readonly acceptedCandidates: readonly WitnessPerceptionCandidate[];
  readonly rejectedCandidates: ReadonlyArray<{
    readonly candidate: WitnessPerceptionCandidate;
    readonly issues: readonly SanitationIssue[];
  }>;
  readonly allIssues: readonly SanitationIssue[];
}

// A structurally valid measurementId set to check candidates against. In
// the real pipeline this would be every id in the PageDimensions
// measurements array for this job; here it's passed in explicitly so this
// function stays a pure, fixture-testable unit.
export type KnownMeasurementIds = ReadonlySet<string>;

function anchorShapeIsWellFormed(anchor: TopologyAnchor): boolean {
  if (anchor.kind === "VERTEX") {
    return typeof anchor.canonicalVertexId === "string" && anchor.canonicalVertexId.length > 0;
  }
  if (anchor.kind === "EDGE_POINT") {
    return (
      typeof anchor.canonicalEdgeId === "string" &&
      anchor.canonicalEdgeId.length > 0 &&
      typeof anchor.paramT === "number" &&
      Number.isFinite(anchor.paramT)
    );
  }
  return false;
}

function validateAnchorAgainstCanonicalTopology(
  candidate: CanonicalTopologyCandidate,
  anchor: TopologyAnchor,
  measurementId: string
): SanitationIssue[] {
  const issues: SanitationIssue[] = [];

  if (!anchorShapeIsWellFormed(anchor)) {
    issues.push({
      code: "MALFORMED_ANCHOR_SHAPE",
      measurementId,
      detail: `Anchor kind=${anchor.kind} is not well-formed (missing/invalid required field for its kind).`,
    });
    return issues; // no point checking existence of a malformed anchor
  }

  if (anchor.kind === "VERTEX") {
    if (!canonicalVertexExists(candidate, anchor.canonicalVertexId)) {
      issues.push({
        code: "CANONICAL_VERTEX_NOT_FOUND",
        measurementId,
        detail: `Proposed VERTEX anchor "${anchor.canonicalVertexId}" does not exist in CanonicalTopologyCandidate (RAW_EXISTENCE_DOES_NOT_IMPLY_CANONICAL_EXISTENCE — a plausible-looking id is not sufficient).`,
      });
    }
    return issues;
  }

  // EDGE_POINT
  if (!canonicalEdgeExists(candidate, anchor.canonicalEdgeId)) {
    issues.push({
      code: "CANONICAL_EDGE_NOT_FOUND",
      measurementId,
      detail: `Proposed EDGE_POINT anchor references edge "${anchor.canonicalEdgeId}" which does not exist in CanonicalTopologyCandidate.`,
    });
  }
  if (anchor.paramT < 0 || anchor.paramT > 1) {
    issues.push({
      code: "PARAM_T_OUT_OF_RANGE",
      measurementId,
      detail: `paramT=${anchor.paramT} is outside the required [0,1] range for edge "${anchor.canonicalEdgeId}".`,
    });
  }
  return issues;
}

function anchorsEqual(a: TopologyAnchor, b: TopologyAnchor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "VERTEX" && b.kind === "VERTEX") {
    return a.canonicalVertexId === b.canonicalVertexId;
  }
  if (a.kind === "EDGE_POINT" && b.kind === "EDGE_POINT") {
    return a.canonicalEdgeId === b.canonicalEdgeId && a.paramT === b.paramT;
  }
  return false;
}

function sanitizeEndpointProposal(
  candidate: CanonicalTopologyCandidate,
  proposal: EndpointPerceptionProposal,
  measurementId: string
): SanitationIssue[] {
  const issues: SanitationIssue[] = [];

  for (const anchor of proposal.candidateAnchors) {
    issues.push(...validateAnchorAgainstCanonicalTopology(candidate, anchor, measurementId));
  }

  if (proposal.suggestedAnchor !== null) {
    // suggestedAnchor must itself be structurally/existentially valid...
    issues.push(
      ...validateAnchorAgainstCanonicalTopology(candidate, proposal.suggestedAnchor, measurementId)
    );
    // ...AND must be one of the proposed candidateAnchors (never a
    // surprise anchor introduced only as the "suggestion").
    const isAmongCandidates = proposal.candidateAnchors.some((a) =>
      anchorsEqual(a, proposal.suggestedAnchor!)
    );
    if (!isAmongCandidates) {
      issues.push({
        code: "SUGGESTED_ANCHOR_NOT_IN_CANDIDATES",
        measurementId,
        detail: "suggestedAnchor is not present in this endpoint's own candidateAnchors list.",
      });
    }
  }

  return issues;
}

/**
 * Deterministic sanitation only: schema validity is assumed already
 * enforced by strict:true JSON Schema at the API layer (this function
 * receives already-parsed, schema-conformant objects) — what remains here
 * is everything the JSON Schema itself cannot express: canonical entity
 * existence, paramT numeric range, measurementId correctness,
 * suggestedAnchor-must-be-a-candidate, and basic duplicate detection.
 *
 * Explicitly NOT done here: no proof validation, no selectedAnchor
 * resolution, no bindingStatus/bindingConfidence derivation, no promotion.
 */
export function sanitizeWitnessPerceptionResponse(
  response: WitnessPerceptionResponse,
  canonicalTopology: CanonicalTopologyCandidate,
  knownMeasurementIds: KnownMeasurementIds
): SanitationResult {
  const accepted: WitnessPerceptionCandidate[] = [];
  const rejected: Array<{ candidate: WitnessPerceptionCandidate; issues: SanitationIssue[] }> = [];
  const allIssues: SanitationIssue[] = [];
  const seenMeasurementIds = new Set<string>();

  for (const candidate of response.candidates) {
    const issues: SanitationIssue[] = [];

    if (!knownMeasurementIds.has(candidate.measurementId)) {
      issues.push({
        code: "UNKNOWN_MEASUREMENT_ID",
        measurementId: candidate.measurementId,
        detail: `measurementId "${candidate.measurementId}" does not correspond to any known MeasurementEvidence for this job.`,
      });
    }

    if (seenMeasurementIds.has(candidate.measurementId)) {
      issues.push({
        code: "DUPLICATE_MEASUREMENT_ID",
        measurementId: candidate.measurementId,
        detail: `measurementId "${candidate.measurementId}" appears more than once in the response.`,
      });
    }
    seenMeasurementIds.add(candidate.measurementId);

    issues.push(
      ...sanitizeEndpointProposal(canonicalTopology, candidate.startEndpointProposal, candidate.measurementId)
    );
    issues.push(
      ...sanitizeEndpointProposal(canonicalTopology, candidate.endEndpointProposal, candidate.measurementId)
    );

    allIssues.push(...issues);

    if (issues.length === 0) {
      accepted.push(candidate);
    } else {
      rejected.push({ candidate, issues });
    }
  }

  return { acceptedCandidates: accepted, rejectedCandidates: rejected, allIssues };
}

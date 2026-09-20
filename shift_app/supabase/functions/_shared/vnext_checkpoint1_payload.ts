// supabase/functions/_shared/vnext_checkpoint1_payload.ts
//
// Pure assembly of the exact JSON shape persisted for SHIFT VNext
// Checkpoint 1 (stage="vnext_checkpoint1"). Extracted so the payload
// SHAPE itself is independently testable (per spec: "persistence payload
// shape" is an explicit required test category) without touching
// Supabase — the Edge Function only calls this function and inserts its
// return value verbatim.

import type { GeometryObservationVNext } from "./geometry_observation_schema_vnext.ts";
import type { ValidationResultGeometryVNext } from "./geometry_observation_validators_vnext.ts";
import type { EvidenceObservationVNext } from "./evidence_observation_schema_vnext.ts";
import type { ValidationResultEvidenceVNext } from "./evidence_observation_validators_vnext.ts";
import type { SafeErrorVNext } from "./vnext_safe_errors.ts";

export type GeometryOutcomeVNext =
  | { status: "valid"; observation: GeometryObservationVNext; validation: ValidationResultGeometryVNext }
  | { status: "invalid"; observation: null; validation: ValidationResultGeometryVNext }
  | { status: "forbidden_field_error"; observation: null; validation: null; error: SafeErrorVNext }
  | { status: "structural_validation_error"; observation: null; validation: null; error: SafeErrorVNext }
  | { status: "call_failed"; observation: null; validation: null; error: SafeErrorVNext };

export type EvidenceOutcomeVNext =
  | { status: "valid"; observation: EvidenceObservationVNext; validation: ValidationResultEvidenceVNext }
  | { status: "invalid"; observation: null; validation: ValidationResultEvidenceVNext }
  | { status: "forbidden_field_error"; observation: null; validation: null; error: SafeErrorVNext }
  | { status: "structural_validation_error"; observation: null; validation: null; error: SafeErrorVNext }
  | { status: "call_failed"; observation: null; validation: null; error: SafeErrorVNext };

export interface VnextCheckpoint1Payload {
  schemaVersions: {
    geometry: "geometry_observation_vnext_v1";
    evidence: "evidence_observation_vnext_v1";
  };
  model: string;
  attempt: number;
  geometry: GeometryOutcomeVNext;
  evidence: EvidenceOutcomeVNext;
  timings: {
    geometryDurationMs: number;
    evidenceDurationMs: number;
    totalWallClockMs: number;
  };
  usage: {
    geometry: Record<string, unknown> | null;
    evidence: Record<string, unknown> | null;
  };
}

export function buildVnextCheckpoint1Payload(params: {
  model: string;
  attempt: number;
  geometry: GeometryOutcomeVNext;
  evidence: EvidenceOutcomeVNext;
  geometryDurationMs: number;
  evidenceDurationMs: number;
  totalWallClockMs: number;
  geometryUsage: Record<string, unknown> | null;
  evidenceUsage: Record<string, unknown> | null;
}): VnextCheckpoint1Payload {
  return {
    schemaVersions: {
      geometry: "geometry_observation_vnext_v1",
      evidence: "evidence_observation_vnext_v1",
    },
    model: params.model,
    attempt: params.attempt,
    geometry: params.geometry,
    evidence: params.evidence,
    timings: {
      geometryDurationMs: params.geometryDurationMs,
      evidenceDurationMs: params.evidenceDurationMs,
      totalWallClockMs: params.totalWallClockMs,
    },
    usage: {
      geometry: params.geometryUsage,
      evidence: params.evidenceUsage,
    },
  };
}
export interface VnextCheckpoint1Response extends VnextCheckpoint1Payload {
  jobId: string;
  artifactId: string;
}

export function buildVnextCheckpoint1Response(
  jobId: string,
  artifactId: string,
  payload: VnextCheckpoint1Payload,
): VnextCheckpoint1Response {
  return {
    jobId,
    artifactId,
    ...payload,
  };
}

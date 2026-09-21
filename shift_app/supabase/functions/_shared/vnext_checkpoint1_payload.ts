// supabase/functions/_shared/vnext_checkpoint1_payload.ts
//
// Pure assembly of the exact JSON shape persisted for SHIFT VNext
// Checkpoint 1 (stage="vnext_checkpoint1"). Extracted so the payload
// SHAPE itself is independently testable (per spec: "persistence payload
// shape" is an explicit required test category) without touching
// Supabase. The Edge Function builds an input without `attempt`; migration
// 0008 assigns `version` and the matching payload `attempt` atomically. The
// finalizer below reconstructs the response-safe payload from that DB version.

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

export type VnextCheckpoint1PayloadInput = Omit<VnextCheckpoint1Payload, "attempt">;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

interface VnextCheckpoint1PayloadInputParams {
  model: string;
  geometry: GeometryOutcomeVNext;
  evidence: EvidenceOutcomeVNext;
  geometryDurationMs: number;
  evidenceDurationMs: number;
  totalWallClockMs: number;
  geometryUsage: Record<string, unknown> | null;
  evidenceUsage: Record<string, unknown> | null;
}

export function buildVnextCheckpoint1PayloadInput(
  params: VnextCheckpoint1PayloadInputParams,
): VnextCheckpoint1PayloadInput {
  return {
    schemaVersions: {
      geometry: "geometry_observation_vnext_v1",
      evidence: "evidence_observation_vnext_v1",
    },
    model: params.model,
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

export function withVnextCheckpoint1Attempt(
  input: VnextCheckpoint1PayloadInput,
  attempt: number,
): VnextCheckpoint1Payload {
  return { ...input, attempt };
}

export function buildVnextCheckpoint1Payload(
  params: VnextCheckpoint1PayloadInputParams & { attempt: number },
): VnextCheckpoint1Payload {
  const { attempt, ...inputParams } = params;
  return withVnextCheckpoint1Attempt(
    buildVnextCheckpoint1PayloadInput(inputParams),
    attempt,
  );
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

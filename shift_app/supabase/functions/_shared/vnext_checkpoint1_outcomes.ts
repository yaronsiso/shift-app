import {
  GeometryObservationVNextForbiddenFieldError,
  parseGeometryObservationVNext,
  type GeometryObservationVNext,
} from "./geometry_observation_schema_vnext.ts";
import { validateGeometryObservationVNext } from "./geometry_observation_validators_vnext.ts";
import {
  EvidenceObservationVNextForbiddenFieldError,
  parseEvidenceObservationVNext,
  type EvidenceObservationVNext,
} from "./evidence_observation_schema_vnext.ts";
import { validateEvidenceObservationVNext } from "./evidence_observation_validators_vnext.ts";
import type { ObservationCallOutcome } from "./vnext_checkpoint1_orchestrator.ts";
import type {
  EvidenceOutcomeVNext,
  GeometryOutcomeVNext,
} from "./vnext_checkpoint1_payload.ts";
import { RuntimeSchemaValidationErrorVNext } from "./vnext_runtime_schema_validator.ts";
import { safeErrorVNext } from "./vnext_safe_errors.ts";

export interface ResolvedGeometryOutcomeVNext {
  payloadOutcome: GeometryOutcomeVNext;
  usage: Record<string, unknown> | null;
}

export interface ResolvedEvidenceOutcomeVNext {
  payloadOutcome: EvidenceOutcomeVNext;
  usage: Record<string, unknown> | null;
}

export function resolveGeometryOutcome(
  outcome: ObservationCallOutcome<GeometryObservationVNext>,
): ResolvedGeometryOutcomeVNext {
  if (!outcome.ok) {
    return {
      payloadOutcome: {
        status: "call_failed",
        observation: null,
        validation: null,
        error: outcome.detail,
      },
      usage: null,
    };
  }

  try {
    const observation = parseGeometryObservationVNext(outcome.parsed);
    const validation = validateGeometryObservationVNext(observation);
    return {
      payloadOutcome: validation.valid
        ? { status: "valid", observation, validation }
        : { status: "invalid", observation: null, validation },
      usage: outcome.usage,
    };
  } catch (error) {
    if (error instanceof GeometryObservationVNextForbiddenFieldError) {
      return {
        payloadOutcome: {
          status: "forbidden_field_error",
          observation: null,
          validation: null,
          error: safeErrorVNext({
            category: "forbidden_field",
            code: "GEOMETRY_FORBIDDEN_FIELD",
            stage: "geometry",
            message: "Geometry output contained a forbidden field",
            status: null,
            requestId: null,
          }),
        },
        usage: outcome.usage,
      };
    }
    if (error instanceof RuntimeSchemaValidationErrorVNext) {
      return {
        payloadOutcome: {
          status: "structural_validation_error",
          observation: null,
          validation: null,
          error: safeErrorVNext({
            category: "validation",
            code: error.issueCode,
            stage: "geometry",
            message: "Geometry output failed runtime schema validation",
            status: null,
            requestId: null,
          }),
        },
        usage: outcome.usage,
      };
    }
    throw error;
  }
}

export function resolveEvidenceOutcome(
  outcome: ObservationCallOutcome<EvidenceObservationVNext>,
): ResolvedEvidenceOutcomeVNext {
  if (!outcome.ok) {
    return {
      payloadOutcome: {
        status: "call_failed",
        observation: null,
        validation: null,
        error: outcome.detail,
      },
      usage: null,
    };
  }

  try {
    const observation = parseEvidenceObservationVNext(outcome.parsed);
    const validation = validateEvidenceObservationVNext(observation);
    return {
      payloadOutcome: validation.valid
        ? { status: "valid", observation, validation }
        : { status: "invalid", observation: null, validation },
      usage: outcome.usage,
    };
  } catch (error) {
    if (error instanceof EvidenceObservationVNextForbiddenFieldError) {
      return {
        payloadOutcome: {
          status: "forbidden_field_error",
          observation: null,
          validation: null,
          error: safeErrorVNext({
            category: "forbidden_field",
            code: "EVIDENCE_FORBIDDEN_FIELD",
            stage: "evidence",
            message: "Evidence output contained a forbidden field",
            status: null,
            requestId: null,
          }),
        },
        usage: outcome.usage,
      };
    }
    if (error instanceof RuntimeSchemaValidationErrorVNext) {
      return {
        payloadOutcome: {
          status: "structural_validation_error",
          observation: null,
          validation: null,
          error: safeErrorVNext({
            category: "validation",
            code: error.issueCode,
            stage: "evidence",
            message: "Evidence output failed runtime schema validation",
            status: null,
            requestId: null,
          }),
        },
        usage: outcome.usage,
      };
    }
    throw error;
  }
}

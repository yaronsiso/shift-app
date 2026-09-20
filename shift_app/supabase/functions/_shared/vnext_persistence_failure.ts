// Safe, allowlisted representation of an analysis_artifacts insert failure.
//
// Deliberately does not accept the database error object. This makes it
// impossible for a provider message/code/details/hint (or a custom
// serializer on the raw object) to cross into either the HTTP response or
// the structured log fields through this helper.

export interface VnextPersistenceFailure {
  responseBody: {
    error: "internal_error";
    detail: "failed to persist checkpoint artifact";
    jobId: string;
    incidentId: string;
  };
  logFields: {
    event: "checkpoint_artifact_persistence_failed";
    jobId: string;
    incidentId: string;
  };
}

export function buildVnextPersistenceFailure(
  jobId: string,
  incidentId: string,
): VnextPersistenceFailure {
  return {
    responseBody: {
      error: "internal_error",
      detail: "failed to persist checkpoint artifact",
      jobId,
      incidentId,
    },
    logFields: {
      event: "checkpoint_artifact_persistence_failed",
      jobId,
      incidentId,
    },
  };
}

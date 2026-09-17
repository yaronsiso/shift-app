// lib/features/sketch_analysis_v2_debug/data/sketch_canonical_topology_service.dart
//
// Debug-only service for the CanonicalTopology stage of the staged
// sketch-analysis pipeline. Talks ONLY to the existing, already-deployed
// `analyze-sketch-v2-canonical-topology` Edge Function and reads its
// response verbatim. Does not reproduce backend artifact-selection logic,
// does not derive meters/area/scale/room geometry from anything here, and
// does not treat raw envelope_topology as canonical geometry — that
// authority lives entirely server-side (Phase1C + the deterministic
// canonical constructor). This file only transports and displays what the
// backend already decided.
//
// RESPONSE CONTRACT (read directly from the deployed
// analyze-sketch-v2-canonical-topology/index.ts, not guessed):
//   - HTTP 200, body.status == "success": a canonical_topology artifact
//     was built and persisted. `candidateState` and the diagnostic
//     version/schema-selection fields are present; the full
//     CanonicalTopologyCandidate geometry itself is NOT parsed or
//     re-derived here (out of scope for this debug integration — see
//     CanonicalTopologyResult's own doc comment).
//   - HTTP 200, body.status == "blocked": the backend intentionally could
//     not build a canonical topology yet (a semantic/coverage/policy gate
//     in Phase1C, NOT a technical error). `blockedReasons` explains why.
//     This is a normal, expected outcome for RAW topology that is
//     structurally valid but not yet semantically resolvable — it must
//     never be treated as a failure/crash by this client.
//   - Any non-2xx response (400 bad_request — e.g. no valid/supported
//     envelope_topology source; 500 internal_error — e.g. stored-artifact
//     integrity failure, OpenAI failure, persistence failure) is a genuine
//     TECHNICAL failure, surfaced as a thrown FunctionException by the
//     Supabase client and wrapped here as CanonicalTopologyFailure, exactly
//     like every sibling service's Xxx Failure exception.
//
// Mirrors SketchEnvelopeService's/SketchEnvelopeTopologyService's
// shape/conventions exactly.

import 'package:supabase_flutter/supabase_flutter.dart';

class CanonicalTopologyResult {
  final String jobId;
  // "success" | "blocked" — the only two body.status values the backend
  // ever returns at HTTP 200 (see file header). A thrown
  // CanonicalTopologyFailure covers every other outcome.
  final String status;

  // Present only when status == "success".
  final String? semanticPlanArtifactId;
  final String? canonicalTopologyArtifactId;
  // The canonical constructor's own top-level state label (e.g.
  // "CLOSED_SINGLE_LOOP" or similar) — surfaced as an opaque string for
  // display only. This client never interprets, branches on, or derives
  // geometry from this value beyond showing it verbatim.
  final String? candidateState;

  // Present only when status == "blocked" — the backend's own explanation
  // of why canonical construction was intentionally deferred. Never
  // empty when status == "blocked".
  final List<String> blockedReasons;

  // Present on both success and blocked — full selection traceability,
  // read verbatim, never recomputed client-side.
  final int? sourceEnvelopeTopologyArtifactVersion;
  final String? sourceEnvelopeTopologyArtifactSchemaVersion;
  final List<int> skippedNewerInvalidVersions;
  final List<Map<String, dynamic>> skippedUnsupportedSchemaVersions;

  final int durationMs;
  final int attempt;

  CanonicalTopologyResult({
    required this.jobId,
    required this.status,
    required this.semanticPlanArtifactId,
    required this.canonicalTopologyArtifactId,
    required this.candidateState,
    required this.blockedReasons,
    required this.sourceEnvelopeTopologyArtifactVersion,
    required this.sourceEnvelopeTopologyArtifactSchemaVersion,
    required this.skippedNewerInvalidVersions,
    required this.skippedUnsupportedSchemaVersions,
    required this.durationMs,
    required this.attempt,
  });

  bool get isSuccess => status == 'success';
  bool get isBlocked => status == 'blocked';

  factory CanonicalTopologyResult.fromJson(Map<String, dynamic> json) => CanonicalTopologyResult(
        jobId: json['jobId'] as String,
        status: json['status'] as String? ?? 'blocked',
        semanticPlanArtifactId: json['semanticPlanArtifactId'] as String?,
        canonicalTopologyArtifactId: json['canonicalTopologyArtifactId'] as String?,
        candidateState: json['candidateState'] as String?,
        blockedReasons: (json['blockedReasons'] as List<dynamic>? ?? [])
            .map((e) => e.toString())
            .toList(),
        sourceEnvelopeTopologyArtifactVersion:
            json['sourceEnvelopeTopologyArtifactVersion'] as int?,
        sourceEnvelopeTopologyArtifactSchemaVersion:
            json['sourceEnvelopeTopologyArtifactSchemaVersion'] as String?,
        skippedNewerInvalidVersions: (json['skippedNewerInvalidVersions'] as List<dynamic>? ?? [])
            .map((e) => e as int)
            .toList(),
        skippedUnsupportedSchemaVersions:
            (json['skippedUnsupportedSchemaVersions'] as List<dynamic>? ?? [])
                .map((e) => e as Map<String, dynamic>)
                .toList(),
        durationMs: json['durationMs'] as int,
        attempt: json['attempt'] as int,
      );
}

/// Thrown for an actual TECHNICAL failure — network error, the intentional
/// real-user-JWT-only auth (401 for a non-user token — see file header;
/// this is expected/correct behavior, not something to special-case or
/// work around), no valid/supported envelope_topology source (400), or any
/// internal_error (500: stored-artifact integrity failure, OpenAI failure,
/// persistence failure, etc.). Mirrors every sibling XxxFailure exactly.
/// `status:"blocked"` is explicitly NOT this — see CanonicalTopologyResult.
class CanonicalTopologyFailure implements Exception {
  final String detail;
  CanonicalTopologyFailure(this.detail);

  @override
  String toString() => 'CanonicalTopologyFailure($detail)';
}

class SketchCanonicalTopologyService {
  final SupabaseClient _client;
  SketchCanonicalTopologyService(this._client);

  /// Runs the CanonicalTopology stage on a job whose EnvelopeTopology V2
  /// stage already produced a `status:"valid"` artifact. Invoked through
  /// the same authenticated Supabase client every other stage in this
  /// debug screen already uses — `functions.invoke` automatically attaches
  /// the current signed-in user's session JWT (see supabase_flutter's own
  /// FunctionsClient; no manual token handling anywhere in this codebase,
  /// and none added here). No service_role key is used, referenced, or
  /// obtainable from this file.
  Future<CanonicalTopologyResult> runCanonicalTopology(String jobId) async {
    try {
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-canonical-topology',
        body: {'jobId': jobId},
      );
      final data = res.data as Map<String, dynamic>;
      return CanonicalTopologyResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw CanonicalTopologyFailure(detailText ?? 'function_error');
    }
  }
}

// lib/features/sketch_analysis_v2_debug/data/sketch_envelope_topology_service.dart
//
// Debug-only service for the EnvelopeTopology V2 stage of the staged
// sketch-analysis pipeline. Talks ONLY to the existing, already-deployed
// `analyze-sketch-v2-envelope-topology` Edge Function and reads its
// response verbatim — this file does not reproduce, reinterpret, or
// validate anything the backend already decided. It does not touch
// `analyze-sketch` (v15, production), any design/render function, or any
// other stage's service/tables.
//
// SCOPE: this is a client-side mirror of the REAL, already-deployed
// response contract for `analyze-sketch-v2-envelope-topology/index.ts`
// (EnvelopeTopologyV2 schema — no polygonOrder; open/disconnected/
// uncertain graphs are legitimate `status:"valid"` results, never
// repaired or rejected here). This file must never be treated as the
// place to add topology repair/merging/snapping — none of that exists on
// the backend and none should be added here to compensate for it.
//
// Mirrors SketchEnvelopeService's shape/conventions exactly (same
// FunctionException -> XxxFailure pattern, same "every call is a fresh
// attempt, the server records its own artifact version" semantics).

import 'package:supabase_flutter/supabase_flutter.dart';

/// One vertex of a raw EnvelopeTopologyV2 graph, exactly as the backend
/// returns it — image-space percentages, not meters, not pixels.
class EnvelopeTopologyVertex {
  final String id;
  final double xPct;
  final double yPct;
  final String? cornerAngleHint; // "orthogonal_90" | "acute" | "obtuse" | "uncertain" | null

  EnvelopeTopologyVertex({
    required this.id,
    required this.xPct,
    required this.yPct,
    required this.cornerAngleHint,
  });

  factory EnvelopeTopologyVertex.fromJson(Map<String, dynamic> json) {
    final imagePct = json['imagePct'] as Map<String, dynamic>;
    return EnvelopeTopologyVertex(
      id: json['id'] as String,
      xPct: (imagePct['xPct'] as num).toDouble(),
      yPct: (imagePct['yPct'] as num).toDouble(),
      cornerAngleHint: json['cornerAngleHint'] as String?,
    );
  }
}

/// One edge of a raw EnvelopeTopologyV2 graph. `axisHint`/`roleHint` are
/// non-authoritative perception hints (see the backend's own validator —
/// an axisHint/geometry mismatch is diagnostic-only, never fatal), never
/// something this client re-derives or corrects.
class EnvelopeTopologyEdge {
  final String id;
  final String fromVertexId;
  final String toVertexId;
  final String axisHint; // "horizontal" | "vertical" | "diagonal_or_unknown"
  final String roleHint; // "exterior_wall" | "opening" | "uncertain"

  EnvelopeTopologyEdge({
    required this.id,
    required this.fromVertexId,
    required this.toVertexId,
    required this.axisHint,
    required this.roleHint,
  });

  factory EnvelopeTopologyEdge.fromJson(Map<String, dynamic> json) => EnvelopeTopologyEdge(
        id: json['id'] as String,
        fromVertexId: json['fromVertexId'] as String,
        toVertexId: json['toVertexId'] as String,
        axisHint: json['axisHint'] as String? ?? 'diagonal_or_unknown',
        roleHint: json['roleHint'] as String? ?? 'uncertain',
      );
}

class EnvelopeTopologyPerceptionNote {
  final String? vertexId;
  final String? edgeId;
  final String note;

  EnvelopeTopologyPerceptionNote({
    required this.vertexId,
    required this.edgeId,
    required this.note,
  });

  factory EnvelopeTopologyPerceptionNote.fromJson(Map<String, dynamic> json) =>
      EnvelopeTopologyPerceptionNote(
        vertexId: json['vertexId'] as String?,
        edgeId: json['edgeId'] as String?,
        note: json['note'] as String? ?? '',
      );
}

class RawEnvelopeTopology {
  final String schemaVersion;
  final List<EnvelopeTopologyVertex> vertices;
  final List<EnvelopeTopologyEdge> edges;
  final List<EnvelopeTopologyPerceptionNote> perceptionNotes;

  RawEnvelopeTopology({
    required this.schemaVersion,
    required this.vertices,
    required this.edges,
    required this.perceptionNotes,
  });

  factory RawEnvelopeTopology.fromJson(Map<String, dynamic> json) => RawEnvelopeTopology(
        schemaVersion: json['schemaVersion'] as String,
        vertices: (json['vertices'] as List<dynamic>? ?? [])
            .map((v) => EnvelopeTopologyVertex.fromJson(v as Map<String, dynamic>))
            .toList(),
        edges: (json['edges'] as List<dynamic>? ?? [])
            .map((e) => EnvelopeTopologyEdge.fromJson(e as Map<String, dynamic>))
            .toList(),
        perceptionNotes: (json['perceptionNotes'] as List<dynamic>? ?? [])
            .map((n) => EnvelopeTopologyPerceptionNote.fromJson(n as Map<String, dynamic>))
            .toList(),
      );
}

/// A single fatal error or non-fatal diagnostic entry — both the V2
/// validator's `errors[]` and `diagnostics[]` share this exact shape
/// server-side ({code, message, relatedIds}), so one class covers both.
class EnvelopeTopologyValidationIssue {
  final String code;
  final String message;
  final List<String> relatedIds;

  EnvelopeTopologyValidationIssue({
    required this.code,
    required this.message,
    required this.relatedIds,
  });

  factory EnvelopeTopologyValidationIssue.fromJson(Map<String, dynamic> json) =>
      EnvelopeTopologyValidationIssue(
        code: json['code'] as String? ?? 'unknown',
        message: json['message'] as String? ?? '',
        relatedIds: (json['relatedIds'] as List<dynamic>? ?? [])
            .map((e) => e.toString())
            .toList(),
      );
}

class EnvelopeTopologyValidation {
  final bool valid;
  final List<EnvelopeTopologyValidationIssue> errors;
  final List<EnvelopeTopologyValidationIssue> diagnostics;

  EnvelopeTopologyValidation({
    required this.valid,
    required this.errors,
    required this.diagnostics,
  });

  factory EnvelopeTopologyValidation.fromJson(Map<String, dynamic> json) =>
      EnvelopeTopologyValidation(
        valid: json['valid'] as bool? ?? false,
        errors: (json['errors'] as List<dynamic>? ?? [])
            .map((e) => EnvelopeTopologyValidationIssue.fromJson(e as Map<String, dynamic>))
            .toList(),
        diagnostics: (json['diagnostics'] as List<dynamic>? ?? [])
            .map((e) => EnvelopeTopologyValidationIssue.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class EnvelopeTopologyResult {
  final String jobId;
  final String artifactId;
  // "valid" | "invalid" | "forbidden_field_error" — a normal, non-exceptional
  // outcome (thrown FunctionExceptions are reserved for actual technical
  // failures — network/auth/internal_error/bad_request — see
  // EnvelopeTopologyFailure below).
  final String status;
  final RawEnvelopeTopology? topology; // null for forbidden_field_error
  final EnvelopeTopologyValidation? validation; // null for forbidden_field_error
  final String? error; // set only for forbidden_field_error
  final int durationMs;
  final int attempt;

  EnvelopeTopologyResult({
    required this.jobId,
    required this.artifactId,
    required this.status,
    required this.topology,
    required this.validation,
    required this.error,
    required this.durationMs,
    required this.attempt,
  });

  /// Whether this is the one status canonical-topology can actually be
  /// invoked against. Kept as a single named source of truth (rather than
  /// callers comparing `status == 'valid'` inline in the UI layer) so the
  /// exact same check is used both for gating the "run canonical" button
  /// and for unit tests — see sketch_scope_debug_screen.dart.
  bool get isValid => status == 'valid';

  factory EnvelopeTopologyResult.fromJson(Map<String, dynamic> json) => EnvelopeTopologyResult(
        jobId: json['jobId'] as String,
        artifactId: json['artifactId'] as String,
        status: json['status'] as String? ?? 'invalid',
        topology: json['topology'] == null
            ? null
            : RawEnvelopeTopology.fromJson(json['topology'] as Map<String, dynamic>),
        validation: json['validation'] == null
            ? null
            : EnvelopeTopologyValidation.fromJson(json['validation'] as Map<String, dynamic>),
        error: json['error'] as String?,
        durationMs: json['durationMs'] as int,
        attempt: json['attempt'] as int,
      );
}

/// Thrown for an actual TECHNICAL failure of this stage — network error,
/// auth error, or a non-2xx response from the Edge Function itself
/// (bad_request / internal_error). Mirrors EnvelopeFailure/
/// MeasurementsFailure/ScopeFailure's shape and meaning exactly.
/// `status:"invalid"` and `status:"forbidden_field_error"` are NOT
/// failures in this sense — those are normal HTTP-200 outcomes surfaced
/// via EnvelopeTopologyResult.status instead, exactly like
/// EnvelopeResult.isBlocked is not an exception either.
class EnvelopeTopologyFailure implements Exception {
  final String detail;
  EnvelopeTopologyFailure(this.detail);

  @override
  String toString() => 'EnvelopeTopologyFailure($detail)';
}

class SketchEnvelopeTopologyService {
  final SupabaseClient _client;
  SketchEnvelopeTopologyService(this._client);

  /// Runs the EnvelopeTopology V2 stage on a job whose Stage 0 (scope +
  /// crop) already completed — the only hard prerequisite this Edge
  /// Function actually enforces server-side (it reads the same cropped
  /// image Stage 0/Stage 1 already use; it does not require Pass 0.5
  /// measurements or Stage 1 envelope to have run). Every call is a fresh
  /// attempt — the server records each as its own artifact version, same
  /// as every other stage here.
  Future<EnvelopeTopologyResult> runEnvelopeTopology(String jobId) async {
    try {
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-envelope-topology',
        body: {'jobId': jobId},
      );
      final data = res.data as Map<String, dynamic>;
      return EnvelopeTopologyResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw EnvelopeTopologyFailure(detailText ?? 'function_error');
    }
  }
}

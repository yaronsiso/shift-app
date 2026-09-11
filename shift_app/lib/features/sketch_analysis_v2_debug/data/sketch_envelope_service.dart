// lib/features/sketch_analysis_v2_debug/data/sketch_envelope_service.dart
//
// Debug-only service for Stage 1 ("envelope") of the new staged sketch-
// analysis pipeline (session 21, direct continuation of Stage 0 "scope"
// from session 20). Talks ONLY to the new `analyze-sketch-v2-envelope`
// Edge Function and the existing `analysis_artifacts` table (read-only
// from the client, same as Stage 0's service). Does not touch
// `analyze-sketch` (v15, production), `sketch_analyses`, or Stage 0's own
// service/tables beyond reading a job that Stage 0 already created.
//
// Important: buildingEnvelope.vertices are NOT pixel/percentage positions
// in the cropped image — they are the model's own architectural
// interpretation, in meters, of the building's outline (same convention
// `analyze-sketch` v14/v15 already use in production for the full
// analysis). There is no guaranteed mapping from these coordinates to
// specific pixels in the photo. The debug screen draws them as a
// best-fit-to-bounds overlay (the polygon's own bounding box stretched to
// match the image's bounding box, preserving the polygon's proportions) —
// good enough to sanity-check the overall SHAPE at a glance, not a
// pixel-precise trace. See the debug screen's own caption text for the
// exact wording shown to Yaron about this limitation.

import 'package:supabase_flutter/supabase_flutter.dart';

class EnvelopePoint {
  final double x;
  final double y;
  EnvelopePoint({required this.x, required this.y});

  factory EnvelopePoint.fromJson(Map<String, dynamic> json) => EnvelopePoint(
        x: (json['x'] as num).toDouble(),
        y: (json['y'] as num).toDouble(),
      );
}

class EnvelopeResult {
  final String jobId;
  final String artifactId;
  final List<EnvelopePoint>? buildingEnvelope; // null = model honestly could not trace one
  final String confidence;
  final String notes;
  final int durationMs;
  final int attempt;

  EnvelopeResult({
    required this.jobId,
    required this.artifactId,
    required this.buildingEnvelope,
    required this.confidence,
    required this.notes,
    required this.durationMs,
    required this.attempt,
  });

  factory EnvelopeResult.fromJson(Map<String, dynamic> json) {
    final envelopeJson = json['buildingEnvelope'] as Map<String, dynamic>?;
    final verticesJson = envelopeJson?['vertices'] as List<dynamic>?;
    return EnvelopeResult(
      jobId: json['jobId'] as String,
      artifactId: json['artifactId'] as String,
      buildingEnvelope: verticesJson == null
          ? null
          : verticesJson
              .map((v) => EnvelopePoint.fromJson(v as Map<String, dynamic>))
              .toList(),
      confidence: json['confidence'] as String? ?? 'unknown',
      notes: json['notes'] as String? ?? '',
      durationMs: json['durationMs'] as int,
      attempt: json['attempt'] as int,
    );
  }
}

/// Thrown when the Edge Function itself reports a failure (as opposed to a
/// network/client-side error) — mirrors ScopeFailure's shape from Stage 0.
class EnvelopeFailure implements Exception {
  final String detail;
  EnvelopeFailure(this.detail);

  @override
  String toString() => 'EnvelopeFailure($detail)';
}

class SketchEnvelopeService {
  final SupabaseClient _client;
  SketchEnvelopeService(this._client);

  /// Runs Stage 1 (envelope) on a job whose Stage 0 (scope) already
  /// completed and uploaded a crop. Every call is a fresh attempt — the
  /// server records each as its own artifact version, so calling this
  /// again (a "run again" debug button) is always safe and never
  /// overwrites a previous result.
  Future<EnvelopeResult> runEnvelope(String jobId) async {
    try {
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-envelope',
        body: {'jobId': jobId},
      );
      final data = res.data as Map<String, dynamic>;
      return EnvelopeResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw EnvelopeFailure(detailText ?? 'function_error');
    }
  }
}

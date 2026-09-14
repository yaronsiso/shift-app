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
// ⚠️ REWRITTEN (same session, continued) after a real accuracy bug: given a
// drawing with large explicit printed dimensions (16.00m x 10.00m
// rectangle), the original version of analyze-sketch-v2-envelope returned
// a polygon measuring 17.80m x 10.25m (11% error), despite its own `notes`
// claiming the printed numbers were used. The fix (see
// analyze-sketch-v2-envelope/index.ts's file header for the full story)
// added a new required prior stage — Pass 0.5 "measurements"
// (sketch_measurements_service.dart) — whose output the server now
// validates the model's geometry against, and can override entirely (for
// simple rectangles) using code, not model arithmetic. This file's job is
// just to parse the richer response that came out of that fix: `confidence`
// is now the server's CODE-COMPUTED confidence (not the model's raw
// self-report — that's separately available as `modelReportedConfidence`),
// plus new `measurementsUsed`/`validation` diagnostic blocks.
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

/// Which measurements (from Pass 0.5) the server actually had available and
/// used to validate/build this envelope — surfaced so the debug screen can
/// show, in plain terms, whether this run had real numbers to check
/// against at all.
class MeasurementsUsed {
  final double? horizontalM;
  final String? horizontalConfidence;
  final double? verticalM;
  final String? verticalConfidence;
  final int chainsCount;

  MeasurementsUsed({
    required this.horizontalM,
    required this.horizontalConfidence,
    required this.verticalM,
    required this.verticalConfidence,
    required this.chainsCount,
  });

  factory MeasurementsUsed.fromJson(Map<String, dynamic>? json) => MeasurementsUsed(
        horizontalM: (json?['horizontalM'] as num?)?.toDouble(),
        horizontalConfidence: json?['horizontalConfidence'] as String?,
        verticalM: (json?['verticalM'] as num?)?.toDouble(),
        verticalConfidence: json?['verticalConfidence'] as String?,
        chainsCount: json?['chainsCount'] as int? ?? 0,
      );
}

/// Diagnostics from the server-side validator (validateAgainstMeasurements
/// in analyze-sketch-v2-envelope/index.ts) — did the model's geometry match
/// the authoritative measurements, was a corrective retry needed, did code
/// end up overriding the geometry entirely.
class EnvelopeValidation {
  final bool retried;
  final bool codeOverrodeGeometry;
  final double? horizontalErrorPct;
  final double? verticalErrorPct;

  EnvelopeValidation({
    required this.retried,
    required this.codeOverrodeGeometry,
    required this.horizontalErrorPct,
    required this.verticalErrorPct,
  });

  factory EnvelopeValidation.fromJson(Map<String, dynamic>? json) => EnvelopeValidation(
        retried: json?['retried'] as bool? ?? false,
        codeOverrodeGeometry: json?['codeOverrodeGeometry'] as bool? ?? false,
        horizontalErrorPct: (json?['horizontalErrorPct'] as num?)?.toDouble(),
        verticalErrorPct: (json?['verticalErrorPct'] as num?)?.toDouble(),
      );
}

class EnvelopeResult {
  final String jobId;
  final String artifactId;
  final List<EnvelopePoint>? buildingEnvelope; // null = model honestly could not trace one
  final String confidence; // server-computed, see file header
  final String modelReportedConfidence; // the model's own raw self-report, for comparison
  final String notes;
  final MeasurementsUsed measurementsUsed;
  final EnvelopeValidation validation;
  final int durationMs;
  final int attempt;

  EnvelopeResult({
    required this.jobId,
    required this.artifactId,
    required this.buildingEnvelope,
    required this.confidence,
    required this.modelReportedConfidence,
    required this.notes,
    required this.measurementsUsed,
    required this.validation,
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
      modelReportedConfidence: json['modelReportedConfidence'] as String? ?? 'unknown',
      notes: json['notes'] as String? ?? '',
      measurementsUsed:
          MeasurementsUsed.fromJson(json['measurementsUsed'] as Map<String, dynamic>?),
      validation: EnvelopeValidation.fromJson(json['validation'] as Map<String, dynamic>?),
      durationMs: json['durationMs'] as int,
      attempt: json['attempt'] as int,
    );
  }
}

/// Thrown when the Edge Function itself reports a failure (as opposed to a
/// network/client-side error) — mirrors ScopeFailure's shape from Stage 0.
/// Since the rewrite, this is also what surfaces the new precondition ("run
/// Pass 0.5 measurements first") if the debug screen's button ordering is
/// somehow bypassed.
class EnvelopeFailure implements Exception {
  final String detail;
  EnvelopeFailure(this.detail);

  @override
  String toString() => 'EnvelopeFailure($detail)';
}

class SketchEnvelopeService {
  final SupabaseClient _client;
  SketchEnvelopeService(this._client);

  /// Runs Stage 1 (envelope) on a job whose Stage 0 (scope) AND Pass 0.5
  /// (measurements) already completed. Every call is a fresh attempt — the
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

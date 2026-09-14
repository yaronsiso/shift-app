// lib/features/sketch_analysis_v2_debug/data/sketch_measurements_service.dart
//
// Debug-only service for the NEW Pass 0.5 ("measurements") stage, inserted
// between Stage 0 ("scope") and Stage 1 ("envelope") — session 21
// (continued), built after a real accuracy bug was found: Stage 1, given a
// drawing with large explicit printed dimensions (16.00m x 10.00m),
// returned a polygon of 17.80m x 10.25m. See
// sketch_envelope_service.dart's file header and
// analyze-sketch-v2-envelope/index.ts's file header for the full
// before/after numbers and the fix.
//
// Talks ONLY to the new `analyze-sketch-v2-measurements` Edge Function and
// the existing `analysis_artifacts` table (read-only from the client, same
// trust boundary as Stage 0/Stage 1's own services). Must run AFTER Stage 0
// (scope) and BEFORE Stage 1 (envelope) — Stage 1 now requires this stage's
// output to exist and will fail with a clear 400 if it doesn't.

import 'package:supabase_flutter/supabase_flutter.dart';

class DimensionSegment {
  final double valueM;
  final String text;
  DimensionSegment({required this.valueM, required this.text});

  factory DimensionSegment.fromJson(Map<String, dynamic> json) => DimensionSegment(
        valueM: (json['valueM'] as num).toDouble(),
        text: json['text'] as String? ?? '',
      );
}

class DimensionChain {
  final String id;
  final String axis; // "horizontal" | "vertical"
  final String location;
  final List<DimensionSegment> segments;
  final double? overallValueM;
  final String? overallText;
  final String confidence; // "high" | "medium" | "low"

  DimensionChain({
    required this.id,
    required this.axis,
    required this.location,
    required this.segments,
    required this.overallValueM,
    required this.overallText,
    required this.confidence,
  });

  /// The resolved total for this one chain — the explicit overall number
  /// if the drawing had one, otherwise the sum of its segments. Mirrors
  /// resolveChainTotalM in the server-side code exactly, purely for
  /// display on this debug screen (the server always does the real
  /// resolution — this is not re-implemented logic the client depends on).
  double get resolvedTotalM =>
      overallValueM ?? segments.fold<double>(0, (sum, s) => sum + s.valueM);

  factory DimensionChain.fromJson(Map<String, dynamic> json) => DimensionChain(
        id: json['id'] as String? ?? '',
        axis: json['axis'] as String? ?? '',
        location: json['location'] as String? ?? '',
        segments: (json['segments'] as List<dynamic>? ?? [])
            .map((s) => DimensionSegment.fromJson(s as Map<String, dynamic>))
            .toList(),
        overallValueM: (json['overallValueM'] as num?)?.toDouble(),
        overallText: json['overallText'] as String?,
        confidence: json['confidence'] as String? ?? 'unknown',
      );
}

class MeasurementsResult {
  final String jobId;
  final String artifactId;
  final List<DimensionChain> chains;
  final String notes;
  final int durationMs;
  final int attempt;

  MeasurementsResult({
    required this.jobId,
    required this.artifactId,
    required this.chains,
    required this.notes,
    required this.durationMs,
    required this.attempt,
  });

  factory MeasurementsResult.fromJson(Map<String, dynamic> json) => MeasurementsResult(
        jobId: json['jobId'] as String,
        artifactId: json['artifactId'] as String,
        chains: (json['chains'] as List<dynamic>? ?? [])
            .map((c) => DimensionChain.fromJson(c as Map<String, dynamic>))
            .toList(),
        notes: json['notes'] as String? ?? '',
        durationMs: json['durationMs'] as int,
        attempt: json['attempt'] as int,
      );
}

/// Thrown when the Edge Function itself reports a failure (as opposed to a
/// network/client-side error) — mirrors ScopeFailure/EnvelopeFailure's
/// shape.
class MeasurementsFailure implements Exception {
  final String detail;
  MeasurementsFailure(this.detail);

  @override
  String toString() => 'MeasurementsFailure($detail)';
}

class SketchMeasurementsService {
  final SupabaseClient _client;
  SketchMeasurementsService(this._client);

  /// Runs Pass 0.5 (measurements) on a job whose Stage 0 (scope) already
  /// completed and uploaded a crop. Every call is a fresh attempt — the
  /// server records each as its own artifact version, so re-running this
  /// (a "run again" debug button) is always safe.
  Future<MeasurementsResult> runMeasurements(String jobId) async {
    try {
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-measurements',
        body: {'jobId': jobId},
      );
      final data = res.data as Map<String, dynamic>;
      return MeasurementsResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw MeasurementsFailure(detailText ?? 'function_error');
    }
  }
}

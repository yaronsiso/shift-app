// lib/features/sketch_analysis_v2_debug/data/sketch_scope_service.dart
//
// Debug-only service for Stage 0 ("scope") of the new staged sketch-
// analysis pipeline (session 20). Talks ONLY to the new
// `analyze-sketch-v2-scope` Edge Function and the new `analysis_jobs` /
// `analysis_artifacts` tables (read-only from the client — the Edge
// Function does all writes with the service_role key, same trust boundary
// as `renders.status`). Does not touch `analyze-sketch` (v15, production),
// `sketch_analyses`, RenderService, or any existing upload/render flow.
//
// Storage: reuses the existing `renders` bucket (no new bucket/RLS needed)
// under a new path prefix: `<uid>/analysis/<...>/original.<ext>` and
// `<uid>/analysis/<jobId>/cropped.jpg`.

import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

class BboxPct {
  final double xMinPct;
  final double yMinPct;
  final double xMaxPct;
  final double yMaxPct;

  BboxPct({
    required this.xMinPct,
    required this.yMinPct,
    required this.xMaxPct,
    required this.yMaxPct,
  });

  factory BboxPct.fromJson(Map<String, dynamic> json) => BboxPct(
        xMinPct: (json['xMinPct'] as num).toDouble(),
        yMinPct: (json['yMinPct'] as num).toDouble(),
        xMaxPct: (json['xMaxPct'] as num).toDouble(),
        yMaxPct: (json['yMaxPct'] as num).toDouble(),
      );
}

class ExcludedRegion {
  final BboxPct bboxPct;
  final String reason;

  ExcludedRegion({required this.bboxPct, required this.reason});

  factory ExcludedRegion.fromJson(Map<String, dynamic> json) => ExcludedRegion(
        bboxPct: BboxPct.fromJson(json['bboxPct'] as Map<String, dynamic>),
        reason: json['reason'] as String? ?? '',
      );
}

class ScopeResult {
  final String jobId;
  final String artifactId;
  final BboxPct mainFloorPlanBboxPct;
  final List<ExcludedRegion> excludedRegions;
  final double scopeConfidence;
  final int durationMs;
  final int attempt;

  ScopeResult({
    required this.jobId,
    required this.artifactId,
    required this.mainFloorPlanBboxPct,
    required this.excludedRegions,
    required this.scopeConfidence,
    required this.durationMs,
    required this.attempt,
  });

  factory ScopeResult.fromJson(Map<String, dynamic> json) => ScopeResult(
        jobId: json['jobId'] as String,
        artifactId: json['artifactId'] as String,
        mainFloorPlanBboxPct: BboxPct.fromJson(
          json['mainFloorPlanBboxPct'] as Map<String, dynamic>,
        ),
        excludedRegions: (json['excludedRegions'] as List<dynamic>? ?? [])
            .map((e) => ExcludedRegion.fromJson(e as Map<String, dynamic>))
            .toList(),
        scopeConfidence: (json['scopeConfidence'] as num).toDouble(),
        durationMs: json['durationMs'] as int,
        attempt: json['attempt'] as int,
      );
}

/// Thrown when the Edge Function itself reports a failure (as opposed to a
/// network/client-side error). Carries `jobId` when the server managed to
/// create/find the job before failing, so the caller can offer "retry"
/// rather than starting a brand new job.
class ScopeFailure implements Exception {
  final String detail;
  final String? jobId;
  ScopeFailure(this.detail, this.jobId);

  @override
  String toString() => 'ScopeFailure($detail, jobId: $jobId)';
}

class SketchScopeService {
  final SupabaseClient _client;
  SketchScopeService(this._client);

  /// Uploads [file] to the `renders` bucket under a fresh
  /// `<uid>/analysis/<timestamp>/original.<ext>` path, then calls
  /// `analyze-sketch-v2-scope` to run Stage 0 on it. Creates a new job.
  Future<ScopeResult> runScopeOnNewImage(File file) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) {
      throw StateError('not signed in');
    }
    final ext = file.path.contains('.') ? file.path.split('.').last : 'jpg';
    final path =
        '$uid/analysis/${DateTime.now().millisecondsSinceEpoch}/original.$ext';

    await _client.storage.from('renders').upload(path, file);

    return _callScope({'imagePath': path});
  }

  /// Re-runs Stage 0 on an existing job's original image (retry, per
  /// Yaron's "small, testable, reversible steps" requirement — this is
  /// what makes a single Stage 0 attempt cheaply repeatable without
  /// re-uploading the image).
  Future<ScopeResult> retryScope(String jobId) => _callScope({'jobId': jobId});

  Future<ScopeResult> _callScope(Map<String, dynamic> body) async {
    try {
      final res =
          await _client.functions.invoke('analyze-sketch-v2-scope', body: body);
      final data = res.data as Map<String, dynamic>;
      return ScopeResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final jobId = details is Map ? details['jobId'] as String? : null;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw ScopeFailure(detailText ?? 'function_error', jobId);
    }
  }

  /// Uploads a client-cropped image next to the job it belongs to, under
  /// the same `renders` bucket, and returns the storage path.
  Future<String> uploadCrop(File croppedFile, String jobId) async {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) {
      throw StateError('not signed in');
    }
    final path = '$uid/analysis/$jobId/cropped.jpg';
    await _client.storage.from('renders').upload(
          path,
          croppedFile,
          fileOptions: const FileOptions(upsert: true),
        );
    return path;
  }
}

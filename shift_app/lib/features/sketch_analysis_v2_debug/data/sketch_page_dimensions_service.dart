// lib/features/sketch_analysis_v2_debug/data/sketch_page_dimensions_service.dart
//
// Debug-only service for Pass 1 ("page dimensions") — session 22, rebuilt
// around "Patch 01: Measurement Integrity" (see
// analyze-sketch-v2-page-dimensions/index.ts's file header for full
// provenance: an external architecture audit, independently verified,
// that also found and fixed a real averaging bug in the envelope stage).
// Supersedes this session's own earlier, simpler version of this file
// (built before the audit, never deployed/run) — same job, richer/safer
// data model: raw measurement evidence (with bbox + unit-evidence) instead
// of pre-converted numbers, chains that reference measurement IDs instead
// of embedding values, and code-resolved horizontal/vertical extents that
// report a CONFLICT rather than silently averaging disagreeing chains.
//
// COMPLETELY SEPARATE from SketchMeasurementsService/SketchEnvelopeService
// — does not depend on them and they don't depend on this. Only
// precondition is Stage 0 (scope) having already run and uploaded a crop.

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
        xMinPct: (json['xMinPct'] as num?)?.toDouble() ?? 0,
        yMinPct: (json['yMinPct'] as num?)?.toDouble() ?? 0,
        xMaxPct: (json['xMaxPct'] as num?)?.toDouble() ?? 0,
        yMaxPct: (json['yMaxPct'] as num?)?.toDouble() ?? 0,
      );
}

/// Raw evidence for one printed measurement — the model transcribes this,
/// unit conversion/summation is done in code, never by the model. Mirrors
/// RawMeasurement in page_dimensions_schema_v2.ts exactly.
class RawMeasurement {
  final String id;
  final String rawText;
  final double? rawNumeric;
  final String unit; // "mm" | "cm" | "m" | "unknown"
  final String unitEvidence; // "explicit" | "sheet_context" | "inferred" | "unknown"
  final String referenceType;
  final String axis; // "horizontal" | "vertical" | "diagonal" | "unknown"
  final BboxPct bboxPct;
  final String label;
  final String confidence;

  RawMeasurement({
    required this.id,
    required this.rawText,
    required this.rawNumeric,
    required this.unit,
    required this.unitEvidence,
    required this.referenceType,
    required this.axis,
    required this.bboxPct,
    required this.label,
    required this.confidence,
  });

  factory RawMeasurement.fromJson(Map<String, dynamic> json) => RawMeasurement(
        id: json['id'] as String? ?? '',
        rawText: json['rawText'] as String? ?? '',
        rawNumeric: (json['rawNumeric'] as num?)?.toDouble(),
        unit: json['unit'] as String? ?? 'unknown',
        unitEvidence: json['unitEvidence'] as String? ?? 'unknown',
        referenceType: json['referenceType'] as String? ?? 'unknown',
        axis: json['axis'] as String? ?? 'unknown',
        bboxPct: BboxPct.fromJson(json['bboxPct'] as Map<String, dynamic>? ?? const {}),
        label: json['label'] as String? ?? '',
        confidence: json['confidence'] as String? ?? 'unknown',
      );
}

/// A chain references measurement IDs rather than embedding values —
/// mirrors DimensionChain in page_dimensions_schema_v2.ts.
class PageDimensionChainV2 {
  final String id;
  final String axis;
  final String level;
  final String referenceType;
  final BboxPct bboxPct;
  final String locationLabel;
  final List<String> segmentMeasurementIds;
  final String? overallMeasurementId;
  final String confidence;

  PageDimensionChainV2({
    required this.id,
    required this.axis,
    required this.level,
    required this.referenceType,
    required this.bboxPct,
    required this.locationLabel,
    required this.segmentMeasurementIds,
    required this.overallMeasurementId,
    required this.confidence,
  });

  factory PageDimensionChainV2.fromJson(Map<String, dynamic> json) => PageDimensionChainV2(
        id: json['id'] as String? ?? '',
        axis: json['axis'] as String? ?? 'unknown',
        level: json['level'] as String? ?? 'unknown',
        referenceType: json['referenceType'] as String? ?? 'unknown',
        bboxPct: BboxPct.fromJson(json['bboxPct'] as Map<String, dynamic>? ?? const {}),
        locationLabel: json['locationLabel'] as String? ?? '',
        segmentMeasurementIds: (json['segmentMeasurementIds'] as List<dynamic>? ?? [])
            .map((e) => e as String)
            .toList(),
        overallMeasurementId: json['overallMeasurementId'] as String?,
        confidence: json['confidence'] as String? ?? 'unknown',
      );
}

/// Code-computed (server-side) per-chain validation — mirrors
/// ChainValidation in measurement_resolver.ts exactly.
class ChainValidationV2 {
  final String chainId;
  final double? segmentSumM;
  final double? overallM;
  final double? diffPct;
  final String status; // "match" | "contradiction" | "not_checkable"

  ChainValidationV2({
    required this.chainId,
    required this.segmentSumM,
    required this.overallM,
    required this.diffPct,
    required this.status,
  });

  factory ChainValidationV2.fromJson(Map<String, dynamic> json) => ChainValidationV2(
        chainId: json['chainId'] as String? ?? '',
        segmentSumM: (json['segmentSumM'] as num?)?.toDouble(),
        overallM: (json['overallM'] as num?)?.toDouble(),
        diffPct: (json['diffPct'] as num?)?.toDouble(),
        status: json['status'] as String? ?? 'unknown',
      );
}

/// Code-computed (server-side) resolution of ONE building-wide axis extent
/// — mirrors ResolvedExtent in measurement_resolver.ts exactly. status
/// "conflict" means credible chains disagreed and NOTHING was used as
/// authoritative (never averaged) — this is the session-22 fix.
class ResolvedExtentV2 {
  final String axis;
  final double? valueM;
  final String confidence;
  final List<String> sourceChainIds;
  final String status; // "resolved" | "conflict" | "missing"
  final List<String> diagnostics;

  ResolvedExtentV2({
    required this.axis,
    required this.valueM,
    required this.confidence,
    required this.sourceChainIds,
    required this.status,
    required this.diagnostics,
  });

  factory ResolvedExtentV2.fromJson(Map<String, dynamic> json) => ResolvedExtentV2(
        axis: json['axis'] as String? ?? 'unknown',
        valueM: (json['valueM'] as num?)?.toDouble(),
        confidence: json['confidence'] as String? ?? 'unknown',
        sourceChainIds:
            (json['sourceChainIds'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
        status: json['status'] as String? ?? 'unknown',
        diagnostics: (json['diagnostics'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
      );
}

class PageDimensionsResult {
  final String jobId;
  final String artifactId;
  final List<RawMeasurement> measurements;
  final List<PageDimensionChainV2> chains;
  final String notes;
  final List<ChainValidationV2> chainValidations;
  final ResolvedExtentV2 horizontalExtent;
  final ResolvedExtentV2 verticalExtent;
  final int durationMs;
  final int attempt;

  PageDimensionsResult({
    required this.jobId,
    required this.artifactId,
    required this.measurements,
    required this.chains,
    required this.notes,
    required this.chainValidations,
    required this.horizontalExtent,
    required this.verticalExtent,
    required this.durationMs,
    required this.attempt,
  });

  factory PageDimensionsResult.fromJson(Map<String, dynamic> json) => PageDimensionsResult(
        jobId: json['jobId'] as String,
        artifactId: json['artifactId'] as String,
        measurements: (json['measurements'] as List<dynamic>? ?? [])
            .map((m) => RawMeasurement.fromJson(m as Map<String, dynamic>))
            .toList(),
        chains: (json['chains'] as List<dynamic>? ?? [])
            .map((c) => PageDimensionChainV2.fromJson(c as Map<String, dynamic>))
            .toList(),
        notes: json['notes'] as String? ?? '',
        chainValidations: (json['chainValidations'] as List<dynamic>? ?? [])
            .map((v) => ChainValidationV2.fromJson(v as Map<String, dynamic>))
            .toList(),
        horizontalExtent:
            ResolvedExtentV2.fromJson(json['horizontalExtent'] as Map<String, dynamic>? ?? const {}),
        verticalExtent:
            ResolvedExtentV2.fromJson(json['verticalExtent'] as Map<String, dynamic>? ?? const {}),
        durationMs: json['durationMs'] as int,
        attempt: json['attempt'] as int,
      );
}

/// Thrown when the Edge Function itself reports a failure (as opposed to a
/// network/client-side error) — mirrors MeasurementsFailure/EnvelopeFailure.
class PageDimensionsFailure implements Exception {
  final String detail;
  PageDimensionsFailure(this.detail);

  @override
  String toString() => 'PageDimensionsFailure($detail)';
}

class SketchPageDimensionsService {
  final SupabaseClient _client;
  SketchPageDimensionsService(this._client);

  /// Runs Pass 1 (page dimensions) on a job whose Stage 0 (scope) already
  /// completed and uploaded a crop. Independent of Pass 0.5/Stage 1 — does
  /// not require either to have run. Every call is a fresh attempt — the
  /// server records each as its own artifact version.
  Future<PageDimensionsResult> runPageDimensions(String jobId) async {
    try {
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-page-dimensions',
        body: {'jobId': jobId},
      );
      final data = res.data as Map<String, dynamic>;
      return PageDimensionsResult.fromJson(data);
    } on FunctionException catch (e) {
      final details = e.details;
      final detailText =
          details is Map ? details['detail']?.toString() : details?.toString();
      throw PageDimensionsFailure(detailText ?? 'function_error');
    }
  }
}

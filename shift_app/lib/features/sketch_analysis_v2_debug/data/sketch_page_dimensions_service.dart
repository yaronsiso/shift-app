// lib/features/sketch_analysis_v2_debug/data/sketch_page_dimensions_service.dart
//
// Debug-only service for Pass 1 ("page dimensions") — session 23 rewrite.
// The model no longer returns chains or an "overall" classification (see
// analyze-sketch-v2-page-dimensions/index.ts's header for the full
// rationale: session 22's real-drawing test showed the model reads/
// classifies individual numbers well but groups them into chains badly).
// Chains are now built entirely in code from measurement geometry, and
// this file's models mirror that server-side shape exactly:
// DimensionEvidence (per-measurement raw evidence, now including the
// actual dimension-line endpoints) + DocumentMeasurementConvention
// (page-wide unit evidence) + BuiltDimensionChain (code-computed) +
// ResolvedExtentV3 (code-computed, never-averaged).
//
// COMPLETELY SEPARATE from SketchMeasurementsService/SketchEnvelopeService
// — does not depend on them and they don't depend on this. Only
// precondition is Stage 0 (scope) having already run and uploaded a crop.

import 'package:supabase_flutter/supabase_flutter.dart';

// Session 23, follow-up #2 ("dimension strips"): aliased import purely for
// its BboxPct type (the ORIGINAL-image-percentage bbox each strip was cut
// from) — aliased because this file already declares its OWN, semantically
// different BboxPct below (a per-measurement text bbox, in the PASS-1
// IMAGE's own percentage space). Deliberately not merged into one type:
// the two represent different coordinate spaces and mixing them up would
// be exactly the kind of bug this feature's whole remap step exists to
// prevent.
import 'sketch_scope_service.dart' as scope_service;

class Point2DPct {
  final double xPct;
  final double yPct;
  Point2DPct({required this.xPct, required this.yPct});

  factory Point2DPct.fromJson(Map<String, dynamic> json) => Point2DPct(
        xPct: (json['xPct'] as num?)?.toDouble() ?? 0,
        yPct: (json['yPct'] as num?)?.toDouble() ?? 0,
      );
}

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

/// Raw evidence for one printed measurement. NOTE: no "referenceType"
/// overall/segment distinction anymore — referenceTypeHint is purely
/// descriptive, mirrors DimensionEvidence in dimension_evidence_schema_v3.ts.
class DimensionEvidence {
  final String id;
  final String rawText;
  final double? rawNumeric;
  final String unit; // "mm" | "cm" | "m" | "unknown"
  final String axis; // "horizontal" | "vertical" | "diagonal" | "unknown"
  final BboxPct bboxPct;
  final Point2DPct? lineStartPct;
  final Point2DPct? lineEndPct;
  final String referenceTypeHint; // building | room | wall | opening | elevation | area | unknown
  final String confidence;

  DimensionEvidence({
    required this.id,
    required this.rawText,
    required this.rawNumeric,
    required this.unit,
    required this.axis,
    required this.bboxPct,
    required this.lineStartPct,
    required this.lineEndPct,
    required this.referenceTypeHint,
    required this.confidence,
  });

  factory DimensionEvidence.fromJson(Map<String, dynamic> json) => DimensionEvidence(
        id: json['id'] as String? ?? '',
        rawText: json['rawText'] as String? ?? '',
        rawNumeric: (json['rawNumeric'] as num?)?.toDouble(),
        unit: json['unit'] as String? ?? 'unknown',
        axis: json['axis'] as String? ?? 'unknown',
        bboxPct: BboxPct.fromJson(json['bboxPct'] as Map<String, dynamic>? ?? const {}),
        lineStartPct: json['lineStartPct'] == null
            ? null
            : Point2DPct.fromJson(json['lineStartPct'] as Map<String, dynamic>),
        lineEndPct: json['lineEndPct'] == null
            ? null
            : Point2DPct.fromJson(json['lineEndPct'] as Map<String, dynamic>),
        referenceTypeHint: json['referenceTypeHint'] as String? ?? 'unknown',
        confidence: json['confidence'] as String? ?? 'unknown',
      );
}

/// Page-wide unit-convention evidence — mirrors DocumentMeasurementConvention.
class DocumentMeasurementConvention {
  final String detectedUnit;
  final String confidence;
  final List<String> evidence;

  DocumentMeasurementConvention({
    required this.detectedUnit,
    required this.confidence,
    required this.evidence,
  });

  factory DocumentMeasurementConvention.fromJson(Map<String, dynamic> json) =>
      DocumentMeasurementConvention(
        detectedUnit: json['detectedUnit'] as String? ?? 'unknown',
        confidence: json['confidence'] as String? ?? 'unknown',
        evidence: (json['evidence'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
      );
}

/// A chain CODE built from measurement geometry — mirrors
/// BuiltDimensionChain in dimension_chain_builder_v3.ts exactly.
/// isOverallCandidate is a geometric fact (does this chain's span cover
/// ~the full page on its axis), never something the model decided.
class BuiltDimensionChain {
  final String id;
  final String axis; // "horizontal" | "vertical"
  final List<String> measurementIds;
  // Session 23, follow-up #3: clamped to the canonical [0,100] main-crop
  // space (intersection with it) — coveragePct/isOverallCandidate are
  // computed from these, never from the raw span below.
  final double spanStartPct;
  final double spanEndPct;
  // The raw, UNCLAMPED span — can be <0 or >100 for a chain built mostly
  // from strip evidence. Diagnostic only.
  final double rawSpanStartPct;
  final double rawSpanEndPct;
  final double coveragePct;
  final double crossStripPct;
  final bool isOverallCandidate;
  final String dominantReferenceTypeHint;
  final int usedLineEndpointsCount;

  BuiltDimensionChain({
    required this.id,
    required this.axis,
    required this.measurementIds,
    required this.spanStartPct,
    required this.spanEndPct,
    required this.rawSpanStartPct,
    required this.rawSpanEndPct,
    required this.coveragePct,
    required this.crossStripPct,
    required this.isOverallCandidate,
    required this.dominantReferenceTypeHint,
    required this.usedLineEndpointsCount,
  });

  factory BuiltDimensionChain.fromJson(Map<String, dynamic> json) => BuiltDimensionChain(
        id: json['id'] as String? ?? '',
        axis: json['axis'] as String? ?? 'unknown',
        measurementIds:
            (json['measurementIds'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
        spanStartPct: (json['spanStartPct'] as num?)?.toDouble() ?? 0,
        spanEndPct: (json['spanEndPct'] as num?)?.toDouble() ?? 0,
        rawSpanStartPct: (json['rawSpanStartPct'] as num?)?.toDouble() ??
            (json['spanStartPct'] as num?)?.toDouble() ??
            0,
        rawSpanEndPct: (json['rawSpanEndPct'] as num?)?.toDouble() ??
            (json['spanEndPct'] as num?)?.toDouble() ??
            0,
        coveragePct: (json['coveragePct'] as num?)?.toDouble() ?? 0,
        crossStripPct: (json['crossStripPct'] as num?)?.toDouble() ?? 0,
        isOverallCandidate: json['isOverallCandidate'] as bool? ?? false,
        dominantReferenceTypeHint: json['dominantReferenceTypeHint'] as String? ?? 'unknown',
        usedLineEndpointsCount: (json['usedLineEndpointsCount'] as num?)?.toInt() ?? 0,
      );
}

/// Code-computed (server-side) resolution of ONE building-wide axis extent
/// — mirrors ResolvedExtentV3 in dimension_chain_resolver_v3.ts exactly.
/// status "conflict" means credible chains disagreed and NOTHING was used
/// as authoritative (never averaged). "missing" means no chain reached
/// overall-envelope geometric coverage at all. "unresolved" means a
/// geometrically-qualifying chain was found but its value couldn't be
/// converted to meters (unit problem, or a non-length referenceTypeHint).
class ResolvedExtentV3 {
  final String axis;
  final double? valueM;
  final String confidence;
  final List<String> sourceChainIds;
  final String status; // "resolved" | "conflict" | "missing" | "unresolved"
  final List<String> diagnostics;

  ResolvedExtentV3({
    required this.axis,
    required this.valueM,
    required this.confidence,
    required this.sourceChainIds,
    required this.status,
    required this.diagnostics,
  });

  factory ResolvedExtentV3.fromJson(Map<String, dynamic> json) => ResolvedExtentV3(
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
  final List<DimensionEvidence> measurements;
  final DocumentMeasurementConvention convention;
  // Session 23, follow-up #3: the CODE-computed, deterministic unit
  // convention (document_unit_convention_resolver.ts) — this, not the
  // model-reported `convention` above, is what horizontalExtent/
  // verticalExtent were actually resolved with. Kept as a separate field
  // (rather than replacing `convention`) so the debug screen can show
  // both side by side: the model's own page-wide hint (often
  // low-confidence "unknown") vs. what code inferred from cross-
  // measurement architectural plausibility.
  final DocumentMeasurementConvention documentUnitConvention;
  final String notes;
  final List<BuiltDimensionChain> builtChains;
  final ResolvedExtentV3 horizontalExtent;
  final ResolvedExtentV3 verticalExtent;
  // Session 23, follow-up #2: which dimension strips (top/bottom/left/
  // right) actually contributed measurements this run, and a short
  // per-strip trail of what happened to each one (skipped/used/failed/
  // dedup count) — purely diagnostic, for the debug screen.
  final List<String> stripsUsed;
  final List<String> stripDiagnostics;
  final int durationMs;
  final int attempt;

  PageDimensionsResult({
    required this.jobId,
    required this.artifactId,
    required this.measurements,
    required this.convention,
    required this.documentUnitConvention,
    required this.notes,
    required this.builtChains,
    required this.horizontalExtent,
    required this.verticalExtent,
    required this.stripsUsed,
    required this.stripDiagnostics,
    required this.durationMs,
    required this.attempt,
  });

  factory PageDimensionsResult.fromJson(Map<String, dynamic> json) => PageDimensionsResult(
        jobId: json['jobId'] as String,
        artifactId: json['artifactId'] as String,
        measurements: (json['measurements'] as List<dynamic>? ?? [])
            .map((m) => DimensionEvidence.fromJson(m as Map<String, dynamic>))
            .toList(),
        convention: DocumentMeasurementConvention.fromJson(
            json['convention'] as Map<String, dynamic>? ?? const {}),
        documentUnitConvention: DocumentMeasurementConvention.fromJson(
            json['documentUnitConvention'] as Map<String, dynamic>? ?? const {}),
        notes: json['notes'] as String? ?? '',
        builtChains: (json['builtChains'] as List<dynamic>? ?? [])
            .map((c) => BuiltDimensionChain.fromJson(c as Map<String, dynamic>))
            .toList(),
        horizontalExtent:
            ResolvedExtentV3.fromJson(json['horizontalExtent'] as Map<String, dynamic>? ?? const {}),
        verticalExtent:
            ResolvedExtentV3.fromJson(json['verticalExtent'] as Map<String, dynamic>? ?? const {}),
        stripsUsed:
            (json['stripsUsed'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
        stripDiagnostics:
            (json['stripDiagnostics'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
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
  ///
  /// [stripBboxes] (session 23, follow-up #2, optional) — the bboxes (in
  /// the ORIGINAL image's percentage space) of whichever dimension strips
  /// were actually cropped AND uploaded for this job (see
  /// ../data/dimension_strips.dart + SketchScopeService.uploadStrip). Only
  /// include a strip here if its file really was uploaded — the server
  /// signs each strip's storage path itself and simply skips any that
  /// don't resolve, but there's no point asking it to try one that was
  /// never uploaded.
  Future<PageDimensionsResult> runPageDimensions(
    String jobId, {
    Map<String, scope_service.BboxPct>? stripBboxes,
  }) async {
    try {
      final body = <String, dynamic>{'jobId': jobId};
      if (stripBboxes != null && stripBboxes.isNotEmpty) {
        body['stripBboxes'] = {
          for (final entry in stripBboxes.entries) entry.key: entry.value.toJson(),
        };
      }
      final res = await _client.functions.invoke(
        'analyze-sketch-v2-page-dimensions',
        body: body,
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

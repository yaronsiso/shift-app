// lib/features/sketch_analysis_v2_debug/presentation/sketch_scope_debug_screen.dart
//
// Debug-only screen for the new staged sketch-analysis pipeline (session
// 20-22). NOT linked from app_router.dart or any real user-facing
// navigation, and not exported/used by any existing screen — reach it
// only by temporarily wiring a route to it yourself while testing (e.g. a
// throwaway GoRoute, or pushing it directly with Navigator from a debug
// button), then remove that link when done.
//
// Now covers FOUR stages/passes of the pipeline:
//   Pass 1 ("page dimensions") — session 23 rewrite: the model no longer
//   groups measurements into chains or decides which one is "overall"
//   (session 22's real-drawing test showed it's unreliable at both — 44
//   measurements transcribed well, but only 2 chains built, neither
//   classified overall_building). Now the model ONLY returns individual
//   DimensionEvidence records (+ a page-wide unit-convention hint); CODE
//   builds chains from geometry and decides which chain is an axis's
//   overall/envelope candidate purely by whether its span covers ~the
//   full page (which Stage 0 already cropped to just the main floor
//   plan) — see dimension_chain_builder_v3.ts / dimension_chain_resolver_v3.ts.
//   Still never averages disagreeing chains. Fully independent — only
//   needs Stage 0, does not feed Pass 0.5/Stage 1 (yet) — see
//   analyze-sketch-v2-page-dimensions/index.ts.
//   Stage 0 ("scope + crop"): pick a real floor-plan photo, find where the
//   main floor plan is on the page (bbox + excluded regions), crop to it
//   client-side. Session 20/21 — see claude/51/52.
//   Pass 0.5 ("measurements") — NEW, session 21 continued: given Stage 0's
//   crop, transcribe every written dimension chain measuring the outer
//   envelope (no geometry at all). Built after a real accuracy bug: Stage 1,
//   given a drawing with explicit printed 16.00m x 10.00m dimensions,
//   returned a polygon of 17.80m x 10.25m. Must run BEFORE Stage 1 now —
//   Stage 1 requires it and will fail with a clear message if skipped.
//   Stage 1 ("envelope"): given Stage 0's crop + Pass 0.5's measurements,
//   identify the building's outer envelope polygon — now validated (and,
//   for simple rectangles, entirely rebuilt in code) against the
//   authoritative measurements rather than trusting the model's own
//   arithmetic/self-reported confidence. Session 21 — see claude/52 and
//   analyze-sketch-v2-envelope/index.ts's file header for the full story.
//   Every later stage (rooms/walls/openings/stairs) is still unbuilt by
//   design — Yaron's explicit "one small step at a time, verify before
//   continuing" requirement (see claude/00_HANDOFF).

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/client_side_crop.dart';
import '../data/dimension_strips.dart';
import '../data/sketch_envelope_service.dart';
import '../data/sketch_measurements_service.dart';
// `hide BboxPct`: sketch_page_dimensions_service.dart declares its OWN,
// semantically-different `BboxPct` class (a single measurement's bbox,
// within DimensionEvidence) — see that file's own `scope_service.BboxPct`
// aliased import for the same reason. This screen only ever needs the
// OTHER BboxPct (sketch_scope_service.dart's — the main-floor-plan/strip
// bbox type used for _uploadedStripBboxes etc.), so hiding this file's
// same-named class here is what lets both imports coexist unaliased.
import '../data/sketch_page_dimensions_service.dart' hide BboxPct;
import '../data/sketch_scope_service.dart';
import 'envelope_overlay_painter.dart';

class SketchScopeDebugScreen extends StatefulWidget {
  const SketchScopeDebugScreen({super.key});

  @override
  State<SketchScopeDebugScreen> createState() =>
      _SketchScopeDebugScreenState();
}

class _SketchScopeDebugScreenState extends State<SketchScopeDebugScreen> {
  late final SketchScopeService _service =
      SketchScopeService(Supabase.instance.client);
  late final SketchMeasurementsService _measurementsService =
      SketchMeasurementsService(Supabase.instance.client);
  late final SketchEnvelopeService _envelopeService =
      SketchEnvelopeService(Supabase.instance.client);
  late final SketchPageDimensionsService _pageDimensionsService =
      SketchPageDimensionsService(Supabase.instance.client);

  File? _originalFile;
  File? _croppedFile;
  ScopeResult? _result;
  String? _error;
  bool _busy = false;

  // Session 23, follow-up #2 ("dimension strips"): whichever strips were
  // successfully cropped+uploaded for the current job, keyed by name, with
  // each one's own bbox (ORIGINAL-image percentage space) — this is what
  // gets sent to Pass 1 so the server knows what to sign/read and how to
  // remap each strip's measurements back into the main crop's coordinate
  // space. Null/empty just means "no strips this run" — Pass 1 still works
  // fine without them (best-effort feature, never required).
  Map<String, BboxPct> _uploadedStripBboxes = {};

  // Original-image preview state. Kept fully separate from _originalFile
  // (which is what actually gets sent to Stage 0, untouched) — this is
  // display-only.
  Uint8List? _originalDisplayBytes;
  String? _originalDisplayError;

  // Pass 0.5 (measurements) state — must complete before Stage 1 can run
  // (the server enforces this too; the button below is just a convenience
  // gate so Yaron can't hit the same "forgot a step" error the server
  // would otherwise report).
  MeasurementsResult? _measurementsResult;
  String? _measurementsError;
  bool _measurementsBusy = false;

  // Pass 1 (page dimensions) state — session 22, rebuilt around "Patch 01:
  // Measurement Integrity" (see sketch_page_dimensions_service.dart's file
  // header). Completely independent of Pass 0.5/Stage 1: only needs Stage
  // 0's crop. Reads raw measurement evidence for EVERY printed dimension
  // on the page (not just the outer envelope) and resolves the axis
  // extents in code, never averaging disagreeing chains.
  PageDimensionsResult? _pageDimensionsResult;
  String? _pageDimensionsError;
  bool _pageDimensionsBusy = false;

  // Stage 1 (envelope) state — independent of Stage 0's _busy/_error so a
  // Stage 1 run never disables the Stage 0 controls.
  EnvelopeResult? _envelopeResult;
  String? _envelopeError;
  bool _envelopeBusy = false;
  // Decoded once per envelope run (not in build()/FutureBuilder) so the
  // overlay doesn't re-decode the same cropped file on every unrelated
  // rebuild of this screen.
  Size? _croppedImageSize;

  Future<void> _pickAndRun() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked == null) return;

    setState(() {
      _busy = true;
      _error = null;
      _result = null;
      _croppedFile = null;
      _originalFile = File(picked.path);
      _originalDisplayBytes = null;
      _originalDisplayError = null;
      _measurementsResult = null;
      _measurementsError = null;
      _envelopeResult = null;
      _envelopeError = null;
      _pageDimensionsResult = null;
      _pageDimensionsError = null;
      _uploadedStripBboxes = {};
    });

    // Fire-and-forget: the display preview must never block or fail the
    // actual Stage 0 run below.
    unawaited(_prepareOriginalDisplayBytes());

    await _runAndCrop(() => _service.runScopeOnNewImage(_originalFile!));
  }

  Future<void> _retry() async {
    final jobId = _result?.jobId;
    if (jobId == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _measurementsResult = null;
      _measurementsError = null;
      _envelopeResult = null;
      _envelopeError = null;
      _pageDimensionsResult = null;
      _pageDimensionsError = null;
      _uploadedStripBboxes = {};
    });
    await _runAndCrop(() => _service.retryScope(jobId));
  }

  Future<void> _runAndCrop(Future<ScopeResult> Function() call) async {
    try {
      final result = await call();
      final cropped =
          await cropImageToBboxPct(_originalFile!, result.mainFloorPlanBboxPct);
      await _service.uploadCrop(cropped, result.jobId);

      // Session 23, follow-up #2 ("dimension strips"): best-effort — a
      // strip-cropping/upload failure must never fail Stage 0 itself, since
      // Pass 1 works fine without strips (see dimension_strips.dart's file
      // header). Whichever strips succeed get their own bbox recorded so
      // Pass 1 can remap their measurements back into the main crop.
      Map<String, BboxPct> uploadedStripBboxes = {};
      try {
        final stripBboxes = computeStripBboxes(result.mainFloorPlanBboxPct);
        final strippedFiles = await cropDimensionStrips(_originalFile!, stripBboxes);
        for (final entry in strippedFiles.entries) {
          await _service.uploadStrip(entry.value, result.jobId, entry.key);
          uploadedStripBboxes[entry.key] = stripBboxes[entry.key]!;
        }
      } catch (e) {
        debugPrint('[sketch-debug] dimension strips failed (non-fatal): $e');
      }

      if (!mounted) return;
      setState(() {
        _result = result;
        _croppedFile = cropped;
        _uploadedStripBboxes = uploadedStripBboxes;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _busy = false;
      });
    }
  }

  Future<void> _runMeasurements() async {
    final jobId = _result?.jobId;
    if (jobId == null) return;
    setState(() {
      _measurementsBusy = true;
      _measurementsError = null;
      // a re-run of measurements invalidates any envelope already built
      // from the previous measurements version, so clear it too.
      _envelopeResult = null;
      _envelopeError = null;
    });
    try {
      final result = await _measurementsService.runMeasurements(jobId);
      if (!mounted) return;
      setState(() {
        _measurementsResult = result;
        _measurementsBusy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _measurementsError = e.toString();
        _measurementsBusy = false;
      });
    }
  }

  Future<void> _runPageDimensions() async {
    final jobId = _result?.jobId;
    if (jobId == null) return;
    setState(() {
      _pageDimensionsBusy = true;
      _pageDimensionsError = null;
    });
    try {
      final result = await _pageDimensionsService.runPageDimensions(
        jobId,
        stripBboxes: _uploadedStripBboxes,
      );
      if (!mounted) return;
      setState(() {
        _pageDimensionsResult = result;
        _pageDimensionsBusy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _pageDimensionsError = e.toString();
        _pageDimensionsBusy = false;
      });
    }
  }

  Future<void> _runEnvelope() async {
    final jobId = _result?.jobId;
    if (jobId == null) return;
    setState(() {
      _envelopeBusy = true;
      _envelopeError = null;
      _croppedImageSize = null;
    });
    try {
      final result = await _envelopeService.runEnvelope(jobId);
      Size? croppedSize;
      if (result.buildingEnvelope != null) {
        croppedSize = await _decodeCroppedImageSize();
      }
      if (!mounted) return;
      setState(() {
        _envelopeResult = result;
        _croppedImageSize = croppedSize;
        _envelopeBusy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _envelopeError = e.toString();
        _envelopeBusy = false;
      });
    }
  }

  // Re-decodes and re-encodes the picked file's bytes purely for on-screen
  // display, using the exact same pure-Dart `image` package pipeline that
  // client_side_crop.dart already uses successfully for the crop (proven
  // working on-device — session 21 confirmed this fixed the earlier
  // "Could not decompress image" display bug, see claude/52). The file
  // sent to Stage 0 (_originalFile) is never touched by this — only what
  // gets shown in the "Original image" preview below.
  Future<void> _prepareOriginalDisplayBytes() async {
    try {
      final raw = await _originalFile!.readAsBytes();
      final headHex = raw
          .take(16)
          .map((b) => b.toRadixString(16).padLeft(2, '0'))
          .join(' ');
      debugPrint(
        '[sketch-debug] original file: ${raw.length} bytes, '
        'first 16 bytes: $headHex',
      );

      final decoded = img.decodeImage(raw);
      if (decoded == null) {
        debugPrint(
          '[sketch-debug] img.decodeImage returned null — the `image` '
          'package could not decode this file either.',
        );
        if (!mounted) return;
        setState(() {
          _originalDisplayError =
              'image package could not decode this file either '
              '(${raw.length} bytes, starts with $headHex)';
        });
        return;
      }

      final reencoded =
          Uint8List.fromList(img.encodeJpg(decoded, quality: 92));
      if (!mounted) return;
      setState(() {
        _originalDisplayBytes = reencoded;
      });
    } catch (e, st) {
      debugPrint('[sketch-debug] decode/re-encode for display threw: $e\n$st');
      if (!mounted) return;
      setState(() {
        _originalDisplayError = 'decode/re-encode threw: $e';
      });
    }
  }

  // Decodes the cropped file's pixel dimensions, purely so the envelope
  // overlay (below) can be sized in an AspectRatio box that exactly
  // matches the cropped image's own proportions.
  Future<Size?> _decodeCroppedImageSize() async {
    final file = _croppedFile;
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    final decoded = img.decodeImage(bytes);
    if (decoded == null) return null;
    return Size(decoded.width.toDouble(), decoded.height.toDouble());
  }

  String _formatChain(DimensionChain c) {
    final segmentsText = c.segments.map((s) => s.text).join(' + ');
    final overall = c.overallValueM != null
        ? ' = ${c.overallText ?? c.overallValueM!.toStringAsFixed(2)}'
        : ' (אין מספר-סיכום כתוב, סה"כ מחושב: ${c.resolvedTotalM.toStringAsFixed(2)} מ\')';
    return '${c.location} (${c.axis}): $segmentsText$overall — ביטחון: ${c.confidence}';
  }

  // session 23: DimensionEvidence — the model only transcribes/classifies
  // individual measurements now; no referenceType "overall" concept and
  // no per-measurement unitEvidence (there's a page-wide convention
  // instead — see _formatConvention below).
  String _formatMeasurement(DimensionEvidence m) {
    final numeric = m.rawNumeric != null ? m.rawNumeric!.toStringAsFixed(2) : '?';
    final line = (m.lineStartPct != null && m.lineEndPct != null)
        ? 'קו: (${m.lineStartPct!.xPct.toStringAsFixed(0)},${m.lineStartPct!.yPct.toStringAsFixed(0)})'
            '→(${m.lineEndPct!.xPct.toStringAsFixed(0)},${m.lineEndPct!.yPct.toStringAsFixed(0)})'
        : 'קו: לא זוהה';
    return '[${m.id}] (${m.referenceTypeHint}/${m.axis}): "${m.rawText}" '
        '= $numeric ${m.unit} — $line — ביטחון: ${m.confidence}';
  }

  // session 23: chains are built entirely in code from measurement
  // geometry (dimension_chain_builder_v3.ts) — isOverallCandidate is a
  // geometric fact (span coverage vs. the full cropped page), never a
  // model decision.
  String _formatBuiltChain(BuiltDimensionChain c, List<DimensionEvidence> allMeasurements) {
    final byId = {for (final m in allMeasurements) m.id: m};
    final membersText =
        c.measurementIds.map((id) => byId[id]?.rawText ?? '?($id)').join(' + ');
    final candidateLabel = c.isOverallCandidate
        ? '✓ מועמד-מעטפת (coverage ${c.coveragePct.toStringAsFixed(0)}%)'
        : 'קטע מקומי (coverage ${c.coveragePct.toStringAsFixed(0)}%)';
    return '[${c.id}] ${c.axis} — $candidateLabel — דומיננטי: ${c.dominantReferenceTypeHint}\n'
        '    חברים: $membersText\n'
        '    span: [${c.spanStartPct.toStringAsFixed(1)}, ${c.spanEndPct.toStringAsFixed(1)}] '
        '(${c.usedLineEndpointsCount}/${c.measurementIds.length} עם קו מזוהה)';
  }

  String _formatConvention(DocumentMeasurementConvention conv) {
    final evidence = conv.evidence.isNotEmpty ? '\n    ${conv.evidence.join('\n    ')}' : '';
    return 'קונבנציית יחידות שזוהתה: ${conv.detectedUnit} (ביטחון ${conv.confidence})$evidence';
  }

  String _formatResolvedExtent(String labelHe, ResolvedExtentV3 res) {
    final statusLabel = switch (res.status) {
      'resolved' => 'נפתרה',
      'conflict' => '⚠️ סתירה — לא נעשה שימוש באף מספר',
      'missing' => 'לא נמצאה שרשרת-מעטפת (geometry)',
      'unresolved' => 'נמצאה שרשרת-מעטפת אך לא ניתן היה להמיר ליחידות',
      _ => res.status,
    };
    final value = res.valueM != null ? '${res.valueM!.toStringAsFixed(2)} מ\'' : '—';
    final diag = res.diagnostics.isNotEmpty ? '\n    ${res.diagnostics.join('\n    ')}' : '';
    return '$labelHe: $value ($statusLabel, ביטחון ${res.confidence})$diag';
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final measurementsResult = _measurementsResult;
    final envelopeResult = _envelopeResult;
    final pageDimensionsResult = _pageDimensionsResult;
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Stage 0/1/0.5/1 debug — Scope+Crop / PageDimensions(v3-geometry) / Measurements / Envelope',
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ElevatedButton(
              onPressed: _busy ? null : _pickAndRun,
              child: Text(_busy ? 'Running...' : 'Pick image & run Stage 0'),
            ),
            if (result != null) ...[
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy ? null : _retry,
                child: const Text('Retry Stage 0 on same image'),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text('Error: $_error', style: const TextStyle(color: Colors.red)),
            ],
            if (_originalFile != null) ...[
              const SizedBox(height: 16),
              const Text('Original image:'),
              if (_originalDisplayBytes != null)
                Image.memory(
                  _originalDisplayBytes!,
                  errorBuilder: (context, error, stackTrace) {
                    debugPrint(
                      '[sketch-debug] Image.memory render of re-encoded '
                      'bytes failed: $error',
                    );
                    return Text(
                      'Could not RENDER the re-encoded original image '
                      '(decode+encode both succeeded): $error',
                      style: const TextStyle(color: Colors.red),
                    );
                  },
                )
              else if (_originalDisplayError != null)
                Text(
                  'Could not prepare original image preview: '
                  '$_originalDisplayError',
                  style: const TextStyle(color: Colors.red),
                )
              else
                const Text('Preparing preview...'),
            ],
            if (result != null) ...[
              const SizedBox(height: 16),
              Text('jobId: ${result.jobId}'),
              Text('attempt: ${result.attempt}'),
              Text('durationMs: ${result.durationMs}'),
              Text('scopeConfidence: ${result.scopeConfidence}'),
              Text(
                'mainFloorPlanBboxPct: x ${result.mainFloorPlanBboxPct.xMinPct}-'
                '${result.mainFloorPlanBboxPct.xMaxPct}, '
                'y ${result.mainFloorPlanBboxPct.yMinPct}-'
                '${result.mainFloorPlanBboxPct.yMaxPct}',
              ),
              if (result.excludedRegions.isEmpty)
                const Text('excludedRegions: none')
              else
                for (final region in result.excludedRegions)
                  Text(
                    'excluded: x ${region.bboxPct.xMinPct}-'
                    '${region.bboxPct.xMaxPct}, y '
                    '${region.bboxPct.yMinPct}-${region.bboxPct.yMaxPct} '
                    '(${region.reason})',
                  ),
            ],
            if (_croppedFile != null) ...[
              const SizedBox(height: 16),
              const Text('Cropped result (client-side crop from the bbox above):'),
              Image.file(_croppedFile!),
            ],

            // --- Pass 1 (page dimensions) — NEW, session 22, rebuilt ----
            // around "Patch 01: Measurement Integrity". Independent of
            // Pass 0.5/Stage 1 below — only needs Stage 0's crop. Reads
            // raw measurement evidence for EVERY printed dimension on the
            // page and resolves axis extents in code — a real
            // disagreement between chains is reported as a conflict,
            // never silently averaged.
            if (_croppedFile != null) ...[
              const Divider(height: 32),
              const Text(
                'Pass 1 — Page Dimensions (session 23: קוד בונה שרשראות מגיאומטריה, לא ה-AI)',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 4),
              const Text(
                'עצמאי לגמרי מ-Pass 0.5/Stage 1 למטה — ה-AI מחזיר רק מידות '
                'בודדות (בלי המרת-יחידות/סיכום/קיבוץ). הקוד בונה שרשראות '
                'לפי מיקום גיאומטרי ומחליט איזו שרשרת מכסה את כל רוחב/גובה '
                'העמוד (מועמדת-מעטפת) — ה-AI לא מחליט מה "כולל". אם '
                'שרשראות-מעטפת סותרות זו את זו — מוצגת סתירה, לא ממוצע.',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: _pageDimensionsBusy ? null : _runPageDimensions,
                child: Text(
                  _pageDimensionsBusy
                      ? 'Running...'
                      : 'Run Pass 1 (Page Dimensions)',
                ),
              ),
              if (_pageDimensionsError != null) ...[
                const SizedBox(height: 16),
                Text(
                  'Error: $_pageDimensionsError',
                  style: const TextStyle(color: Colors.red),
                ),
              ],
              if (_uploadedStripBboxes.isNotEmpty)
                Text(
                  'dimension strips מוכנות לשליחה: ${_uploadedStripBboxes.keys.join(", ")}',
                  style: const TextStyle(fontSize: 12, color: Colors.black54),
                ),
              if (pageDimensionsResult != null) ...[
                const SizedBox(height: 16),
                Text('page-dimensions attempt: ${pageDimensionsResult.attempt}'),
                Text('page-dimensions durationMs: ${pageDimensionsResult.durationMs}'),
                if (pageDimensionsResult.notes.isNotEmpty)
                  Text('notes: ${pageDimensionsResult.notes}'),
                Text(
                  pageDimensionsResult.stripsUsed.isEmpty
                      ? 'stripsUsed: none (הריצה הזו התבססה רק על הדף/crop המלא)'
                      : 'stripsUsed: ${pageDimensionsResult.stripsUsed.join(", ")}',
                  style: const TextStyle(fontSize: 12),
                ),
                if (pageDimensionsResult.stripDiagnostics.isNotEmpty)
                  Text(
                    'stripDiagnostics:\n    ${pageDimensionsResult.stripDiagnostics.join('\n    ')}',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                const SizedBox(height: 8),
                Text(
                  'סה"כ: ${pageDimensionsResult.measurements.length} מידות גולמיות, '
                  '${pageDimensionsResult.builtChains.length} שרשראות (בנויות בקוד)',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  _formatConvention(pageDimensionsResult.convention),
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                ),
                const SizedBox(height: 8),
                Text(
                  'מידות מעטפת שנפתרו בקוד (geometry-gated, never-average):',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                ),
                Text(
                  '${_formatResolvedExtent("ציר אופקי", pageDimensionsResult.horizontalExtent)}\n'
                  '${_formatResolvedExtent("ציר אנכי", pageDimensionsResult.verticalExtent)}',
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                ),
                const SizedBox(height: 8),
                if (pageDimensionsResult.builtChains.isEmpty)
                  const Text('chains: none', style: TextStyle(color: Colors.orange))
                else ...[
                  const Text(
                    'chains (built by code from geometry, not by the model):',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    pageDimensionsResult.builtChains
                        .map((c) => _formatBuiltChain(c, pageDimensionsResult.measurements))
                        .join('\n'),
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                  ),
                ],
                const SizedBox(height: 8),
                if (pageDimensionsResult.measurements.isEmpty)
                  const Text('measurements: none', style: TextStyle(color: Colors.orange))
                else ...[
                  const Text(
                    'measurements (raw evidence, as extracted):',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    pageDimensionsResult.measurements.map(_formatMeasurement).join('\n'),
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                  ),
                ],
              ],
            ],

            // --- Pass 0.5 (measurements) --------------------------------
            if (_croppedFile != null) ...[
              const Divider(height: 32),
              const Text(
                'Pass 0.5 — Measurements (NEW: must run before Stage 1)',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 4),
              const Text(
                'קורא ומתעד אך ורק את המספרים הכתובים בתמונה על ההיקף '
                'החיצוני — לא מצייר ולא מחשב שום צורה. Stage 1 למטה ישתמש '
                'במספרים האלה כ"עובדה קבועה" ולא ינסה לקרוא אותם שוב '
                'בעצמו.',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: _measurementsBusy ? null : _runMeasurements,
                child: Text(
                  _measurementsBusy
                      ? 'Running...'
                      : 'Run Pass 0.5 (Measurements)',
                ),
              ),
              if (_measurementsError != null) ...[
                const SizedBox(height: 16),
                Text(
                  'Error: $_measurementsError',
                  style: const TextStyle(color: Colors.red),
                ),
              ],
              if (measurementsResult != null) ...[
                const SizedBox(height: 16),
                Text('measurements attempt: ${measurementsResult.attempt}'),
                Text('measurements durationMs: ${measurementsResult.durationMs}'),
                if (measurementsResult.notes.isNotEmpty)
                  Text('notes: ${measurementsResult.notes}'),
                const SizedBox(height: 8),
                if (measurementsResult.chains.isEmpty)
                  const Text(
                    'chains: none — לא נמצאה שום מידה כתובה קריאה בתמונה '
                    'הזו על ההיקף החיצוני (תשובה כנה, לא שגיאה). Stage 1 '
                    'יסתמך רק על הערכת-פרופורציה, וה-confidence שלו יהיה '
                    'נמוך.',
                    style: TextStyle(color: Colors.orange),
                  )
                else ...[
                  const Text(
                    'chains (raw, as extracted — this is what Stage 1 will '
                    'treat as authoritative):',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    measurementsResult.chains.map(_formatChain).join('\n'),
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                  ),
                ],
              ],
            ],

            // --- Stage 1 (envelope) -------------------------------------
            if (_croppedFile != null) ...[
              const Divider(height: 32),
              const Text(
                'Stage 1 — Envelope',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 8),
              if (measurementsResult == null)
                const Text(
                  'הרץ קודם את Pass 0.5 (למעלה) — Stage 1 דורש את זה '
                  'ויכשל אחרת.',
                  style: TextStyle(fontSize: 12, color: Colors.orange),
                ),
              const SizedBox(height: 4),
              ElevatedButton(
                onPressed: (_envelopeBusy || measurementsResult == null)
                    ? null
                    : _runEnvelope,
                child: Text(
                  _envelopeBusy ? 'Running...' : 'Run Stage 1 (Envelope)',
                ),
              ),
              if (_envelopeError != null) ...[
                const SizedBox(height: 16),
                Text(
                  'Error: $_envelopeError',
                  style: const TextStyle(color: Colors.red),
                ),
              ],
              if (envelopeResult != null) ...[
                const SizedBox(height: 16),
                Text('envelope attempt: ${envelopeResult.attempt}'),
                Text('envelope durationMs: ${envelopeResult.durationMs}'),
                Text(
                  'confidence (מחושב בקוד): ${envelopeResult.confidence}   '
                  '(מה שה-AI עצמו דיווח: '
                  '${envelopeResult.modelReportedConfidence ?? "לא נקרא בכלל — ראה/י status למטה"})',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                if (envelopeResult.isBlocked) ...[
                  const SizedBox(height: 4),
                  const Text(
                    '⛔ status: blocked — מודל ה-Envelope לא נקרא כלל '
                    '(session 23, follow-up #2: hard gate — geometry ללא '
                    'שני scales סמכותיים אסורה).',
                    style: TextStyle(fontWeight: FontWeight.bold, color: Colors.red),
                  ),
                  for (final reason in envelopeResult.blockedReasons)
                    Text('  • $reason', style: const TextStyle(fontSize: 12, color: Colors.red)),
                ],
                const SizedBox(height: 8),
                Text(
                  'מידות שנמצאו ושימשו לבדיקה: '
                  'רוחב ${envelopeResult.measurementsUsed.horizontalM?.toStringAsFixed(2) ?? "לא נמצא"} מ\' '
                  '(${envelopeResult.measurementsUsed.horizontalConfidence ?? "-"})'
                  ' | גובה ${envelopeResult.measurementsUsed.verticalM?.toStringAsFixed(2) ?? "לא נמצא"} מ\' '
                  '(${envelopeResult.measurementsUsed.verticalConfidence ?? "-"})'
                  ' | ${envelopeResult.measurementsUsed.chainsCount} שרשראות-מידה',
                  style: const TextStyle(fontSize: 12),
                ),
                Text(
                  'בדיקת-התאמה: '
                  '${envelopeResult.validation.retried ? "בוצע ניסיון-תיקון" : "לא נדרש ניסיון-תיקון"}'
                  ' | ${envelopeResult.validation.codeOverrodeGeometry ? "הצורה הוחלפה בחישוב-קוד מדויק" : "הצורה נשארה כפי שה-AI קבע (אחרי בדיקה)"}'
                  '${envelopeResult.validation.horizontalErrorPct != null ? " | סטיית-רוחב: ${envelopeResult.validation.horizontalErrorPct!.toStringAsFixed(1)}%" : ""}'
                  '${envelopeResult.validation.verticalErrorPct != null ? " | סטיית-גובה: ${envelopeResult.validation.verticalErrorPct!.toStringAsFixed(1)}%" : ""}',
                  style: const TextStyle(fontSize: 12),
                ),
                if (envelopeResult.notes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('notes: ${envelopeResult.notes}'),
                ],
                const SizedBox(height: 12),
                if (envelopeResult.buildingEnvelope == null)
                  Text(
                    envelopeResult.isBlocked
                        ? 'buildingEnvelope: null — Stage 1 נחסם לפני שהמודל '
                            'נקרא בכלל (ראה/י blockedReasons למעלה). זו לא '
                            'תשובה של המודל, ולא ניחוש — אין עדיין שתי מידות '
                            'סמכותיות (אופקי+אנכי) לבנות עליהן גיאומטריה.'
                        : 'buildingEnvelope: null — המודל דיווח שלא הצליח לעקוב '
                            'אחרי מעטפת רציפה שלמה בתמונה הזו (תשובה כנה, לא שגיאה).',
                    style: const TextStyle(color: Colors.orange),
                  )
                else ...[
                  const Text(
                    'הקו האדום המקווקו הוא התאמת-פרופורציות בלבד: המודל '
                    'מחזיר קואורדינטות אדריכליות (מטרים), לא פיקסלים '
                    'בתמונה, אז הקו נמתח כדי להתאים לגבולות התמונה תוך '
                    'שמירה על הצורה/היחסים בין הקודקודים — זה בודק אם '
                    'הצורה הכללית נכונה, לא מיקום מדויק פיקסל-לפיקסל. גם '
                    'הכיוון/הסיבוב לא מובטחים להתאים לתמונה.',
                    style: TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'vertices (raw, meters, as returned — this is the '
                    'number list, not the drawing above):',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    envelopeResult.buildingEnvelope!
                        .asMap()
                        .entries
                        .map((e) =>
                            '#${e.key}: (${e.value.x.toStringAsFixed(2)}, '
                            '${e.value.y.toStringAsFixed(2)})')
                        .join('\n'),
                    style: const TextStyle(
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_croppedImageSize == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else
                    AspectRatio(
                      aspectRatio:
                          _croppedImageSize!.width / _croppedImageSize!.height,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Image.file(_croppedFile!, fit: BoxFit.fill),
                          CustomPaint(
                            painter: EnvelopeOverlayPainter(
                              envelopeResult.buildingEnvelope!,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ],
          ],
        ),
      ),
    );
  }
}

// lib/features/sketch_analysis_v2_debug/presentation/sketch_scope_debug_screen.dart
//
// Debug-only screen for the new staged sketch-analysis pipeline (session
// 20-21). NOT linked from app_router.dart or any real user-facing
// navigation, and not exported/used by any existing screen — reach it
// only by temporarily wiring a route to it yourself while testing (e.g. a
// throwaway GoRoute, or pushing it directly with Navigator from a debug
// button), then remove that link when done.
//
// Now covers THREE stages of the pipeline:
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
import '../data/sketch_envelope_service.dart';
import '../data/sketch_measurements_service.dart';
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

  File? _originalFile;
  File? _croppedFile;
  ScopeResult? _result;
  String? _error;
  bool _busy = false;

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
    });
    await _runAndCrop(() => _service.retryScope(jobId));
  }

  Future<void> _runAndCrop(Future<ScopeResult> Function() call) async {
    try {
      final result = await call();
      final cropped =
          await cropImageToBboxPct(_originalFile!, result.mainFloorPlanBboxPct);
      await _service.uploadCrop(cropped, result.jobId);
      if (!mounted) return;
      setState(() {
        _result = result;
        _croppedFile = cropped;
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

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final measurementsResult = _measurementsResult;
    final envelopeResult = _envelopeResult;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Stage 0/0.5/1 debug — Scope+Crop / Measurements / Envelope'),
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
                  '(מה שה-AI עצמו דיווח: ${envelopeResult.modelReportedConfidence})',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
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
                  const Text(
                    'buildingEnvelope: null — המודל דיווח שלא הצליח לעקוב '
                    'אחרי מעטפת רציפה שלמה בתמונה הזו (תשובה כנה, לא שגיאה).',
                    style: TextStyle(color: Colors.orange),
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

// lib/features/sketch_analysis_v2_debug/presentation/sketch_scope_debug_screen.dart
//
// Debug-only screen for Stage 0 ("scope") of the new staged sketch-
// analysis pipeline (session 20). NOT linked from app_router.dart or any
// real user-facing navigation, and not exported/used by any existing
// screen — reach it only by temporarily wiring a route to it yourself
// while testing (e.g. a throwaway GoRoute, or pushing it directly with
// Navigator from a debug button), then remove that link when done. Purpose
// is exactly what Yaron asked for: pick a real floor-plan photo, run
// Stage 0, and see everything needed to judge the result — original
// image, the bbox drawn as numbers, excluded regions, the actual crop,
// confidence, run duration, and attempt count — before any later stage
// (envelope/rooms/etc.) gets built.
//
// Session 20 (continued, round 3 of the "Original image" display bug):
// two earlier fix attempts (Image.memory + errorBuilder; then re-encoding
// the bytes for display with the `image` package) both reportedly showed
// "the exact same thing" — but neither attempt's code ever made it into
// git, so we cannot know for certain what was actually running on the
// device at the time. This version is a fresh, from-scratch rewrite of
// the original-image preview, built to be maximally diagnostic rather
// than just "try a different approach again": it separates the three
// places this could actually be failing (our own decode of the raw
// bytes; our own re-encode; Flutter's Image.memory actually rendering
// clean re-encoded bytes) and prints details of each to the debug
// console via debugPrint, so whichever one fails, the log makes it
// obvious which.

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/client_side_crop.dart';
import '../data/sketch_scope_service.dart';

class SketchScopeDebugScreen extends StatefulWidget {
  const SketchScopeDebugScreen({super.key});

  @override
  State<SketchScopeDebugScreen> createState() =>
      _SketchScopeDebugScreenState();
}

class _SketchScopeDebugScreenState extends State<SketchScopeDebugScreen> {
  late final SketchScopeService _service =
      SketchScopeService(Supabase.instance.client);

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

  // Re-decodes and re-encodes the picked file's bytes purely for on-screen
  // display, using the exact same pure-Dart `image` package pipeline that
  // client_side_crop.dart already uses successfully for the crop (proven
  // working on-device, twice, on two different source files). The file
  // sent to Stage 0 (_originalFile) is never touched by this — only what
  // gets shown in the "Original image" preview below.
  //
  // Split into three separately-logged steps on purpose, so whichever one
  // is the real culprit is unambiguous in `flutter run`'s console output:
  //   1) img.decodeImage on the raw bytes exactly as picked
  //   2) img.encodeJpg to produce a clean, standard JPEG
  //   3) Image.memory actually rendering those clean bytes (its own
  //      errorBuilder below covers this one)
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
          'package could not decode this file either. This is not a '
          'display-only bug, the file itself is not a format it recognizes.',
        );
        if (!mounted) return;
        setState(() {
          _originalDisplayError =
              'image package could not decode this file either '
              '(${raw.length} bytes, starts with $headHex)';
        });
        return;
      }
      debugPrint(
        '[sketch-debug] img.decodeImage OK: ${decoded.width}x'
        '${decoded.height}, hasAlpha=${decoded.hasAlpha}',
      );

      final reencoded =
          Uint8List.fromList(img.encodeJpg(decoded, quality: 92));
      debugPrint(
        '[sketch-debug] img.encodeJpg OK: ${reencoded.length} bytes, '
        'handing to Image.memory now',
      );

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

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Scaffold(
      appBar: AppBar(title: const Text('Stage 0 debug — Scope + Crop')),
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
          ],
        ),
      ),
    );
  }
}

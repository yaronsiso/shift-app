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

import 'dart:io';

import 'package:flutter/material.dart';
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

  Future<void> _pickAndRun() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked == null) return;

    setState(() {
      _busy = true;
      _error = null;
      _result = null;
      _croppedFile = null;
      _originalFile = File(picked.path);
    });

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
              Image.file(_originalFile!),
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

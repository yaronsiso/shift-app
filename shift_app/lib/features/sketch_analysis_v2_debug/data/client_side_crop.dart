// lib/features/sketch_analysis_v2_debug/data/client_side_crop.dart
//
// Pure-Dart crop from a percentage bounding box (Stage 0's
// mainFloorPlanBboxPct), using the `image` package — the ONE new pubspec
// dependency this step needs (image: ^4.9.2, current stable as of session
// 20 — verified on pub.dev before writing this). Crop runs entirely
// on-device; the Edge Function never touches image bytes for cropping,
// which is exactly what avoids the Deno image-processing dependency risk
// documented in claude/49/50 (magick-wasm etc.) — Flutter already holds
// the image, so it does the crop.

import 'dart:io';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import 'sketch_scope_service.dart';

/// Crops [sourceFile] to the rectangle described by [bbox] (percentages,
/// 0-100, origin top-left — matches the Edge Function's own coordinate
/// convention exactly, see SCOPE_SYSTEM_PROMPT) and writes the result as a
/// new JPEG file next to the source file. Returns that new file.
Future<File> cropImageToBboxPct(File sourceFile, BboxPct bbox) async {
  final bytes = await sourceFile.readAsBytes();
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw StateError('could not decode image for cropping');
  }

  final x = (bbox.xMinPct / 100 * decoded.width)
      .round()
      .clamp(0, decoded.width - 1);
  final y = (bbox.yMinPct / 100 * decoded.height)
      .round()
      .clamp(0, decoded.height - 1);
  final w = ((bbox.xMaxPct - bbox.xMinPct) / 100 * decoded.width)
      .round()
      .clamp(1, decoded.width - x);
  final h = ((bbox.yMaxPct - bbox.yMinPct) / 100 * decoded.height)
      .round()
      .clamp(1, decoded.height - y);

  final cropped = img.copyCrop(decoded, x: x, y: y, width: w, height: h);
  final Uint8List jpgBytes =
      Uint8List.fromList(img.encodeJpg(cropped, quality: 92));

  final outFile = File(
    '${sourceFile.parent.path}/scope_crop_${DateTime.now().millisecondsSinceEpoch}.jpg',
  );
  await outFile.writeAsBytes(jpgBytes);
  return outFile;
}

// lib/features/sketch_analysis_v2_debug/data/dimension_strips.dart
//
// Session 23, follow-up #2 ("dimension strips"). Client-side crop of up to
// four extra, tightly-zoomed strip images — top/bottom/left/right — taken
// from just outside each edge of Stage 0's main-floor-plan bbox, cut from
// the ORIGINAL full-resolution photo (not the already-downscaled main
// crop). This gives Pass 1 a clear, high-resolution, uncluttered look at
// exactly the region an outer dimension line sits in — built after a real
// drawing's vertical overall dimension ("1099") kept getting missed in the
// single full-page image, even after prompt tweaks.
//
// Mirrors client_side_crop.dart's approach exactly (same `image` package,
// same crop-from-percent-bbox math) — this file only adds the padding/
// 4-strip layout logic on top. Each strip's own bbox (in the ORIGINAL
// image's percentage space) is returned alongside the cropped file — the
// caller must send it to the server (SketchPageDimensionsService.
// runPageDimensions's stripBboxes argument), since the server needs it to
// remap that strip's measurements back into the main crop's coordinate
// space (see ../../../supabase/functions/_shared/
// dimension_measurement_merge_v3.ts).

import 'dart:io';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import 'sketch_scope_service.dart';

/// How far OUTWARD (beyond the main bbox's own edge) each strip extends,
/// in percentage points of the ORIGINAL image — generous enough to catch a
/// dimension line/number that sits just outside a tight Stage 0 bbox.
const double kStripOuterPadPct = 10;

/// How far INWARD (back into the main bbox) each strip extends, purely for
/// overlap/context — not meant to re-cover most of the floor plan itself.
const double kStripInnerPadPct = 6;

double _clampPct(double v) => v < 0 ? 0 : (v > 100 ? 100 : v);

BboxPct _stripBbox({
  required BboxPct mainBbox,
  required bool isVertical, // true for left/right (band runs along y), false for top/bottom (band runs along x)
  required bool isMaxEdge, // true for bottom/right (the max-side edge), false for top/left
}) {
  if (isVertical) {
    final xMin = isMaxEdge ? mainBbox.xMaxPct - kStripInnerPadPct : mainBbox.xMinPct - kStripOuterPadPct;
    final xMax = isMaxEdge ? mainBbox.xMaxPct + kStripOuterPadPct : mainBbox.xMinPct + kStripInnerPadPct;
    return BboxPct(
      xMinPct: _clampPct(xMin),
      xMaxPct: _clampPct(xMax),
      yMinPct: _clampPct(mainBbox.yMinPct - kStripOuterPadPct),
      yMaxPct: _clampPct(mainBbox.yMaxPct + kStripOuterPadPct),
    );
  }
  final yMin = isMaxEdge ? mainBbox.yMaxPct - kStripInnerPadPct : mainBbox.yMinPct - kStripOuterPadPct;
  final yMax = isMaxEdge ? mainBbox.yMaxPct + kStripOuterPadPct : mainBbox.yMinPct + kStripInnerPadPct;
  return BboxPct(
    xMinPct: _clampPct(mainBbox.xMinPct - kStripOuterPadPct),
    xMaxPct: _clampPct(mainBbox.xMaxPct + kStripOuterPadPct),
    yMinPct: _clampPct(yMin),
    yMaxPct: _clampPct(yMax),
  );
}

/// The four strip bboxes (top/bottom/left/right), in the ORIGINAL image's
/// own percentage space, derived from Stage 0's mainFloorPlanBboxPct.
Map<String, BboxPct> computeStripBboxes(BboxPct mainBbox) => {
      'top': _stripBbox(mainBbox: mainBbox, isVertical: false, isMaxEdge: false),
      'bottom': _stripBbox(mainBbox: mainBbox, isVertical: false, isMaxEdge: true),
      'left': _stripBbox(mainBbox: mainBbox, isVertical: true, isMaxEdge: false),
      'right': _stripBbox(mainBbox: mainBbox, isVertical: true, isMaxEdge: true),
    };

/// Crops [sourceFile] (the ORIGINAL, full-resolution image — the same file
/// Stage 0 itself ran on) to each of the strip rectangles in
/// [stripBboxes], writing each as its own JPEG file next to the source
/// file. A degenerate strip (near-zero width/height, e.g. from an extreme
/// bbox at the very edge of the image) is silently skipped — best-effort,
/// matching this feature's overall "strips are additive, never required"
/// design (see analyze-sketch-v2-page-dimensions/index.ts's file header).
Future<Map<String, File>> cropDimensionStrips(
  File sourceFile,
  Map<String, BboxPct> stripBboxes,
) async {
  final bytes = await sourceFile.readAsBytes();
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw StateError('could not decode image for strip cropping');
  }

  final result = <String, File>{};
  for (final entry in stripBboxes.entries) {
    final bbox = entry.value;
    final x = (bbox.xMinPct / 100 * decoded.width).round().clamp(0, decoded.width - 1);
    final y = (bbox.yMinPct / 100 * decoded.height).round().clamp(0, decoded.height - 1);
    final w = ((bbox.xMaxPct - bbox.xMinPct) / 100 * decoded.width).round().clamp(1, decoded.width - x);
    final h = ((bbox.yMaxPct - bbox.yMinPct) / 100 * decoded.height).round().clamp(1, decoded.height - y);
    if (w < 8 || h < 8) {
      continue;
    }

    final cropped = img.copyCrop(decoded, x: x, y: y, width: w, height: h);
    final Uint8List jpgBytes = Uint8List.fromList(img.encodeJpg(cropped, quality: 92));

    final outFile = File(
      '${sourceFile.parent.path}/strip_${entry.key}_${DateTime.now().millisecondsSinceEpoch}.jpg',
    );
    await outFile.writeAsBytes(jpgBytes);
    result[entry.key] = outFile;
  }
  return result;
}

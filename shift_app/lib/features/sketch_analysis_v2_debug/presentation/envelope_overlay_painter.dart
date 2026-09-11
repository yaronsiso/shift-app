// lib/features/sketch_analysis_v2_debug/presentation/envelope_overlay_painter.dart
//
// Draws Stage 1's buildingEnvelope polygon as a best-fit-to-bounds dashed
// outline. See sketch_envelope_service.dart's file header for why this is
// necessarily an approximation (the model's vertices are architectural
// meters, not image pixels/percentages) rather than a precise trace —
// this painter fits the polygon's own bounding box to the canvas
// (typically the cropped image's own bounds, via an AspectRatio wrapper
// in the debug screen), preserving the polygon's proportions, nothing
// more. Orientation (which way is "up", mirroring) is not guaranteed to
// match the photo either, since the model was never asked to align its
// output to image pixel space.

import 'package:flutter/material.dart';

import '../data/sketch_envelope_service.dart';

class EnvelopeOverlayPainter extends CustomPainter {
  final List<EnvelopePoint> vertices;

  EnvelopeOverlayPainter(this.vertices);

  @override
  void paint(Canvas canvas, Size size) {
    if (vertices.length < 3 || size.width <= 0 || size.height <= 0) return;

    double minX = vertices.first.x, maxX = vertices.first.x;
    double minY = vertices.first.y, maxY = vertices.first.y;
    for (final v in vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    final spanX = maxX - minX;
    final spanY = maxY - minY;
    if (spanX <= 0 || spanY <= 0) return; // degenerate polygon, nothing sane to draw

    Offset toCanvasPoint(EnvelopePoint p) {
      final nx = (p.x - minX) / spanX;
      final ny = (p.y - minY) / spanY;
      return Offset(nx * size.width, ny * size.height);
    }

    final path = Path()..moveTo(toCanvasPoint(vertices.first).dx, toCanvasPoint(vertices.first).dy);
    for (final v in vertices.skip(1)) {
      final p = toCanvasPoint(v);
      path.lineTo(p.dx, p.dy);
    }
    path.close();

    final fillPaint = Paint()
      ..color = const Color(0x33FF3B30)
      ..style = PaintingStyle.fill;
    canvas.drawPath(path, fillPaint);

    final strokePaint = Paint()
      ..color = const Color(0xFFFF3B30)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    _drawDashedPath(canvas, path, strokePaint);

    // Mark each vertex with a small dot, so a corner that's clearly off
    // (versus just the overall proportions) is easy to point at.
    final dotPaint = Paint()..color = const Color(0xFFFF3B30);
    for (final v in vertices) {
      canvas.drawCircle(toCanvasPoint(v), 5, dotPaint);
    }
  }

  void _drawDashedPath(Canvas canvas, Path path, Paint paint) {
    const dashWidth = 8.0;
    const dashGap = 5.0;
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      var draw = true;
      while (distance < metric.length) {
        final next = distance + (draw ? dashWidth : dashGap);
        if (draw) {
          final end = next > metric.length ? metric.length : next;
          canvas.drawPath(
            metric.extractPath(distance, end),
            paint,
          );
        }
        distance = next;
        draw = !draw;
      }
    }
  }

  @override
  bool shouldRepaint(covariant EnvelopeOverlayPainter oldDelegate) =>
      oldDelegate.vertices != vertices;
}

import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

/// The Meridian "M" mark — the same zig-zag glyph the web renders in its SVG
/// (`M7 23V10l5 7 4-9 4 9 5-7v13`), on a rounded teal tile.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 40, this.tile = true});

  final double size;
  final bool tile;

  @override
  Widget build(BuildContext context) {
    final glyph = CustomPaint(
      size: Size(size * 0.6, size * 0.6),
      painter: _MPainter(color: tile ? Colors.white : AppColors.brand),
    );
    if (!tile) return glyph;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.brand,
        borderRadius: BorderRadius.circular(size * 0.26),
      ),
      alignment: Alignment.center,
      child: glyph,
    );
  }
}

class _MPainter extends CustomPainter {
  _MPainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 32; // path authored in a 32x32 viewBox
    final p = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6 * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(7 * s, 23 * s)
      ..lineTo(7 * s, 10 * s)
      ..lineTo(12 * s, 17 * s)
      ..lineTo(16 * s, 8 * s)
      ..lineTo(20 * s, 17 * s)
      ..lineTo(25 * s, 10 * s)
      ..lineTo(25 * s, 23 * s);
    canvas.drawPath(path, p);
  }

  @override
  bool shouldRepaint(covariant _MPainter old) => old.color != color;
}

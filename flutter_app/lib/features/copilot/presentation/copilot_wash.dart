import 'package:flutter/material.dart';

/// The Copilot chat wash — a direct port of the gradient stack on the web's
/// Copilot page (`client/src/pages/Copilot.tsx`).
///
/// This is deliberately NOT the shared ambient page tint: Copilot carries its
/// own pastel wash, from the same family as the login screen, spread so every
/// corner holds a different hue — blue top-left, lavender top-right, pink
/// bottom-right, mint bottom-left, over a soft blue→pink base.
///
/// CSS composes several gradients in one `background`; a Flutter BoxDecoration
/// takes a single gradient, so each layer is its own box in a Stack, painted in
/// the same order the CSS lists them (last CSS layer is the bottom-most, so the
/// base sits first here).
class CopilotWash extends StatelessWidget {
  const CopilotWash({super.key, required this.child});

  final Widget child;

  // linear-gradient(115deg, #f5f8ff 0%, #fdf2f8 55%, #f3f6ff 100%)
  static const _base = LinearGradient(
    begin: Alignment(-0.9, -0.42),
    end: Alignment(0.9, 0.42),
    colors: [Color(0xFFF5F8FF), Color(0xFFFDF2F8), Color(0xFFF3F6FF)],
    stops: [0, 0.55, 1],
  );

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(
          child: DecoratedBox(decoration: BoxDecoration(gradient: _base)),
        ),

        // radial-gradient(80% 60% at 8% 0%, rgba(147,197,253,0.42), transparent 60%)
        const _Corner(
          color: Color(0xFF93C5FD),
          center: Alignment(-0.84, -1),
          radius: 0.85,
          opacity: 0.42,
          fadeAt: 0.60,
        ),
        // radial-gradient(75% 65% at 100% 12%, rgba(196,181,253,0.38), transparent 62%)
        const _Corner(
          color: Color(0xFFC4B5FD),
          center: Alignment(1, -0.76),
          radius: 0.80,
          opacity: 0.38,
          fadeAt: 0.62,
        ),
        // radial-gradient(90% 70% at 92% 100%, rgba(249,168,212,0.42), transparent 64%)
        const _Corner(
          color: Color(0xFFF9A8D4),
          center: Alignment(0.84, 1),
          radius: 0.95,
          opacity: 0.42,
          fadeAt: 0.64,
        ),
        // radial-gradient(70% 55% at 0% 88%, rgba(153,246,228,0.34), transparent 60%)
        const _Corner(
          color: Color(0xFF99F6E4),
          center: Alignment(-1, 0.76),
          radius: 0.75,
          opacity: 0.34,
          fadeAt: 0.60,
        ),

        Positioned.fill(child: child),
      ],
    );
  }
}

/// One corner-anchored radial wash.
class _Corner extends StatelessWidget {
  const _Corner({
    required this.color,
    required this.center,
    required this.radius,
    required this.opacity,
    required this.fadeAt,
  });

  final Color color;
  final Alignment center;
  final double radius;
  final double opacity;

  /// Where the wash reaches fully transparent, as a fraction of the radius.
  final double fadeAt;

  @override
  Widget build(BuildContext context) {
    // SizedBox.expand, not a bare DecoratedBox: a decoration with no child
    // takes the smallest size its constraints allow, and Stack lays out
    // non-positioned children loosely — so without this it paints nothing.
    return SizedBox.expand(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: center,
            radius: radius,
            colors: [color.withValues(alpha: opacity), color.withValues(alpha: 0)],
            stops: [0, fadeAt],
          ),
        ),
      ),
    );
  }
}

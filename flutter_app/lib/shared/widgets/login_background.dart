import 'package:flutter/material.dart';

/// The web login page's soft pastel wash, ported 1:1 from the React Login
/// panel: a white→pale-blue→pale-pink diagonal base, with blue (top-right),
/// pink (bottom-right) and violet (right-centre) radial glows layered over it —
/// strongest at the edges, fading before they reach the form so inputs stay
/// crisp.
///
///   radial-gradient(90% 70% at 100% 12%, rgba(147,197,253,0.40), transparent 62%)
///   radial-gradient(85% 75% at 100% 88%, rgba(249,168,212,0.42), transparent 64%)
///   radial-gradient(60% 55% at 88% 50%, rgba(196,181,253,0.28), transparent 70%)
///   linear-gradient(115deg, #ffffff 42%, #f3f6ff 74%, #fdf0f7 100%)
class LoginBackground extends StatelessWidget {
  const LoginBackground({super.key, required this.child});

  final Widget child;

  static const List<Widget> _layers = [
    // Base diagonal wash: white → pale blue → pale pink.
    Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFFFFFFF), Color(0xFFF3F6FF), Color(0xFFFDF0F7)],
            stops: [0.42, 0.74, 1.0],
          ),
        ),
      ),
    ),
    // Blue glow — top-right.
    Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(1.0, -0.76),
            radius: 1.1,
            colors: [
              Color.fromRGBO(147, 197, 253, 0.40),
              Color.fromRGBO(147, 197, 253, 0.0),
            ],
            stops: [0.0, 0.62],
          ),
        ),
      ),
    ),
    // Pink glow — bottom-right.
    Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(1.0, 0.76),
            radius: 1.1,
            colors: [
              Color.fromRGBO(249, 168, 212, 0.42),
              Color.fromRGBO(249, 168, 212, 0.0),
            ],
            stops: [0.0, 0.64],
          ),
        ),
      ),
    ),
    // Violet glow — right-centre.
    Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.76, 0.0),
            radius: 0.9,
            colors: [
              Color.fromRGBO(196, 181, 253, 0.28),
              Color.fromRGBO(196, 181, 253, 0.0),
            ],
            stops: [0.0, 0.70],
          ),
        ),
      ),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [..._layers, Positioned.fill(child: child)],
    );
  }
}

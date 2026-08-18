import 'package:flutter/animation.dart';

/// Motion tokens — the mobile half of the web's `constants/motion.ts`.
///
/// Same rule, same numbers: motion explains a change, it never performs.
/// Everything lands between 150ms and 300ms on one decelerating curve, so a
/// card, a sheet and a progress bar all feel like the same machine.
class AppMotion {
  const AppMotion._();

  /// Decelerating curve — the web's cubic-bezier(0.16, 1, 0.3, 1).
  static const Curve easeOut = Cubic(0.16, 1, 0.3, 1);

  /// Hover, press, focus — must feel instant.
  static const Duration fast = Duration(milliseconds: 150);

  /// The default: a card arriving, a panel opening.
  static const Duration base = Duration(milliseconds: 220);

  /// Emphasis only: a page masthead, a sheet.
  static const Duration slow = Duration(milliseconds: 300);

  /// Bars, rings and counting figures: one sweep, never repeating.
  static const Duration sweep = Duration(milliseconds: 800);

  /// Capped so the last row of a long list never feels late.
  static Duration stagger(int index, {int stepMs = 35, int maxMs = 240}) =>
      Duration(milliseconds: (index * stepMs).clamp(0, maxMs));
}

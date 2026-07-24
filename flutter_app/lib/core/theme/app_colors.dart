import 'package:flutter/material.dart';

/// The exact Meridian "calm institutional" palette, ported 1:1 from the React
/// design system (`tailwind.config.js` + `constants/theme.ts`). Warm, light,
/// education-first — never pure grey. This is the single source of truth for
/// colour in the Flutter app, mirroring the web.
class AppColors {
  const AppColors._();

  // ── Neutral surfaces (warm) ──
  static const Color canvas = Color(0xFFFBFAF7); // page background
  static const Color surface = Color(0xFFFFFFFF); // cards / sidebar
  static const Color well = Color(0xFFF3F1EB); // subtle fill (ink-800)
  static const Color fill = Color(0xFFE7E3DA); // stronger fill (ink-700)
  static const Color line = Color(0xFFE8E4DA); // hairline divider

  // ── Brand — deep teal ──
  static const Color brand = Color(0xFF0E7C6B);
  static const Color brandDeep = Color(0xFF0A6558);
  static const Color brand700 = Color(0xFF084E45);
  static const Color brand50 = Color(0xFFEDF6F4);
  static const Color brand100 = Color(0xFFD2EAE4);

  // ── Semantic accents (each tuned to be accessible on the warm canvas) ──
  static const Color mint = Color(0xFF1E8A63); // success
  static const Color mintDeep = Color(0xFF177355);
  static const Color cyan = Color(0xFF1F6F8B); // info
  static const Color amber = Color(0xFFA76A12); // warning
  static const Color rose = Color(0xFFC0453B); // danger
  static const Color roseDeep = Color(0xFFA33830);
  static const Color coral = Color(0xFFE86A4F);
  static const Color gold = Color(0xFFC98A21);

  // ── Text (warm ink, not black) ──
  static const Color ink = Color(0xFF16211F); // headings
  static const Color body = Color(0xFF3F4A48); // body copy

  // ── Tailwind slate scale used throughout the web UI ──
  static const Color slate900 = Color(0xFF0F172A);
  static const Color slate800 = Color(0xFF1E293B);
  static const Color slate700 = Color(0xFF334155);
  static const Color slate600 = Color(0xFF475569);
  static const Color slate500 = Color(0xFF64748B);
  static const Color slate400 = Color(0xFF94A3B8);
  static const Color slate300 = Color(0xFFCBD5E1);
  static const Color slate200 = Color(0xFFE2E8F0);

  /// Severity → colour, matching the web `Badge` severities.
  static Color severity(String? s) {
    switch (s) {
      case 'SUCCESS':
        return mint;
      case 'WARNING':
        return amber;
      case 'CRITICAL':
        return rose;
      case 'INFO':
      default:
        return cyan;
    }
  }
}

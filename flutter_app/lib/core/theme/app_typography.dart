import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Typography ported from the web: Fraunces (optical serif) for titles &
/// figures — the signature — Plus Jakarta Sans for body/UI, IBM Plex Mono for
/// numerals that change. Loaded via google_fonts so the app reads identically
/// to the React platform.
class AppType {
  const AppType._();

  /// Serif display face — headings, big numbers.
  static TextStyle display(
    double size, {
    FontWeight weight = FontWeight.w600,
    Color color = AppColors.ink,
    double? height,
    double letterSpacing = -0.015,
  }) =>
      GoogleFonts.fraunces(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
        letterSpacing: letterSpacing * size,
      );

  /// Monospace — tabular numerals (the web's `.tnum`).
  static TextStyle mono(
    double size, {
    FontWeight weight = FontWeight.w500,
    Color color = AppColors.ink,
  }) =>
      GoogleFonts.ibmPlexMono(fontSize: size, fontWeight: weight, color: color);

  /// The full Material text theme, in Plus Jakarta Sans with Fraunces titles.
  static TextTheme textTheme(TextTheme base) {
    final sans = GoogleFonts.plusJakartaSansTextTheme(base);
    return sans.copyWith(
      displayLarge: display(40, weight: FontWeight.w600),
      displayMedium: display(32, weight: FontWeight.w600),
      displaySmall: display(28, weight: FontWeight.w600),
      headlineMedium: display(24, weight: FontWeight.w600),
      headlineSmall: display(20, weight: FontWeight.w600),
      titleLarge: display(18, weight: FontWeight.w600),
      titleMedium: sans.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
        color: AppColors.slate900,
      ),
      bodyLarge: sans.bodyLarge?.copyWith(color: AppColors.slate700),
      bodyMedium: sans.bodyMedium?.copyWith(color: AppColors.slate700),
      bodySmall: sans.bodySmall?.copyWith(color: AppColors.slate500),
      labelLarge: sans.labelLarge?.copyWith(fontWeight: FontWeight.w600),
    );
  }

  /// The web's `.label`: tiny uppercase muted eyebrow.
  static TextStyle label = GoogleFonts.plusJakartaSans(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 1.0,
    color: AppColors.slate400,
  );
}

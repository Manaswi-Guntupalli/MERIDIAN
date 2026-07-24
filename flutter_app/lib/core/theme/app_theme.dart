import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// The Meridian Material 3 theme — a faithful port of the web design system so
/// the Flutter app immediately reads as the same product: warm canvas, deep
/// teal brand, paper (not glass) cards, restrained radii, quiet depth.
class AppTheme {
  const AppTheme._();

  static ThemeData get light {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.brand,
      onPrimary: Colors.white,
      primaryContainer: AppColors.brand50,
      onPrimaryContainer: AppColors.brand700,
      secondary: AppColors.mint,
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFFDFF3EA),
      onSecondaryContainer: AppColors.mintDeep,
      tertiary: AppColors.cyan,
      onTertiary: Colors.white,
      error: AppColors.rose,
      onError: Colors.white,
      errorContainer: Color(0xFFF7E0DD),
      onErrorContainer: AppColors.roseDeep,
      surface: AppColors.surface,
      onSurface: AppColors.ink,
      onSurfaceVariant: AppColors.slate500,
      outline: AppColors.line,
      outlineVariant: AppColors.line,
      surfaceContainerHighest: AppColors.well,
      surfaceContainerHigh: AppColors.well,
      surfaceContainer: AppColors.canvas,
      shadow: Color(0x1F1C201F),
    );

    final base = ThemeData(useMaterial3: true, colorScheme: scheme);

    return base.copyWith(
      // Transparent so the app-wide warm-teal background (AppBackground) shows
      // through every screen, matching the web.
      scaffoldBackgroundColor: Colors.transparent,
      textTheme: AppType.textTheme(base.textTheme),
      dividerTheme: const DividerThemeData(
        color: AppColors.line,
        thickness: 1,
        space: 1,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: AppType.display(20, weight: FontWeight.w600),
        foregroundColor: AppColors.ink,
        iconTheme: const IconThemeData(color: AppColors.slate700),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadii.cardR,
          side: const BorderSide(color: AppColors.line),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.well,
        side: const BorderSide(color: AppColors.line),
        shape: const StadiumBorder(),
        labelStyle: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: AppColors.slate600,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.brand.withValues(alpha: 0.45),
          elevation: 0,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          shape: const RoundedRectangleBorder(borderRadius: AppRadii.controlR),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.slate700,
          backgroundColor: AppColors.surface,
          side: const BorderSide(color: AppColors.line),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: const RoundedRectangleBorder(borderRadius: AppRadii.controlR),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.brand,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        hintStyle: const TextStyle(color: AppColors.slate400, fontSize: 14),
        border: OutlineInputBorder(
          borderRadius: AppRadii.controlR,
          borderSide: const BorderSide(color: AppColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadii.controlR,
          borderSide: const BorderSide(color: AppColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadii.controlR,
          borderSide: const BorderSide(color: AppColors.brand, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadii.controlR,
          borderSide: const BorderSide(color: AppColors.rose),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.brand50,
        elevation: 0,
        height: 66,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.brand : AppColors.slate400,
            size: 24,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
            color: selected ? AppColors.brand : AppColors.slate500,
          );
        }),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: AppColors.surface,
        selectedIconTheme: IconThemeData(color: AppColors.brand),
        unselectedIconTheme: IconThemeData(color: AppColors.slate400),
        selectedLabelTextStyle: TextStyle(
          color: AppColors.brand,
          fontWeight: FontWeight.w600,
        ),
        indicatorColor: AppColors.brand50,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.slate900,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13),
        shape: const RoundedRectangleBorder(borderRadius: AppRadii.smR),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.brand,
      ),
      splashFactory: InkSparkle.splashFactory,
    );
  }
}

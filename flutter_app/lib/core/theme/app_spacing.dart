import 'package:flutter/widgets.dart';

/// Spacing & radii tokens, matching the web's single source of truth
/// (`--r-card: 14px`, `--r-control: 9px`).
class AppRadii {
  const AppRadii._();
  static const double card = 14;
  static const double control = 9;
  static const double sm = 10;
  static const double lg = 18;
  static const double pill = 999;

  static const BorderRadius cardR = BorderRadius.all(Radius.circular(card));
  static const BorderRadius controlR =
      BorderRadius.all(Radius.circular(control));
  static const BorderRadius smR = BorderRadius.all(Radius.circular(sm));
}

/// 4px rhythm.
class Gap {
  const Gap._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;

  static const SizedBox h4 = SizedBox(height: 4);
  static const SizedBox h8 = SizedBox(height: 8);
  static const SizedBox h12 = SizedBox(height: 12);
  static const SizedBox h16 = SizedBox(height: 16);
  static const SizedBox h20 = SizedBox(height: 20);
  static const SizedBox h24 = SizedBox(height: 24);
  static const SizedBox w4 = SizedBox(width: 4);
  static const SizedBox w8 = SizedBox(width: 8);
  static const SizedBox w12 = SizedBox(width: 12);
  static const SizedBox w16 = SizedBox(width: 16);
}

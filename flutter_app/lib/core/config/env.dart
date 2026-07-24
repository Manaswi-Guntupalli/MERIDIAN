/// Environment / backend wiring.
///
/// The Flutter app is ONLY another client of the existing Meridian backend —
/// it never embeds business logic. Point it at the same Node/Express API the
/// React web app uses.
///
/// Override the host at run/build time, e.g. for a physical phone on the same
/// Wi-Fi as the dev machine:
///   flutter run --dart-define=MERIDIAN_API_BASE=http://192.168.0.102:4000
///
/// Defaults to 10.0.2.2 — the Android emulator's alias for the host machine's
/// localhost (iOS simulator can use http://localhost:4000).
class Env {
  const Env._();

  /// Scheme + host + port of the backend (no trailing slash, no `/api`).
  static const String apiBase = String.fromEnvironment(
    'MERIDIAN_API_BASE',
    defaultValue: 'http://10.0.2.2:4000',
  );

  /// REST base — every route in the backend lives under `/api`.
  static String get apiUrl => '$apiBase/api';

  /// Socket.io connects to the origin (the server proxies the namespace).
  static String get socketUrl => apiBase;
}

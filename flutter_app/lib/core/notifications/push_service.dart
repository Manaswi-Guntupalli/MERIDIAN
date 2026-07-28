import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// System notifications for Meridian.
///
/// WHAT WORKS TODAY: alerts arriving over the realtime socket are shown as real
/// Android/iOS notifications while the app is running. That is the whole path
/// the backend currently supports.
///
/// WHAT DOES NOT, AND WHY: there is no FCM delivery. The server has no push
/// provider and no device-token endpoint — `sendPush` in
/// `server/src/services/presence/channels.ts` deliberately logs a structured
/// "would send" entry to the Trust Ledger instead. So a token has nowhere to be
/// registered and nothing would ever be sent to it. Rather than add
/// firebase_messaging (which also fails the Android build without a
/// `google-services.json`), this file provides the same kind of typed seam the
/// backend uses: [PushRegistrar]. Implementing it is the only client change
/// needed once the server side exists.
///
/// TO ACTIVATE FCM LATER:
///   1. server — add a device-token table + `POST /notifications/device`, and
///      implement `sendPush` against FCM.
///   2. app — add `firebase_core` + `firebase_messaging`, drop in
///      `google-services.json` / `GoogleService-Info.plist`.
///   3. app — implement [PushRegistrar] to read the FCM token and POST it, then
///      pass it to [PushService.attachRegistrar]. Nothing else here changes.
class PushService {
  PushService();

  static const _channelId = 'meridian_alerts';
  static const _channelName = 'Meridian alerts';
  static const _channelDescription =
      'Attendance, fees, timetable and emergency notifications.';

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _ready = false;
  int _id = 0;
  PushRegistrar? _registrar;

  /// Prepares the channel and asks for permission. Safe to call more than once.
  Future<void> init() async {
    if (_ready) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinInit = DarwinInitializationSettings();
    await _plugin.initialize(
      const InitializationSettings(android: androidInit, iOS: darwinInit),
    );

    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(
      const AndroidNotificationChannel(
        _channelId,
        _channelName,
        description: _channelDescription,
        importance: Importance.high,
      ),
    );
    // Android 13+ and iOS both gate notifications behind a runtime grant.
    await android?.requestNotificationsPermission();
    await _plugin
        .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin>()
        ?.requestPermissions(alert: true, badge: true, sound: true);

    _ready = true;
  }

  /// Shows one alert. `critical` raises it to a heads-up notification, which is
  /// reserved for emergencies — everything else stays quiet in the shade.
  Future<void> show({
    required String title,
    required String body,
    bool critical = false,
  }) async {
    if (!_ready) return;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        _channelName,
        channelDescription: _channelDescription,
        importance: critical ? Importance.max : Importance.defaultImportance,
        priority: critical ? Priority.high : Priority.defaultPriority,
        styleInformation: BigTextStyleInformation(body),
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentSound: critical,
      ),
    );
    await _plugin.show(_id++, title, body, details);
  }

  /// Registers the FCM seam. No-op until a [PushRegistrar] exists.
  Future<void> attachRegistrar(PushRegistrar registrar) async {
    _registrar = registrar;
    await _registrar?.register();
  }

  /// Called on sign-out so a shared device stops receiving the last user's
  /// notifications.
  Future<void> clear() async {
    await _plugin.cancelAll();
    await _registrar?.unregister();
  }
}

/// The seam an FCM implementation fills in. Kept as an interface so the rest of
/// the app can be written against push today and stay unchanged tomorrow.
abstract interface class PushRegistrar {
  /// Obtain the device token and hand it to the backend.
  Future<void> register();

  /// Detach this device (sign-out, or token rotation).
  Future<void> unregister();
}

/// The no-op registrar in force today: it states the situation once in debug
/// rather than pretending a token was stored.
class UnconfiguredPushRegistrar implements PushRegistrar {
  const UnconfiguredPushRegistrar();

  @override
  Future<void> register() async {
    assert(() {
      debugPrint(
        'PushService: FCM not configured — no server endpoint to register a '
        'device token with. Realtime alerts still display while the app runs.',
      );
      return true;
    }());
  }

  @override
  Future<void> unregister() async {}
}

final pushServiceProvider = Provider<PushService>((ref) => PushService());

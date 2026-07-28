import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/attendance/data/attendance_repository.dart';
import '../../features/dashboard/data/dashboard_repository.dart';
import '../../features/dashboard/data/intelligence_repository.dart';
import '../../features/emergency/data/emergency_repository.dart';
import '../../features/family/data/family_repository.dart';
import '../../features/kairos/data/kairos_repository.dart';
import '../../features/notifications/data/notifications_repository.dart';
import '../../features/reports/data/reports_repository.dart';
import '../../features/staff/data/staff_repository.dart';
import '../../features/students/data/students_repository.dart';
import '../../features/teacher/data/teacher_repository.dart';
import '../../features/timetable/data/timetable_repository.dart';
import '../notifications/push_service.dart';
import '../storage/token_storage.dart';
import 'socket_client.dart';

/// A live event worth telling the user about, surfaced to the UI as a toast
/// and (via [PushService]) as a system notification.
@immutable
class RealtimeAlert {
  const RealtimeAlert({
    required this.title,
    required this.body,
    required this.severity,
  });

  final String title;
  final String body;

  /// SUCCESS | INFO | WARNING | CRITICAL
  final String severity;
}

/// Connects to the school's realtime stream and refreshes whatever an event
/// touched — the Flutter counterpart of the web's `useRealtime` hook.
///
/// Riverpod has no query keys, so where the web invalidates a list of strings
/// this invalidates the actual providers. The groupings below deliberately
/// mirror the web's `REACTIVE` / `PRESENCE_REACTIVE` / `TIMETABLE_REACTIVE`
/// lists so the two clients stay in step.
class RealtimeService {
  RealtimeService(this._ref);

  final Ref _ref;
  final SocketClient _client = SocketClient();

  /// Alerts for the UI to surface. Broadcast so several listeners (a toast
  /// host and the push service) can observe without competing.
  final _alerts = StreamController<RealtimeAlert>.broadcast();
  Stream<RealtimeAlert> get alerts => _alerts.stream;

  bool _wired = false;

  /// The push-notification subscription, held so it can be cancelled on
  /// sign-out. Without this, each sign-in added another listener to the
  /// broadcast stream and a single alert raised one notification per session
  /// the device had ever opened.
  StreamSubscription<RealtimeAlert>? _pushSubscription;

  Future<void> start() async {
    if (_wired) return;
    final token = await _ref.read(tokenStorageProvider).readToken();
    if (token == null || token.isEmpty) return;

    // Alerts become system notifications as well as in-app toasts, so an
    // emergency reaches a phone that is face-down on a desk.
    final push = _ref.read(pushServiceProvider);
    await push.init();
    await push.attachRegistrar(const UnconfiguredPushRegistrar());
    await _pushSubscription?.cancel();
    _pushSubscription = _alerts.stream.listen((a) => push.show(
          title: a.title,
          body: a.body,
          critical: a.severity == 'CRITICAL',
        ));

    final socket = _client.connect(token);
    _wired = true;

    // ── Anything appended to the event store can move a derived number. ──
    socket.on('event:new', (_) => _refreshDerived());

    // ── Notifications: the only events that speak to the user directly. ──
    socket.on('notification:new', (data) {
      final map = data is Map ? data : const {};
      _alerts.add(RealtimeAlert(
        title: map['title']?.toString() ?? 'Update',
        body: map['body']?.toString() ?? '',
        severity: map['severity']?.toString() ?? 'INFO',
      ));
      _ref.invalidate(notificationsProvider);
    });

    // ── Presence: a face/QR mark moves the live register and every view of it.
    socket.on('attendance:verification', (data) {
      final map = data is Map ? data : const {};
      if (map['state'] == 'PROXY_ATTEMPT') {
        _alerts.add(RealtimeAlert(
          title: 'Proxy attendance blocked',
          body: map['reason']?.toString() ??
              'Face did not match the QR claim',
          severity: 'CRITICAL',
        ));
      }
      _refreshPresence();
    });
    socket.on('attendance:session', (_) => _refreshPresence());

    // ── Emergency: the one case that must interrupt whatever is on screen. ──
    socket.on('emergency:trigger', (data) {
      final kind = (data is Map ? data['kind'] : null)?.toString() ?? 'Emergency';
      _alerts.add(RealtimeAlert(
        title: '🚨 $kind emergency',
        body: 'Emergency protocol activated.',
        severity: 'CRITICAL',
      ));
      _refreshEmergency();
    });
    socket.on('emergency:resolve', (_) {
      _alerts.add(const RealtimeAlert(
        title: 'All clear',
        body: 'The emergency is resolved. Normal operations resume.',
        severity: 'SUCCESS',
      ));
      _refreshEmergency();
    });
    socket.on('emergency:ack', (_) => _refreshEmergency());

    // ── A publish swaps the school's live timetable under everyone. ──
    socket.on('timetable:published', (_) => _refreshTimetable());
    socket.on('timetable:draft', (_) => _ref.invalidate(kairosOverviewProvider));
  }

  void stop() {
    _pushSubscription?.cancel();
    _pushSubscription = null;
    _client.disconnect();
    _wired = false;
  }

  void dispose() {
    stop();
    _alerts.close();
  }

  /// Every number the dashboards derive from the event store.
  void _refreshDerived() {
    _ref.invalidate(dashboardStatsProvider);
    _ref.invalidate(intelligenceProvider);
    _ref.invalidate(familyCardsProvider);
    _ref.invalidate(teacherDashboardProvider);
    _ref.invalidate(studentsProvider);
    _ref.invalidate(staffProvider);
    _ref.invalidate(reportSummaryProvider);
    _ref.invalidate(notificationsProvider);
  }

  void _refreshPresence() {
    _ref.invalidate(presenceTodayProvider);
    _ref.invalidate(presenceSessionsProvider);
    _ref.invalidate(lateStudentsProvider);
    _ref.invalidate(dashboardStatsProvider);
    _ref.invalidate(familyCardsProvider);
  }

  void _refreshEmergency() {
    _ref.invalidate(activeIncidentProvider);
    _ref.invalidate(dashboardStatsProvider);
  }

  void _refreshTimetable() {
    _ref.invalidate(liveTimetableProvider);
    _ref.invalidate(kairosOverviewProvider);
    _ref.invalidate(teacherDashboardProvider);
    _ref.invalidate(familyCardsProvider);
    _ref.invalidate(dashboardStatsProvider);
    _ref.invalidate(staffProvider);
  }
}

final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  final service = RealtimeService(ref);
  ref.onDispose(service.dispose);
  return service;
});

/// The alert stream, for the UI to listen to.
final realtimeAlertsProvider = StreamProvider<RealtimeAlert>(
  (ref) => ref.watch(realtimeServiceProvider).alerts,
);

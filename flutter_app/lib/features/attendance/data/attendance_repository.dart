import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /presence/analytics/* and /presence/session — the Presence module's
//    read surface. Marking attendance stays on the kiosk/projector flows. ──

class PresenceToday {
  const PresenceToday({
    required this.date,
    required this.totalStudents,
    required this.present,
    required this.late,
    required this.absent,
    required this.unmarked,
    required this.activeSessions,
    required this.proxyAttempts,
  });

  final String date;
  final int totalStudents;
  final int present;
  final int late;
  final int absent;
  final int unmarked;
  final int activeSessions;
  final int proxyAttempts;

  int get marked => totalStudents - unmarked;

  /// Present (incl. late) as a share of what has actually been marked. Null
  /// until something is marked — the web refuses to divide by zero and so
  /// does this.
  double? get rateOfMarked =>
      marked <= 0 ? null : (present + late) / marked * 100;

  factory PresenceToday.fromJson(Map<String, dynamic> j) => PresenceToday(
        date: j['date'] as String? ?? '',
        totalStudents: (j['totalStudents'] ?? 0) as int,
        present: (j['present'] ?? 0) as int,
        late: (j['late'] ?? 0) as int,
        absent: (j['absent'] ?? 0) as int,
        unmarked: (j['unmarked'] ?? 0) as int,
        activeSessions: (j['activeSessions'] ?? 0) as int,
        proxyAttempts: (j['proxyAttempts'] ?? 0) as int,
      );
}

class SessionRow {
  const SessionRow({
    required this.id,
    required this.className,
    required this.status,
    required this.date,
    required this.roster,
  });
  final String id;
  final String className;
  final String status;
  final String date;
  final int roster;

  bool get isActive => status == 'ACTIVE';

  factory SessionRow.fromJson(Map<String, dynamic> j) => SessionRow(
        id: j['id'] as String,
        className: j['className'] as String? ?? '—',
        status: j['status'] as String? ?? '',
        date: j['date'] as String? ?? '',
        roster: (j['roster'] ?? 0) as int,
      );
}

class MethodBreakdown {
  const MethodBreakdown({required this.face, required this.qr, required this.manual});
  final int face;
  final int qr;
  final int manual;

  int get total => face + qr + manual;

  factory MethodBreakdown.fromJson(Map<String, dynamic> j) => MethodBreakdown(
        face: (j['face'] ?? j['FACE'] ?? 0) as int,
        qr: (j['qr'] ?? j['QR'] ?? 0) as int,
        manual: (j['manual'] ?? j['MANUAL'] ?? 0) as int,
      );
}

class AttendanceRepository {
  AttendanceRepository(this._dio);
  final Dio _dio;

  Future<PresenceToday> today() async {
    final res =
        await _dio.get<Map<String, dynamic>>('/presence/analytics/today');
    return PresenceToday.fromJson(res.data!);
  }

  Future<List<SessionRow>> sessions() async {
    final res = await _dio.get<Map<String, dynamic>>('/presence/session');
    return ((res.data!['sessions'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(SessionRow.fromJson)
        .toList();
  }

  /// Late arrivals over the recent window, as the analytics route computes it.
  Future<List<({String name, String className, int count})>> lateStudents() async {
    final res =
        await _dio.get<Map<String, dynamic>>('/presence/analytics/late-students');
    return ((res.data!['students'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map((s) => (
              name: s['name'] as String? ?? '—',
              className: s['className'] as String? ?? '—',
              count: ((s['lateCount'] ?? s['count'] ?? 0) as num).toInt(),
            ))
        .toList();
  }
}

final attendanceRepositoryProvider = Provider<AttendanceRepository>(
  (ref) => AttendanceRepository(ref.read(dioProvider)),
);

final presenceTodayProvider = FutureProvider.autoDispose<PresenceToday>(
  (ref) => ref.read(attendanceRepositoryProvider).today(),
);

final presenceSessionsProvider = FutureProvider.autoDispose<List<SessionRow>>(
  (ref) => ref.read(attendanceRepositoryProvider).sessions(),
);

final lateStudentsProvider =
    FutureProvider.autoDispose<List<({String name, String className, int count})>>(
  (ref) => ref.read(attendanceRepositoryProvider).lateStudents(),
);

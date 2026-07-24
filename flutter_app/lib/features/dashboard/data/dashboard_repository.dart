import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── Models (from GET /dashboard/stats and GET /presence/session) ──

class HealthBreakdown {
  const HealthBreakdown({
    required this.attendance,
    required this.finance,
    required this.people,
    required this.operations,
  });
  final int attendance;
  final int finance;
  final int people;
  final int operations;

  factory HealthBreakdown.fromJson(Map<String, dynamic> j) => HealthBreakdown(
        attendance: (j['attendance'] ?? 0).round(),
        finance: (j['finance'] ?? 0).round(),
        people: (j['people'] ?? 0).round(),
        operations: (j['operations'] ?? 0).round(),
      );
}

class DashboardStats {
  const DashboardStats({
    required this.students,
    required this.teachers,
    required this.classes,
    required this.attendanceRate,
    required this.present,
    required this.totalMarked,
    required this.outstanding,
    required this.overdueCount,
    required this.docsInReview,
    required this.health,
    required this.breakdown,
    required this.feeCollectionRate,
    required this.timeSavedHours,
    required this.uncoveredToday,
    required this.emergencyActive,
  });

  final int students;
  final int teachers;
  final int classes;
  final int attendanceRate;
  final int present;
  final int totalMarked;
  final int outstanding;
  final int overdueCount;
  final int docsInReview;
  final int health;
  final HealthBreakdown breakdown;
  final int feeCollectionRate;
  final int timeSavedHours;
  final int uncoveredToday;
  final bool emergencyActive;

  factory DashboardStats.fromJson(Map<String, dynamic> j) => DashboardStats(
        students: (j['students'] ?? 0) as int,
        teachers: (j['teachers'] ?? 0) as int,
        classes: (j['classes'] ?? 0) as int,
        attendanceRate: (j['attendanceRate'] ?? 0).round(),
        present: (j['present'] ?? 0) as int,
        totalMarked: (j['totalMarked'] ?? 0) as int,
        outstanding: (j['outstanding'] ?? 0).round(),
        overdueCount: (j['overdueCount'] ?? 0) as int,
        docsInReview: (j['docsInReview'] ?? 0) as int,
        health: (j['health'] ?? 0).round(),
        breakdown: HealthBreakdown.fromJson(
            (j['healthBreakdown'] as Map<String, dynamic>?) ?? const {}),
        feeCollectionRate: (j['feeCollectionRate'] ?? 0).round(),
        timeSavedHours: (j['timeSavedHours'] ?? 0) as int,
        uncoveredToday: (j['uncoveredToday'] ?? 0) as int,
        emergencyActive: (j['emergencyActive'] ?? false) as bool,
      );
}

class ActiveSession {
  const ActiveSession({
    required this.id,
    required this.className,
    required this.roster,
    required this.startTime,
  });
  final String id;
  final String className;
  final int roster;
  final String startTime;

  factory ActiveSession.fromJson(Map<String, dynamic> j) => ActiveSession(
        id: j['id'] as String,
        className: j['className'] as String? ?? '—',
        roster: (j['roster'] ?? 0) as int,
        startTime: j['startTime'] as String? ?? '',
      );
}

// ── Repository ──

class DashboardRepository {
  DashboardRepository(this._dio);
  final Dio _dio;

  Future<DashboardStats> fetchStats() async {
    final res = await _dio.get<Map<String, dynamic>>('/dashboard/stats');
    return DashboardStats.fromJson(res.data!);
  }

  Future<List<ActiveSession>> fetchActiveSessions() async {
    final res = await _dio.get<Map<String, dynamic>>('/presence/session');
    final list = (res.data!['sessions'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return list
        .where((s) => s['status'] == 'ACTIVE')
        .map(ActiveSession.fromJson)
        .toList();
  }
}

final dashboardRepositoryProvider = Provider<DashboardRepository>(
  (ref) => DashboardRepository(ref.read(dioProvider)),
);

/// The Principal/Admin dashboard metrics.
final dashboardStatsProvider = FutureProvider.autoDispose<DashboardStats>(
  (ref) => ref.read(dashboardRepositoryProvider).fetchStats(),
);

/// Live attendance sessions currently running.
final activeSessionsProvider = FutureProvider.autoDispose<List<ActiveSession>>(
  (ref) => ref.read(dashboardRepositoryProvider).fetchActiveSessions(),
);

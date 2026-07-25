import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /timetable/overview, POST /timetable/draft/approve|publish ──
//
// Generation and slot editing stay on the web (a desk task on a big grid).
// The phone carries the decision the principal actually makes away from a
// desk: read the solver's health and approve or publish the draft.

class SolverHealth {
  const SolverHealth({
    required this.score,
    required this.breakdown,
    required this.unplaced,
    required this.warnings,
  });

  final int score;

  /// placement / balance / preferences, as the solver publishes them.
  final Map<String, int> breakdown;
  final List<String> unplaced;
  final List<String> warnings;

  factory SolverHealth.fromJson(Map<String, dynamic> j) => SolverHealth(
        score: (j['score'] ?? 0).round(),
        breakdown: {
          for (final e
              in ((j['breakdown'] as Map<String, dynamic>?) ?? const {}).entries)
            if (e.value is num) e.key: (e.value as num).round(),
        },
        unplaced: ((j['unplaced'] as List?) ?? const [])
            .map((u) => u.toString())
            .toList(),
        warnings: ((j['warnings'] as List?) ?? const [])
            .map((w) => w.toString())
            .toList(),
      );
}

class TimetableMeta {
  const TimetableMeta({
    required this.id,
    required this.name,
    required this.status,
    required this.version,
    required this.score,
    required this.health,
  });

  final String id;
  final String name;

  /// DRAFT | APPROVED | PUBLISHED | ARCHIVED
  final String status;
  final int version;
  final int score;
  final SolverHealth? health;

  bool get isApproved => status == 'APPROVED';

  factory TimetableMeta.fromJson(Map<String, dynamic> j) => TimetableMeta(
        id: j['id'] as String,
        name: j['name'] as String? ?? '—',
        status: j['status'] as String? ?? '',
        version: (j['version'] ?? 0) as int,
        score: (j['score'] ?? 0).round(),
        health: j['health'] is Map<String, dynamic>
            ? SolverHealth.fromJson(j['health'] as Map<String, dynamic>)
            : null,
      );
}

/// A pre-solve problem the server found. BLOCKER stops a solve; WARNING is
/// advisory. The `fix` is the server's own remediation text.
class KairosIssue {
  const KairosIssue({
    required this.severity,
    required this.title,
    required this.detail,
    required this.fix,
  });

  final String severity;
  final String title;
  final String detail;
  final String fix;

  bool get isBlocker => severity == 'BLOCKER';

  factory KairosIssue.fromJson(Map<String, dynamic> j) => KairosIssue(
        severity: j['severity'] as String? ?? 'WARNING',
        title: j['title'] as String? ?? '',
        detail: j['detail'] as String? ?? '',
        fix: j['fix'] as String? ?? '',
      );
}

class KairosOverview {
  const KairosOverview({
    required this.active,
    required this.draft,
    required this.issues,
    required this.workingDays,
    required this.periodsPerDay,
    required this.teachers,
    required this.classesWithPlan,
    required this.classesTotal,
  });

  final TimetableMeta? active;
  final TimetableMeta? draft;

  /// Pre-solve problems the server found (missing plans, capacity, …).
  final List<KairosIssue> issues;
  final int workingDays;
  final int periodsPerDay;
  final int teachers;
  final int classesWithPlan;
  final int classesTotal;

  factory KairosOverview.fromJson(Map<String, dynamic> j) {
    final setup = (j['setup'] as Map<String, dynamic>?) ?? const {};
    return KairosOverview(
      active: j['active'] is Map<String, dynamic>
          ? TimetableMeta.fromJson(j['active'] as Map<String, dynamic>)
          : null,
      draft: j['draft'] is Map<String, dynamic>
          ? TimetableMeta.fromJson(j['draft'] as Map<String, dynamic>)
          : null,
      issues: ((j['issues'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(KairosIssue.fromJson)
          .toList(),
      workingDays: (setup['workingDays'] ?? 0) as int,
      periodsPerDay: (setup['periodsPerDay'] ?? 0) as int,
      teachers: (setup['teachers'] ?? 0) as int,
      classesWithPlan: (setup['classesWithPlan'] ?? 0) as int,
      classesTotal: (setup['classesTotal'] ?? 0) as int,
    );
  }
}

class KairosRepository {
  KairosRepository(this._dio);
  final Dio _dio;

  Future<KairosOverview> overview() async {
    final res = await _dio.get<Map<String, dynamic>>('/timetable/overview');
    return KairosOverview.fromJson(res.data!);
  }

  Future<void> approve() async => _dio.post('/timetable/draft/approve');

  Future<void> publish() async => _dio.post('/timetable/draft/publish');
}

final kairosRepositoryProvider = Provider<KairosRepository>(
  (ref) => KairosRepository(ref.read(dioProvider)),
);

final kairosOverviewProvider = FutureProvider.autoDispose<KairosOverview>(
  (ref) => ref.read(kairosRepositoryProvider).overview(),
);

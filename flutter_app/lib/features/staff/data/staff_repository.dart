import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /staff, POST /staff/absence/cascade, POST /staff/absence/undo ──

class TeacherRow {
  const TeacherRow({
    required this.id,
    required this.name,
    required this.employeeId,
    required this.department,
    required this.subjects,
    required this.classesLed,
    required this.weeklyHours,
    required this.maxHours,
    required this.load,
    required this.overloaded,
  });

  final String id;
  final String name;
  final String employeeId;
  final String department;
  final List<String> subjects;
  final List<String> classesLed;
  final int weeklyHours;
  final int maxHours;

  /// Percent of cap, as the server computes it.
  final int load;
  final bool overloaded;

  factory TeacherRow.fromJson(Map<String, dynamic> j) => TeacherRow(
        id: j['id'] as String,
        name: j['name'] as String? ?? '—',
        employeeId: j['employeeId'] as String? ?? '',
        department: j['department'] as String? ?? '—',
        subjects: ((j['subjects'] as List?) ?? const []).cast<String>(),
        classesLed: ((j['classesLed'] as List?) ?? const []).cast<String>(),
        weeklyHours: (j['weeklyHours'] ?? 0) as int,
        maxHours: (j['maxHours'] ?? 0) as int,
        load: (j['load'] ?? 0).round(),
        overloaded: (j['overloaded'] ?? false) as bool,
      );
}

/// One executed step of the cascade, with the server's own timestamp — this is
/// a replay of what happened, not a client-side animation script.
class CascadeStep {
  const CascadeStep({
    required this.key,
    required this.label,
    required this.detail,
    required this.status,
    required this.at,
  });
  final String key;
  final String label;
  final String detail;

  /// DONE | PARTIAL | SKIPPED
  final String status;
  final DateTime? at;

  factory CascadeStep.fromJson(Map<String, dynamic> j) => CascadeStep(
        key: j['key'] as String? ?? '',
        label: j['label'] as String? ?? '',
        detail: j['detail'] as String? ?? '',
        status: j['status'] as String? ?? 'SKIPPED',
        at: DateTime.tryParse(j['at'] as String? ?? ''),
      );
}

class CascadeResult {
  const CascadeResult({
    required this.eventId,
    required this.teacherName,
    required this.date,
    required this.steps,
    required this.covered,
    required this.uncovered,
    required this.familyUsersNotified,
    required this.substitutesNotified,
    required this.freedRooms,
  });

  final String? eventId;
  final String teacherName;
  final String date;
  final List<CascadeStep> steps;
  final int covered;
  final int uncovered;
  final int familyUsersNotified;
  final int substitutesNotified;
  final int freedRooms;

  factory CascadeResult.fromJson(Map<String, dynamic> j) {
    final notified = (j['notified'] as Map<String, dynamic>?) ?? const {};
    return CascadeResult(
      eventId: j['eventId'] as String?,
      teacherName:
          ((j['teacher'] as Map<String, dynamic>?)?['name'] as String?) ?? '—',
      date: j['date'] as String? ?? '',
      steps: ((j['steps'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(CascadeStep.fromJson)
          .toList(),
      covered: (j['covered'] ?? 0) as int,
      uncovered: (j['uncovered'] ?? 0) as int,
      familyUsersNotified: (notified['familyUsers'] ?? 0) as int,
      substitutesNotified: (notified['substitutes'] ?? 0) as int,
      freedRooms: ((j['freedRooms'] as List?) ?? const []).length,
    );
  }
}

class StaffRepository {
  StaffRepository(this._dio);
  final Dio _dio;

  Future<List<TeacherRow>> fetch() async {
    final res = await _dio.get<Map<String, dynamic>>('/staff');
    return ((res.data!['teachers'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(TeacherRow.fromJson)
        .toList();
  }

  /// Marks the teacher absent today and runs the full cover cascade. One call,
  /// exactly as the web does it — the app never re-implements the logic.
  Future<CascadeResult> runCascade(String teacherId) async {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final res = await _dio.post<Map<String, dynamic>>(
      '/staff/absence/cascade',
      data: {'teacherId': teacherId, 'date': today},
    );
    return CascadeResult.fromJson(res.data!);
  }

  /// Reverses the whole cascade via its ledger event.
  Future<String> undo(String eventId) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/staff/absence/undo',
      data: {'eventId': eventId},
    );
    final d = res.data ?? const {};
    final removed = d['substitutionsRemoved'] ?? 0;
    final informed = d['substitutesInformed'] ?? 0;
    return '$removed substitution(s) removed; $informed substitute(s) informed.';
  }
}

final staffRepositoryProvider =
    Provider<StaffRepository>((ref) => StaffRepository(ref.read(dioProvider)));

final staffProvider = FutureProvider.autoDispose<List<TeacherRow>>(
  (ref) => ref.read(staffRepositoryProvider).fetch(),
);

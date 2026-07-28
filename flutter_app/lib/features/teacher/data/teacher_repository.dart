import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../../family/data/family_repository.dart' show TimetableEntry;

// ── GET /dashboard/teacher — the teacher's own classes and today's periods,
//    plus GET /attendance/class/:id and POST /attendance/mark for roll-call. ──

class ClassLed {
  const ClassLed({
    required this.id,
    required this.name,
    required this.students,
    this.room,
  });
  final String id;
  final String name;
  final int students;
  final String? room;

  factory ClassLed.fromJson(Map<String, dynamic> j) => ClassLed(
    id: j['id'] as String,
    name: j['name'] as String? ?? '—',
    students: (j['students'] ?? 0) as int,
    room: j['room'] as String?,
  );
}

class TeacherDashboardData {
  const TeacherDashboardData({
    required this.name,
    required this.department,
    required this.employeeId,
    required this.weeklyHours,
    required this.maxHours,
    required this.studentsReached,
    required this.classesLed,
    required this.todaySlots,
  });

  final String name;
  final String department;
  final String employeeId;
  final int weeklyHours;
  final int maxHours;
  final int studentsReached;
  final List<ClassLed> classesLed;
  final List<TimetableEntry> todaySlots;

  /// The web flags a teacher at or within an hour of their cap.
  bool get nearCap => weeklyHours >= maxHours - 1;

  factory TeacherDashboardData.fromJson(Map<String, dynamic> j) {
    final t = (j['teacher'] as Map<String, dynamic>?) ?? const {};
    return TeacherDashboardData(
      name: t['name'] as String? ?? '—',
      department: t['department'] as String? ?? '—',
      employeeId: t['employeeId'] as String? ?? '',
      weeklyHours: (j['weeklyHours'] ?? 0) as int,
      maxHours: (j['maxHours'] ?? 0) as int,
      studentsReached: (j['studentsReached'] ?? 0) as int,
      classesLed: ((j['classesLed'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(ClassLed.fromJson)
          .toList(),
      todaySlots: ((j['todaySlots'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(TimetableEntry.fromJson)
          .toList(),
    );
  }
}

/// One student on a class roster, with today's mark if there is one.
class RosterEntry {
  const RosterEntry({
    required this.studentId,
    required this.name,
    required this.rollNo,
    required this.status,
    required this.faceEnrolled,
    this.source,
  });

  final String studentId;
  final String name;
  final int rollNo;

  /// PRESENT | LATE | ABSENT | LEAVE | UNMARKED
  final String status;
  final bool faceEnrolled;

  /// FACE | QR | MANUAL — how the mark arrived, when there is one.
  final String? source;

  factory RosterEntry.fromJson(Map<String, dynamic> j) => RosterEntry(
    studentId: j['studentId'] as String,
    name: j['name'] as String? ?? '—',
    rollNo: (j['rollNo'] ?? 0) as int,
    status: j['status'] as String? ?? 'UNMARKED',
    faceEnrolled: (j['faceEnrolled'] ?? false) as bool,
    source: j['source'] as String?,
  );
}

class ClassRoster {
  const ClassRoster({required this.date, required this.entries});
  final String date;
  final List<RosterEntry> entries;

  int get marked => entries.where((e) => e.status != 'UNMARKED').length;
}

class TeacherRepository {
  TeacherRepository(this._dio);
  final Dio _dio;

  Future<TeacherDashboardData> dashboard() async {
    final res = await _dio.get<Map<String, dynamic>>('/dashboard/teacher');
    return TeacherDashboardData.fromJson(res.data!);
  }

  Future<ClassRoster> roster(String classId) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/attendance/class/$classId',
    );
    return ClassRoster(
      date: res.data?['date'] as String? ?? '',
      entries: ((res.data?['roster'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(RosterEntry.fromJson)
          .toList(),
    );
  }

  /// Records one student's status. The server routes a live PRESENT/LATE
  /// through Presence so it lands in the same feed as face and QR marks — the
  /// app just states the outcome and lets the backend decide how to store it.
  Future<void> mark({
    required String studentId,
    required String classId,
    required String status,
  }) => _dio.post(
    '/attendance/mark',
    data: {'studentId': studentId, 'classId': classId, 'status': status},
  );
}

final teacherRepositoryProvider = Provider<TeacherRepository>(
  (ref) => TeacherRepository(ref.read(dioProvider)),
);

// autoDispose for the same reason as familyCardsProvider: session-scoped.
final teacherDashboardProvider =
    FutureProvider.autoDispose<TeacherDashboardData>(
      (ref) => ref.read(teacherRepositoryProvider).dashboard(),
    );

final classRosterProvider = FutureProvider.autoDispose
    .family<ClassRoster, String>(
      (ref, classId) => ref.read(teacherRepositoryProvider).roster(classId),
    );

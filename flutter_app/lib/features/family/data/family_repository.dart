import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /dashboard/me — one payload serving both Student and Parent, exactly
//    as the web's FamilyDashboard does. A student gets one card; a parent gets
//    one per linked child. ──

class AttendanceDay {
  const AttendanceDay({required this.date, required this.status});
  final String date;

  /// PRESENT | LATE | ABSENT | LEAVE
  final String status;

  factory AttendanceDay.fromJson(Map<String, dynamic> j) => AttendanceDay(
    date: j['date'] as String? ?? '',
    status: j['status'] as String? ?? 'UNMARKED',
  );
}

class FeeRow {
  const FeeRow({
    required this.id,
    required this.title,
    required this.amount,
    required this.due,
    required this.status,
    required this.dueDate,
  });

  final String id;
  final String title;
  final num amount;

  /// What is still owed on this fee (0 once settled).
  final num due;

  /// PENDING | PARTIAL | PAID | OVERDUE — the stored label the API returns.
  final String status;
  final String dueDate;

  factory FeeRow.fromJson(Map<String, dynamic> j) => FeeRow(
    id: j['id'] as String? ?? '',
    title: j['title'] as String? ?? '',
    amount: (j['amount'] ?? 0) as num,
    due: (j['due'] ?? 0) as num,
    status: j['status'] as String? ?? '',
    dueDate: j['dueDate'] as String? ?? '',
  );
}

class TimetableEntry {
  const TimetableEntry({
    required this.period,
    required this.subject,
    required this.colorHex,
    this.teacher,
    this.room,
    this.className,
    this.classId,
  });

  final int period;
  final String subject;

  /// The subject's colour, as the solver published it (e.g. "#0E7C6B").
  final String colorHex;
  final String? teacher;
  final String? room;
  final String? className;
  final String? classId;

  factory TimetableEntry.fromJson(Map<String, dynamic> j) => TimetableEntry(
    period: (j['period'] ?? 0) as int,
    subject: j['subject'] as String? ?? '',
    colorHex: (j['color'] ?? j['subjectColor'] ?? '#0E7C6B') as String,
    teacher: j['teacher'] as String?,
    room: j['room'] as String?,
    className: j['className'] as String?,
    classId: j['classId'] as String?,
  );
}

/// One child's school day — the unit both the student and parent views render.
class FamilyCard {
  const FamilyCard({
    required this.id,
    required this.name,
    required this.rollNo,
    required this.className,
    required this.classTeacher,
    required this.room,
    required this.attendanceRate,
    required this.todayStatus,
    required this.attendanceHistory,
    required this.outstanding,
    required this.fees,
    required this.timetableToday,
  });

  final String id;
  final String name;
  final int rollNo;
  final String? className;
  final String? classTeacher;
  final String? room;
  final int attendanceRate;

  /// PRESENT | LATE | ABSENT | LEAVE | UNMARKED
  final String todayStatus;
  final List<AttendanceDay> attendanceHistory;
  final num outstanding;
  final List<FeeRow> fees;
  final List<TimetableEntry> timetableToday;

  factory FamilyCard.fromJson(Map<String, dynamic> j) => FamilyCard(
    id: j['id'] as String? ?? '',
    name: j['name'] as String? ?? '—',
    rollNo: (j['rollNo'] ?? 0) as int,
    className: j['className'] as String?,
    classTeacher: j['classTeacher'] as String?,
    room: j['room'] as String?,
    attendanceRate: (j['attendanceRate'] ?? 0).round(),
    todayStatus: j['todayStatus'] as String? ?? 'UNMARKED',
    attendanceHistory: ((j['attendanceHistory'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(AttendanceDay.fromJson)
        .toList(),
    outstanding: (j['outstanding'] ?? 0) as num,
    fees: ((j['fees'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(FeeRow.fromJson)
        .toList(),
    timetableToday: ((j['timetableToday'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(TimetableEntry.fromJson)
        .toList(),
  );
}

class FamilyRepository {
  FamilyRepository(this._dio);
  final Dio _dio;

  Future<List<FamilyCard>> cards() async {
    final res = await _dio.get<Map<String, dynamic>>('/dashboard/me');
    return ((res.data?['cards'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(FamilyCard.fromJson)
        .toList();
  }
}

final familyRepositoryProvider = Provider<FamilyRepository>(
  (ref) => FamilyRepository(ref.read(dioProvider)),
);

// autoDispose: this is session data. A non-disposing provider kept the
// previous account's result (or its 403) after a role switch.
final familyCardsProvider = FutureProvider.autoDispose<List<FamilyCard>>(
  (ref) => ref.read(familyRepositoryProvider).cards(),
);

/// Which child a parent is looking at. A student always has exactly one card,
/// so this stays 0 for them.
class SelectedChildNotifier extends Notifier<int> {
  @override
  int build() => 0;
  void select(int index) => state = index;
}

final selectedChildProvider = NotifierProvider<SelectedChildNotifier, int>(
  SelectedChildNotifier.new,
);

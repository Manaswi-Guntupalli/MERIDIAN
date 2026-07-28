import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /timetable — the school's live published grid. Teachers and students
//    both read it; each view filters it to the rows that concern them. ──

class TimetableSlot {
  const TimetableSlot({
    required this.day,
    required this.period,
    required this.className,
    required this.classId,
    required this.subject,
    required this.colorHex,
    required this.teacher,
    required this.teacherId,
    this.room,
  });

  /// 0 = Monday, matching Kairos.
  final int day;
  final int period;
  final String className;
  final String classId;
  final String subject;
  final String colorHex;
  final String teacher;
  final String teacherId;
  final String? room;

  factory TimetableSlot.fromJson(Map<String, dynamic> j) => TimetableSlot(
        day: (j['day'] ?? 0) as int,
        period: (j['period'] ?? 0) as int,
        className: j['className'] as String? ?? '',
        classId: j['classId'] as String? ?? '',
        subject: j['subject'] as String? ?? '',
        colorHex: j['subjectColor'] as String? ?? '#0E7C6B',
        teacher: j['teacher'] as String? ?? '',
        teacherId: j['teacherId'] as String? ?? '',
        room: j['room'] as String?,
      );
}

class LiveTimetable {
  const LiveTimetable({
    required this.name,
    required this.days,
    required this.periods,
    required this.slots,
  });

  final String name;

  /// Day labels as the solver published them ("Mon", "Tue", …).
  final List<String> days;
  final int periods;
  final List<TimetableSlot> slots;

  factory LiveTimetable.fromJson(Map<String, dynamic> j) => LiveTimetable(
        name: j['name'] as String? ?? '',
        days: ((j['days'] as List?) ?? const [])
            .map((d) => d.toString())
            .toList(),
        periods: (j['periods'] ?? 0) as int,
        slots: ((j['slots'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(TimetableSlot.fromJson)
            .toList(),
      );

  /// Slots for one weekday, in period order.
  List<TimetableSlot> forDay(int day, {bool Function(TimetableSlot)? where}) {
    final rows = slots
        .where((s) => s.day == day && (where == null || where(s)))
        .toList()
      ..sort((a, b) => a.period.compareTo(b.period));
    return rows;
  }
}

class TimetableRepository {
  TimetableRepository(this._dio);
  final Dio _dio;

  Future<LiveTimetable?> live() async {
    final res = await _dio.get<Map<String, dynamic>>('/timetable');
    final t = res.data?['timetable'];
    if (t is! Map<String, dynamic>) return null;
    return LiveTimetable.fromJson(t);
  }
}

final timetableRepositoryProvider = Provider<TimetableRepository>(
  (ref) => TimetableRepository(ref.read(dioProvider)),
);

final liveTimetableProvider = FutureProvider.autoDispose<LiveTimetable?>(
  (ref) => ref.read(timetableRepositoryProvider).live(),
);

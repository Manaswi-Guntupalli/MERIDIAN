import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /students, GET /classes — the same roster the web ERP lists ──

class StudentRow {
  const StudentRow({
    required this.id,
    required this.name,
    required this.rollNo,
    required this.admissionNo,
    required this.className,
    required this.bloodGroup,
    required this.faceEnrolled,
    required this.guardianName,
    required this.phone,
  });

  final String id;
  final String name;
  final int rollNo;
  final String admissionNo;
  final String? className;
  final String? bloodGroup;
  final bool faceEnrolled;
  final String? guardianName;
  final String? phone;

  factory StudentRow.fromJson(Map<String, dynamic> j) => StudentRow(
        id: j['id'] as String,
        name: j['name'] as String? ?? '—',
        rollNo: (j['rollNo'] ?? 0) as int,
        admissionNo: j['admissionNo'] as String? ?? '',
        className: (j['class'] as Map<String, dynamic>?)?['name'] as String?,
        bloodGroup: j['bloodGroup'] as String?,
        faceEnrolled: (j['faceEnrolled'] ?? false) as bool,
        guardianName: j['guardianName'] as String?,
        phone: j['phone'] as String?,
      );
}

class ClassRow {
  const ClassRow({
    required this.id,
    required this.name,
    required this.students,
    required this.classTeacher,
    required this.room,
  });
  final String id;
  final String name;
  final int students;
  final String? classTeacher;
  final String? room;

  factory ClassRow.fromJson(Map<String, dynamic> j) => ClassRow(
        id: j['id'] as String,
        name: j['name'] as String? ?? '—',
        students: (j['students'] ?? 0) as int,
        classTeacher: j['classTeacher'] as String?,
        room: j['room'] as String?,
      );
}

/// The filter the list is showing — query text plus an optional class.
class StudentQuery {
  const StudentQuery({this.q = '', this.classId});
  final String q;
  final String? classId;

  StudentQuery copyWith({String? q, String? classId, bool clearClass = false}) =>
      StudentQuery(
        q: q ?? this.q,
        classId: clearClass ? null : (classId ?? this.classId),
      );

  @override
  bool operator ==(Object other) =>
      other is StudentQuery && other.q == q && other.classId == classId;

  @override
  int get hashCode => Object.hash(q, classId);
}

class StudentsRepository {
  StudentsRepository(this._dio);
  final Dio _dio;

  Future<List<StudentRow>> fetch(StudentQuery query) async {
    final res = await _dio.get<Map<String, dynamic>>('/students', queryParameters: {
      if (query.q.isNotEmpty) 'q': query.q,
      if (query.classId != null) 'classId': query.classId,
    });
    return ((res.data!['students'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(StudentRow.fromJson)
        .toList();
  }

  Future<List<ClassRow>> fetchClasses() async {
    final res = await _dio.get<Map<String, dynamic>>('/classes');
    return ((res.data!['classes'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(ClassRow.fromJson)
        .toList();
  }
}

final studentsRepositoryProvider = Provider<StudentsRepository>(
  (ref) => StudentsRepository(ref.read(dioProvider)),
);

/// The active filter, driven by the search field and class chips.
class StudentQueryNotifier extends Notifier<StudentQuery> {
  @override
  StudentQuery build() => const StudentQuery();

  void search(String q) => state = state.copyWith(q: q);
  void selectClass(String? classId) => state = classId == null
      ? state.copyWith(clearClass: true)
      : state.copyWith(classId: classId);
}

final studentQueryProvider =
    NotifierProvider<StudentQueryNotifier, StudentQuery>(
        StudentQueryNotifier.new);

final studentsProvider = FutureProvider.autoDispose<List<StudentRow>>((ref) {
  final query = ref.watch(studentQueryProvider);
  return ref.read(studentsRepositoryProvider).fetch(query);
});

final classesProvider = FutureProvider.autoDispose<List<ClassRow>>(
  (ref) => ref.read(studentsRepositoryProvider).fetchClasses(),
);

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /emergency/active, /emergency/:id/state, POST /trigger, /resolve/:id ──
//
// The protocols themselves live in the backend (server/src/services/
// emergency.ts). The app never carries its own copy of what to do in a fire —
// it renders the instruction the server issues for the incident.

class ActiveIncident {
  const ActiveIncident({required this.id, required this.kind});
  final String id;
  final String kind;
}

class IncidentState {
  const IncidentState({
    required this.id,
    required this.title,
    required this.instruction,
    required this.triggeredBy,
    required this.createdAt,
    required this.teachersTotal,
    required this.teachersSafe,
    required this.teachersNeedAssistance,
    required this.teachersPending,
    required this.parentsAcknowledgedPct,
    required this.needAssistance,
    required this.timeline,
    required this.attendanceLocked,
    required this.timetableLocked,
  });

  final String id;
  final String title;
  final String instruction;
  final String? triggeredBy;
  final DateTime? createdAt;

  final int teachersTotal;
  final int teachersSafe;
  final int teachersNeedAssistance;
  final int teachersPending;
  final int parentsAcknowledgedPct;

  final List<({String teacher, String? className, String? note})> needAssistance;
  final List<({String message, String? actor, DateTime? at})> timeline;

  final bool attendanceLocked;
  final bool timetableLocked;

  factory IncidentState.fromJson(Map<String, dynamic> j) {
    final incident = (j['incident'] as Map<String, dynamic>?) ?? const {};
    final teachers = (j['teachers'] as Map<String, dynamic>?) ?? const {};
    final parents = (j['parents'] as Map<String, dynamic>?) ?? const {};
    final locks = (j['locks'] as Map<String, dynamic>?) ?? const {};
    return IncidentState(
      id: incident['id'] as String? ?? '',
      title: incident['title'] as String? ?? 'Emergency',
      instruction: incident['instruction'] as String? ?? '',
      triggeredBy: incident['triggeredBy'] as String?,
      createdAt: DateTime.tryParse(incident['createdAt'] as String? ?? ''),
      teachersTotal: (teachers['total'] ?? 0) as int,
      teachersSafe: (teachers['safe'] ?? 0) as int,
      teachersNeedAssistance: (teachers['needAssistance'] ?? 0) as int,
      teachersPending: (teachers['pending'] ?? 0) as int,
      parentsAcknowledgedPct: (parents['acknowledgedPct'] ?? 0).round(),
      needAssistance: ((j['needAssistanceList'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map((a) => (
                teacher: a['teacher'] as String? ?? '—',
                className: a['className'] as String?,
                note: a['note'] as String?,
              ))
          .toList(),
      timeline: ((j['timeline'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map((t) => (
                message: t['message'] as String? ?? '',
                actor: t['actorName'] as String?,
                at: DateTime.tryParse(t['at'] as String? ?? ''),
              ))
          .toList(),
      attendanceLocked: (locks['attendance'] ?? false) as bool,
      timetableLocked: (locks['timetable'] ?? false) as bool,
    );
  }
}

class EmergencyRepository {
  EmergencyRepository(this._dio);
  final Dio _dio;

  Future<ActiveIncident?> active() async {
    final res = await _dio.get<Map<String, dynamic>>('/emergency/active');
    final a = res.data?['active'];
    if (a is! Map<String, dynamic>) return null;
    return ActiveIncident(
        id: a['id'] as String, kind: a['kind'] as String? ?? '');
  }

  Future<IncidentState> state(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/emergency/$id/state');
    return IncidentState.fromJson(res.data!);
  }

  Future<void> trigger(String kind) async =>
      _dio.post('/emergency/trigger', data: {'kind': kind});

  Future<void> resolve(String id) async => _dio.post('/emergency/resolve/$id');
}

final emergencyRepositoryProvider = Provider<EmergencyRepository>(
  (ref) => EmergencyRepository(ref.read(dioProvider)),
);

final activeIncidentProvider = FutureProvider.autoDispose<ActiveIncident?>(
  (ref) => ref.read(emergencyRepositoryProvider).active(),
);

final incidentStateProvider =
    FutureProvider.autoDispose.family<IncidentState, String>(
  (ref, id) => ref.read(emergencyRepositoryProvider).state(id),
);

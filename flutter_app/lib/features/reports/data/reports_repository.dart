import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /reports/summary — live figures assembled into an executive summary ──

class ReportMetrics {
  const ReportMetrics({
    required this.students,
    required this.teachers,
    required this.classes,
    required this.attendanceRate,
    required this.collected,
    required this.outstanding,
    required this.documents,
    required this.overloaded,
  });

  final int students;
  final int teachers;
  final int classes;

  /// Null when roll-call has not been taken today — an unmeasured rate, not 0%.
  final int? attendanceRate;
  final num collected;
  final num outstanding;
  final int documents;
  final List<String> overloaded;

  factory ReportMetrics.fromJson(Map<String, dynamic> j) => ReportMetrics(
        students: (j['students'] ?? 0) as int,
        teachers: (j['teachers'] ?? 0) as int,
        classes: (j['classes'] ?? 0) as int,
        attendanceRate: (j['attendanceRate'] as num?)?.round(),
        collected: (j['collected'] ?? 0) as num,
        outstanding: (j['outstanding'] ?? 0) as num,
        documents: (j['documents'] ?? 0) as int,
        overloaded: ((j['overloaded'] as List?) ?? const []).cast<String>(),
      );
}

class ReportPrediction {
  const ReportPrediction({required this.label, required this.note});
  final String label;
  final String note;

  factory ReportPrediction.fromJson(Map<String, dynamic> j) => ReportPrediction(
        label: j['label'] as String? ?? '',
        note: j['note'] as String? ?? '',
      );
}

class ReportSummary {
  const ReportSummary({
    required this.title,
    required this.narrative,
    required this.generatedAt,
    required this.metrics,
    required this.recommendations,
    required this.predictions,
    required this.engineOnline,
  });

  final String title;
  final String narrative;
  final DateTime? generatedAt;
  final ReportMetrics metrics;
  final List<String> recommendations;
  final List<ReportPrediction> predictions;

  /// False when the Python engine is unreachable — forecasts are then absent
  /// rather than fabricated locally.
  final bool engineOnline;

  factory ReportSummary.fromJson(Map<String, dynamic> j) => ReportSummary(
        title: j['title'] as String? ?? 'Report',
        narrative: j['narrative'] as String? ?? '',
        generatedAt: DateTime.tryParse(j['generatedAt'] as String? ?? ''),
        metrics: ReportMetrics.fromJson(
            (j['metrics'] as Map<String, dynamic>?) ?? const {}),
        recommendations:
            ((j['recommendations'] as List?) ?? const []).cast<String>(),
        predictions: ((j['predictions'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(ReportPrediction.fromJson)
            .toList(),
        engineOnline: (j['engineOnline'] ?? false) as bool,
      );
}

class ReportsRepository {
  ReportsRepository(this._dio);
  final Dio _dio;

  Future<ReportSummary> summary() async {
    final res = await _dio.get<Map<String, dynamic>>('/reports/summary');
    return ReportSummary.fromJson(res.data!);
  }
}

final reportsRepositoryProvider = Provider<ReportsRepository>(
  (ref) => ReportsRepository(ref.read(dioProvider)),
);

final reportSummaryProvider = FutureProvider.autoDispose<ReportSummary>(
  (ref) => ref.read(reportsRepositoryProvider).summary(),
);

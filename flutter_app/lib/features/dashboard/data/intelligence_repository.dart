import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/intelligence — Node proxies the Python engine and wraps it as
// { engine: 'online' | 'offline', payload?, error? }.
//
// HONESTY CONTRACT (same as the web): every number here is computed by the
// engine. The app formats and ranks NOTHING itself, and when the engine is
// offline it says so instead of falling back to invented values.
// ─────────────────────────────────────────────────────────────────────────────

/// One ranked action, with the arithmetic that produced its rank.
class IntelRecommendation {
  const IntelRecommendation({
    required this.id,
    required this.title,
    required this.detail,
    required this.severity,
    required this.priorityScore,
    required this.affectedCount,
    required this.estimatedEffortMins,
    required this.confidence,
    required this.formula,
    required this.breakdown,
    required this.actionLabel,
  });

  final String id;
  final String title;
  final String detail;
  final String severity;
  final int priorityScore;
  final int affectedCount;
  final int estimatedEffortMins;

  /// 0..1, straight from the engine's priorityBreakdown.
  final double confidence;

  /// The engine's own formula string — shown verbatim under "Why this rank?".
  final String formula;

  /// businessImpact / urgency / confidence / affectedFactor / operationalRisk.
  final Map<String, num> breakdown;
  final String actionLabel;

  factory IntelRecommendation.fromJson(Map<String, dynamic> j) {
    final b = (j['priorityBreakdown'] as Map<String, dynamic>?) ?? const {};
    return IntelRecommendation(
      id: j['id'] as String? ?? '',
      title: j['title'] as String? ?? '',
      detail: j['detail'] as String? ?? '',
      severity: j['severity'] as String? ?? 'INFO',
      priorityScore: (j['priorityScore'] ?? 0).round(),
      affectedCount: (j['affectedCount'] ?? 0).round(),
      estimatedEffortMins: (j['estimatedEffortMins'] ?? 0).round(),
      confidence: ((b['confidence'] ?? 0) as num).toDouble(),
      formula: b['formula'] as String? ?? '',
      breakdown: {
        for (final k in const [
          'businessImpact',
          'urgency',
          'confidence',
          'affectedFactor',
          'operationalRisk',
        ])
          if (b[k] is num) k: b[k] as num,
      },
      actionLabel:
          ((j['action'] as Map<String, dynamic>?)?['label'] as String?) ?? 'Open',
    );
  }
}

/// One evidence row on an insight (label / value / optional detail).
class IntelEvidence {
  const IntelEvidence({required this.label, required this.value, this.detail});
  final String label;
  final String value;
  final String? detail;

  factory IntelEvidence.fromJson(Map<String, dynamic> j) => IntelEvidence(
        label: j['label']?.toString() ?? '',
        value: j['value']?.toString() ?? '',
        detail: j['detail']?.toString(),
      );
}

class IntelInsight {
  const IntelInsight({
    required this.id,
    required this.module,
    required this.severity,
    required this.title,
    required this.reason,
    required this.evidence,
    required this.confidence,
  });

  final String id;
  final String module;
  final String severity;
  final String title;
  final String reason;
  final List<IntelEvidence> evidence;

  /// 0..100, as the engine reports it.
  final int confidence;

  factory IntelInsight.fromJson(Map<String, dynamic> j) => IntelInsight(
        id: j['id'] as String? ?? '',
        module: j['module'] as String? ?? '',
        severity: j['severity'] as String? ?? 'INFO',
        title: j['title'] as String? ?? '',
        reason: j['reason'] as String? ?? '',
        evidence: ((j['evidence'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(IntelEvidence.fromJson)
            .toList(),
        confidence:
            (((j['confidence'] as Map<String, dynamic>?)?['value'] ?? 0) as num)
                .round(),
      );
}

/// One weighted category of the engine's health score. `score` is null when a
/// category has no data — the engine drops it from the average and says so.
class IntelHealthCategory {
  const IntelHealthCategory({
    required this.name,
    required this.score,
    required this.weight,
  });
  final String name;
  final double? score;
  final double weight;

  /// 'attendance' ➜ 'Attendance'
  String get label =>
      name.isEmpty ? name : name[0].toUpperCase() + name.substring(1);
}

class IntelHealth {
  const IntelHealth({
    required this.overall,
    required this.categories,
    required this.method,
  });
  final double? overall;
  final List<IntelHealthCategory> categories;
  final String method;

  /// The web shows the four heaviest categories that actually have data.
  List<IntelHealthCategory> get topCategories {
    final withData = categories.where((c) => c.score != null).toList()
      ..sort((a, b) => b.weight.compareTo(a.weight));
    return withData.take(4).toList();
  }

  factory IntelHealth.fromJson(Map<String, dynamic> j) {
    final cats = (j['categories'] as Map<String, dynamic>?) ?? const {};
    return IntelHealth(
      overall: (j['overall'] as num?)?.toDouble(),
      method: j['method'] as String? ?? '',
      categories: [
        for (final e in cats.entries)
          IntelHealthCategory(
            name: e.key,
            score: ((e.value as Map<String, dynamic>?)?['score'] as num?)
                ?.toDouble(),
            weight:
                (((e.value as Map<String, dynamic>?)?['weight'] ?? 0) as num)
                    .toDouble(),
          ),
      ],
    );
  }
}

class IntelPayload {
  const IntelPayload({
    required this.recommendations,
    required this.insights,
    required this.health,
    required this.anchorDate,
    required this.engineVersion,
    required this.computedAt,
  });

  final List<IntelRecommendation> recommendations;
  final List<IntelInsight> insights;
  final IntelHealth health;
  final String anchorDate;
  final String engineVersion;
  final DateTime? computedAt;

  factory IntelPayload.fromJson(Map<String, dynamic> j) {
    final meta = (j['meta'] as Map<String, dynamic>?) ?? const {};
    return IntelPayload(
      recommendations: ((j['recommendations'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(IntelRecommendation.fromJson)
          .toList(),
      insights: ((j['insights'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(IntelInsight.fromJson)
          .toList(),
      health: IntelHealth.fromJson(
          (j['healthScore'] as Map<String, dynamic>?) ?? const {}),
      anchorDate: meta['anchorDate'] as String? ?? '',
      engineVersion: meta['engineVersion'] as String? ?? '',
      computedAt: DateTime.tryParse(meta['computedAt'] as String? ?? ''),
    );
  }
}

/// Engine online with a payload, or offline with the reason — never a
/// half-populated payload standing in for real data.
class IntelResult {
  const IntelResult({required this.online, this.payload, this.error});
  final bool online;
  final IntelPayload? payload;
  final String? error;
}

class IntelligenceRepository {
  IntelligenceRepository(this._dio);
  final Dio _dio;

  Future<IntelResult> fetch() async {
    final res =
        await _dio.get<Map<String, dynamic>>('/dashboard/intelligence');
    final body = res.data ?? const {};
    if (body['engine'] != 'online' || body['payload'] == null) {
      return IntelResult(
        online: false,
        error: body['error'] as String? ?? 'The intelligence engine is unreachable.',
      );
    }
    return IntelResult(
      online: true,
      payload:
          IntelPayload.fromJson(body['payload'] as Map<String, dynamic>),
    );
  }
}

final intelligenceRepositoryProvider = Provider<IntelligenceRepository>(
  (ref) => IntelligenceRepository(ref.read(dioProvider)),
);

/// Ranked actions + insights. Separate from `dashboardStatsProvider` on purpose:
/// the counts render instantly while the engine's ~2s scoring pass fills in,
/// exactly as the web dashboard behaves.
final intelligenceProvider = FutureProvider.autoDispose<IntelResult>(
  (ref) => ref.read(intelligenceRepositoryProvider).fetch(),
);

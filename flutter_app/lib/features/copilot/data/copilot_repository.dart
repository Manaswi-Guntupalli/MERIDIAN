import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── POST /copilot/ask, GET /copilot/suggestions, POST /actions/execute ──

/// A suggested follow-up. Either a navigation hint (`to`) or a real operation
/// (`executeKind`) that the backend performs and audits.
class CopilotAction {
  const CopilotAction({required this.label, this.to, this.executeKind, this.params});
  final String label;
  final String? to;
  final String? executeKind;
  final Map<String, dynamic>? params;

  bool get isExecutable => executeKind != null;

  factory CopilotAction.fromJson(Map<String, dynamic> j) {
    final ex = j['execute'] as Map<String, dynamic>?;
    return CopilotAction(
      label: j['label'] as String? ?? 'Open',
      to: j['to'] as String?,
      executeKind: ex?['kind'] as String?,
      params: (ex?['params'] as Map<String, dynamic>?),
    );
  }
}

class CopilotAnswer {
  const CopilotAnswer({
    required this.answer,
    required this.confidence,
    required this.source,
    required this.grounded,
    required this.actions,
  });

  final String answer;

  /// 0..1 from the backend — never computed on the device.
  final double confidence;

  /// 'openai' (facts from the DB, phrased by the model) or a live-DB answer.
  final String source;
  final bool grounded;
  final List<CopilotAction> actions;

  /// What the web prints under every answer.
  String get provenance =>
      source == 'openai' ? 'facts from DB, AI-phrased' : 'live DB';

  factory CopilotAnswer.fromJson(Map<String, dynamic> j) => CopilotAnswer(
        answer: j['answer'] as String? ?? '',
        confidence: ((j['confidence'] ?? 0) as num).toDouble(),
        source: j['source'] as String? ?? 'db',
        grounded: (j['grounded'] ?? true) as bool,
        actions: ((j['actions'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(CopilotAction.fromJson)
            .toList(),
      );
}

class CopilotRepository {
  CopilotRepository(this._dio);
  final Dio _dio;

  Future<List<String>> suggestions() async {
    final res = await _dio.get<Map<String, dynamic>>('/copilot/suggestions');
    return ((res.data!['suggestions'] as List?) ?? const []).cast<String>();
  }

  Future<CopilotAnswer> ask(String question) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/copilot/ask',
      data: {'question': question},
    );
    return CopilotAnswer.fromJson(res.data!);
  }

  /// Runs the operation for real (reminders sent, cover assigned…) and returns
  /// the server's summary plus its detail lines.
  Future<({String summary, List<String> detail})> execute(
      String kind, Map<String, dynamic>? params) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/actions/execute',
      data: {'kind': kind, ...?params},
    );
    final d = res.data ?? const {};
    return (
      summary: d['summary'] as String? ?? 'Done.',
      detail: ((d['detail'] as List?) ?? const []).cast<String>(),
    );
  }
}

final copilotRepositoryProvider = Provider<CopilotRepository>(
  (ref) => CopilotRepository(ref.read(dioProvider)),
);

final copilotSuggestionsProvider = FutureProvider.autoDispose<List<String>>(
  (ref) => ref.read(copilotRepositoryProvider).suggestions(),
);

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/ui/ui.dart';
import '../data/intelligence_repository.dart';

/// The web dashboard's "Recommended actions" panel, ported to mobile.
///
/// Every value shown — rank, priority, affected count, confidence — is computed
/// by the Python engine and rendered verbatim. The "Why this rank?" expansion
/// shows the engine's own formula, so the ranking is auditable on a phone the
/// same way it is in the browser. When the engine is offline the card says so
/// rather than showing numbers it cannot stand behind.
class RecommendedActions extends ConsumerWidget {
  const RecommendedActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final intel = ref.watch(intelligenceProvider);

    return MCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome_outlined,
                    size: 16, color: AppColors.brand),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Recommended actions',
                      style: AppType.display(17, weight: FontWeight.w600)),
                ),
                intel.when(
                  loading: () => const Text('scoring…',
                      style: TextStyle(fontSize: 11, color: AppColors.slate400)),
                  error: (_, _) => const MBadge('engine offline',
                      severity: 'WARNING', icon: Icons.warning_amber_rounded),
                  data: (r) => r.online
                      ? const SizedBox.shrink()
                      : const MBadge('engine offline',
                          severity: 'WARNING',
                          icon: Icons.warning_amber_rounded),
                ),
              ],
            ),
          ),
          intel.when(
            loading: () => const _ScoringSkeleton(),
            error: (e, _) => const _EngineOffline(
                message: 'The intelligence engine is unreachable.'),
            data: (result) {
              if (!result.online) {
                return _EngineOffline(message: result.error);
              }
              final recs = result.payload!.recommendations;
              if (recs.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.fromLTRB(18, 0, 18, 20),
                  child: Text(
                    'No actions recommended — nothing crossed the evidence thresholds.',
                    style: TextStyle(fontSize: 13, color: AppColors.slate500),
                  ),
                );
              }
              return Column(
                children: [
                  // The ranking rule, stated where the ranking is shown.
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                    child: Row(
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(
                              color: AppColors.mint, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 7),
                        const Expanded(
                          child: Text(
                            'ranked by impact × urgency × confidence',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.slate500),
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (int i = 0; i < recs.length; i++)
                    _ActionRow(rec: recs[i], rank: i + 1),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ActionRow extends StatefulWidget {
  const _ActionRow({required this.rec, required this.rank});
  final IntelRecommendation rec;
  final int rank;

  @override
  State<_ActionRow> createState() => _ActionRowState();
}

class _ActionRowState extends State<_ActionRow> {
  bool _why = false;

  @override
  Widget build(BuildContext context) {
    final r = widget.rec;
    final sev = AppColors.severity(r.severity);

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: sev.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: sev.withValues(alpha: 0.30)),
                ),
                child: Text('#${widget.rank}',
                    style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w700, color: sev)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.title,
                        style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.slate900)),
                    if (r.detail.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(r.detail,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.slate500)),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // The engine's metadata, in the web's order.
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              _meta('priority', '${r.priorityScore}'),
              _meta('affects', '${r.affectedCount}'),
              _meta('~${r.estimatedEffortMins}m effort', '(estimate)',
                  valueFirst: false),
              _meta('conf', '${(r.confidence * 100).round()}%',
                  color: r.confidence >= 0.75
                      ? AppColors.mint
                      : r.confidence >= 0.5
                          ? AppColors.amber
                          : AppColors.rose),
            ],
          ),
          if (r.formula.isNotEmpty) ...[
            const SizedBox(height: 8),
            InkWell(
              onTap: () => setState(() => _why = !_why),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Why this rank?',
                      style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.brand)),
                  Icon(_why ? Icons.expand_less : Icons.expand_more,
                      size: 16, color: AppColors.brand),
                ],
              ),
            ),
            if (_why)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.well,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${r.formula} = ${r.priorityScore}',
                        style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.5,
                            color: AppColors.slate600)),
                    if (r.breakdown.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        r.breakdown.entries
                            .map((e) => '${_pretty(e.key)} ${e.value}')
                            .join(' · '),
                        style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.5,
                            color: AppColors.slate500),
                      ),
                    ],
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _meta(String label, String value,
          {Color? color, bool valueFirst = true}) =>
      RichText(
        text: TextSpan(
          style: const TextStyle(fontSize: 11, color: AppColors.slate400),
          children: valueFirst
              ? [
                  TextSpan(text: '$label '),
                  TextSpan(
                      text: value,
                      style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: color ?? AppColors.slate600)),
                ]
              : [
                  TextSpan(
                      text: '$label ',
                      style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: color ?? AppColors.slate600)),
                  TextSpan(text: value),
                ],
        ),
      );

  static String _pretty(String key) => switch (key) {
        'businessImpact' => 'impact',
        'operationalRisk' => 'risk',
        'affectedFactor' => 'affected',
        _ => key,
      };
}

/// Keeps the panel's height stable while the engine scores.
class _ScoringSkeleton extends StatelessWidget {
  const _ScoringSkeleton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
      child: Column(
        children: [
          for (int i = 0; i < 3; i++)
            const Padding(
              padding: EdgeInsets.only(bottom: 14),
              child: Row(
                children: [
                  MSkeleton(width: 30, height: 30, radius: 10),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        MSkeleton(height: 12),
                        SizedBox(height: 6),
                        MSkeleton(width: 160, height: 10),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The same refusal the web makes: no engine, no numbers.
class _EngineOffline extends StatelessWidget {
  const _EngineOffline({this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  size: 16, color: AppColors.amber),
              SizedBox(width: 8),
              Text('Intelligence engine offline',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.slate800)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            message == null || message!.isEmpty
                ? 'Insights, confidence scores and rankings are computed by the engine — nothing is invented on the device.'
                : '$message Insights and rankings are computed by the engine — nothing is invented on the device.',
            style: const TextStyle(
                fontSize: 12.5, height: 1.45, color: AppColors.slate500),
          ),
        ],
      ),
    );
  }
}

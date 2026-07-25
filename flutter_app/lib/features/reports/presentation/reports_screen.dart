import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/reports_repository.dart';

/// The web's AI-generated report: live figures, an executive narrative,
/// recommendations, and forecast highlights. Regenerate refetches from the
/// server — the phone assembles nothing itself.
class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final report = ref.watch(reportSummaryProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(reportSummaryProvider);
        await ref.read(reportSummaryProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: 'Trust Core',
            title: 'AI reports',
            subtitle:
                'Live figures assembled into an executive summary — grounded, never guessed.',
            actions: [
              MButton(
                'Regenerate',
                icon: Icons.auto_awesome,
                kind: MButtonKind.ghost,
                dense: true,
                onPressed: () => ref.invalidate(reportSummaryProvider),
              ),
            ],
          ),
          MAsyncView<ReportSummary>(
            value: report,
            loadingLabel: 'Generating report…',
            onRetry: () => ref.invalidate(reportSummaryProvider),
            builder: (r) {
              final m = r.metrics;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _tiles([
                    StatTile(
                        label: 'Students',
                        value: '${m.students}',
                        accent: MAccent.cyan),
                    StatTile(
                        label: 'Attendance',
                        value: m.attendanceRate == null
                            ? '—'
                            : '${m.attendanceRate}%',
                        sub: m.attendanceRate == null ? 'not marked yet' : null,
                        accent: MAccent.mint),
                    StatTile(
                        label: 'Collected',
                        value: inr(m.collected),
                        accent: MAccent.brand),
                    StatTile(
                        label: 'Outstanding',
                        value: inr(m.outstanding),
                        accent: MAccent.amber),
                  ]),
                  const SizedBox(height: 14),

                  // ── Narrative ──
                  MCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        MSectionTitle(
                          title: r.title,
                          action: r.generatedAt == null
                              ? null
                              : MBadge(timeAgo(r.generatedAt)),
                        ),
                        Text(
                          r.narrative,
                          style: const TextStyle(
                              fontSize: 13.5,
                              height: 1.6,
                              color: AppColors.slate600),
                        ),
                        if (r.recommendations.isNotEmpty) ...[
                          const SizedBox(height: 18),
                          Text('RECOMMENDATIONS', style: AppType.label),
                          const SizedBox(height: 8),
                          for (final rec in r.recommendations)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: AppColors.well,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: AppColors.line),
                                ),
                                child: Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    const Icon(Icons.check_circle_outline,
                                        size: 16, color: AppColors.mint),
                                    const SizedBox(width: 9),
                                    Expanded(
                                      child: Text(
                                        rec,
                                        style: const TextStyle(
                                            fontSize: 13,
                                            height: 1.45,
                                            color: AppColors.slate600),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),

                  // ── Forecasts ──
                  MCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const MSectionTitle(
                            overline: 'Foresight',
                            title: 'Forecast highlights'),
                        if (!r.engineOnline || r.predictions.isEmpty)
                          const Text(
                            'Intelligence engine offline — forecasts are computed there, never invented here.',
                            style: TextStyle(
                                fontSize: 12.5,
                                height: 1.45,
                                color: AppColors.slate500),
                          )
                        else
                          for (final p in r.predictions)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: AppColors.well,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: AppColors.line),
                                ),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text(p.label,
                                        style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: AppColors.slate700)),
                                    const SizedBox(height: 3),
                                    Text(p.note,
                                        style: const TextStyle(
                                            fontSize: 11,
                                            color: AppColors.slate500)),
                                  ],
                                ),
                              ),
                            ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _tiles(List<Widget> tiles) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: 12),
            Expanded(
              child:
                  i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink(),
            ),
          ],
        ),
      ));
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 12));
    }
    return Column(children: rows);
  }
}

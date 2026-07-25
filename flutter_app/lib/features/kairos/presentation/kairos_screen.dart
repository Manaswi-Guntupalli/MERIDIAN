import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/ui/ui.dart';
import '../data/kairos_repository.dart';

/// Kairos on a phone: read the solver's published health and approve or
/// publish a pending draft. Generating and editing the grid stay on the web —
/// this screen carries only the decision, with the evidence behind it.
class KairosScreen extends ConsumerStatefulWidget {
  const KairosScreen({super.key});

  @override
  ConsumerState<KairosScreen> createState() => _KairosScreenState();
}

class _KairosScreenState extends ConsumerState<KairosScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(kairosOverviewProvider);
      await ref.read(kairosOverviewProvider.future);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(done)));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Publishing replaces the live timetable for the whole school, so it asks
  /// first — the same weight the web gives it.
  Future<void> _confirmPublish() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Publish this timetable?'),
        content: const Text(
          'It becomes the live timetable for every class and teacher, '
          'replacing the current one. The previous version stays in history.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Publish')),
        ],
      ),
    );
    if (ok == true) {
      await _run(ref.read(kairosRepositoryProvider).publish,
          'Published — it is now the live timetable.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final overview = ref.watch(kairosOverviewProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(kairosOverviewProvider);
        await ref.read(kairosOverviewProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          const MPageHeader(
            overline: 'Kairos',
            title: 'Timetable',
            subtitle:
                'Review the solver’s own health report, then approve or publish. Generation and grid edits stay on the web.',
          ),
          MAsyncView<KairosOverview>(
            value: overview,
            loadingLabel: 'Loading timetable…',
            onRetry: () => ref.invalidate(kairosOverviewProvider),
            builder: (o) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Pending draft: the decision ──
                if (o.draft != null) ...[
                  _DraftCard(
                    draft: o.draft!,
                    busy: _busy,
                    onApprove: () => _run(
                        ref.read(kairosRepositoryProvider).approve,
                        'Draft approved — ready to publish.'),
                    onPublish: _confirmPublish,
                  ),
                  const SizedBox(height: 14),
                ],

                // ── The live timetable ──
                if (o.active != null)
                  _TimetableCard(
                    meta: o.active!,
                    overline: 'Live',
                    title: 'Published timetable',
                  )
                else
                  const MEmptyState(
                    icon: Icons.calendar_month_outlined,
                    title: 'No published timetable',
                    hint: 'Generate one in Kairos on the web, then approve it here.',
                  ),

                if (o.draft == null) ...[
                  const SizedBox(height: 14),
                  MCard(
                    child: Row(
                      children: [
                        const Icon(Icons.inbox_outlined,
                            size: 18, color: AppColors.slate400),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'No draft is waiting for approval.',
                            style: const TextStyle(
                                fontSize: 13, color: AppColors.slate500),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                // ── Setup facts ──
                const SizedBox(height: 14),
                MCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const MSectionTitle(
                          overline: 'Inputs', title: 'What the solver works with'),
                      _fact('Working days', '${o.workingDays}'),
                      _fact('Periods per day', '${o.periodsPerDay}'),
                      _fact('Teachers', '${o.teachers}'),
                      _fact('Classes with a plan',
                          '${o.classesWithPlan} of ${o.classesTotal}'),
                      if (o.issues.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text('SETUP ISSUES', style: AppType.label),
                        const SizedBox(height: 8),
                        for (final i in o.issues.take(5)) _issue(i),
                        if (o.issues.length > 5)
                          Text('+${o.issues.length - 5} more',
                              style: const TextStyle(
                                  fontSize: 11.5, color: AppColors.slate400)),
                      ],
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

  /// The server writes the title, detail and remediation — all three are shown
  /// as written rather than compressed into one line.
  Widget _issue(KairosIssue i) {
    final color = i.isBlocker ? AppColors.rose : AppColors.amber;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.24)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
                i.isBlocker
                    ? Icons.block
                    : Icons.warning_amber_rounded,
                size: 15,
                color: color),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(i.title,
                      style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          height: 1.35,
                          color: AppColors.slate800)),
                  if (i.detail.isNotEmpty)
                    Text(i.detail,
                        style: const TextStyle(
                            fontSize: 12,
                            height: 1.4,
                            color: AppColors.slate600)),
                  if (i.fix.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(i.fix,
                          style: const TextStyle(
                              fontSize: 11.5,
                              height: 1.4,
                              fontStyle: FontStyle.italic,
                              color: AppColors.slate500)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fact(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: const TextStyle(
                      fontSize: 13, color: AppColors.slate600)),
            ),
            Text(value,
                style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate800)),
          ],
        ),
      );
}

class _DraftCard extends StatelessWidget {
  const _DraftCard({
    required this.draft,
    required this.busy,
    required this.onApprove,
    required this.onPublish,
  });

  final TimetableMeta draft;
  final bool busy;
  final VoidCallback onApprove;
  final VoidCallback onPublish;

  @override
  Widget build(BuildContext context) {
    final approved = draft.isApproved;
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: 'Awaiting you',
            title: approved ? 'Approved draft' : 'Draft to review',
            action: MBadge(approved ? 'APPROVED' : 'DRAFT',
                severity: approved ? 'SUCCESS' : 'INFO'),
          ),
          _ScoreRow(meta: draft),
          if (draft.health != null && draft.health!.unplaced.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.rose.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border:
                    Border.all(color: AppColors.rose.withValues(alpha: 0.25)),
              ),
              child: Text(
                '${draft.health!.unplaced.length} lesson(s) could not be placed. '
                'Publishing leaves those periods empty.',
                style: const TextStyle(
                    fontSize: 12.5, height: 1.4, color: AppColors.roseDeep),
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              if (!approved)
                Expanded(
                  child: MButton('Approve',
                      icon: Icons.check,
                      busy: busy,
                      onPressed: busy ? null : onApprove),
                ),
              if (!approved) const SizedBox(width: 10),
              Expanded(
                child: MButton(
                  'Publish',
                  icon: Icons.publish,
                  kind: approved ? MButtonKind.primary : MButtonKind.ghost,
                  busy: busy,
                  onPressed: busy ? null : onPublish,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TimetableCard extends StatelessWidget {
  const _TimetableCard({
    required this.meta,
    required this.overline,
    required this.title,
  });

  final TimetableMeta meta;
  final String overline;
  final String title;

  @override
  Widget build(BuildContext context) {
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: overline,
            title: title,
            action: MBadge('v${meta.version}'),
          ),
          _ScoreRow(meta: meta),
          if (meta.health != null && meta.health!.warnings.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('SOLVER WARNINGS', style: AppType.label),
            const SizedBox(height: 7),
            for (final w in meta.health!.warnings.take(4))
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.info_outline,
                        size: 14, color: AppColors.slate400),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(w,
                          style: const TextStyle(
                              fontSize: 12,
                              height: 1.4,
                              color: AppColors.slate500)),
                    ),
                  ],
                ),
              ),
            if (meta.health!.warnings.length > 4)
              Text('+${meta.health!.warnings.length - 4} more',
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.slate400)),
          ],
        ],
      ),
    );
  }
}

/// Score plus the solver's own sub-scores — the same numbers Kairos publishes,
/// not a mobile re-derivation.
class _ScoreRow extends StatelessWidget {
  const _ScoreRow({required this.meta});
  final TimetableMeta meta;

  @override
  Widget build(BuildContext context) {
    final h = meta.health;
    final score = h?.score ?? meta.score;
    final accent = score >= 85
        ? MAccent.mint
        : score >= 70
            ? MAccent.brand
            : score >= 50
                ? MAccent.amber
                : MAccent.rose;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('$score',
                style: AppType.display(34,
                    weight: FontWeight.w600, letterSpacing: 0)),
            const SizedBox(width: 4),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('/100',
                  style: const TextStyle(
                      fontSize: 13, color: AppColors.slate400)),
            ),
            const Spacer(),
            Flexible(
              child: Text(meta.name,
                  textAlign: TextAlign.right,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppColors.slate500)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        MMeter(value: score.toDouble(), accent: accent),
        if (h != null && h.breakdown.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 14,
            runSpacing: 6,
            children: [
              for (final e in h.breakdown.entries)
                RichText(
                  text: TextSpan(
                    style: const TextStyle(
                        fontSize: 11.5, color: AppColors.slate400),
                    children: [
                      TextSpan(text: '${e.key} '),
                      TextSpan(
                        text: '${e.value}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.slate600),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

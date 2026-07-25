import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/attendance_repository.dart';

/// Presence, read-only on mobile: today's roll-call state, which sessions are
/// live, and who is arriving late. Marking happens at the Face kiosk and the
/// projector QR — the phone is the principal's view of it, not a third
/// capture path.
class AttendanceScreen extends ConsumerWidget {
  const AttendanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = ref.watch(presenceTodayProvider);
    final sessions = ref.watch(presenceSessionsProvider);
    final late = ref.watch(lateStudentsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(presenceTodayProvider);
        ref.invalidate(presenceSessionsProvider);
        ref.invalidate(lateStudentsProvider);
        await ref.read(presenceTodayProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          const MPageHeader(
            overline: 'Presence',
            title: 'Attendance',
            subtitle:
                'Face recognition and session QR both write the same register — this is the live state of it.',
          ),
          MAsyncView<PresenceToday>(
            value: today,
            loadingLabel: 'Reading today’s register…',
            onRetry: () => ref.invalidate(presenceTodayProvider),
            builder: (t) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _TodayCard(today: t),
                const SizedBox(height: 14),

                // ── Live sessions ──
                MCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      MSectionTitle(
                        overline: 'Roll-call',
                        title: 'Sessions',
                        action: sessions.value == null
                            ? null
                            : MBadge(
                                '${sessions.value!.where((s) => s.isActive).length} live',
                                severity: sessions.value!
                                        .any((s) => s.isActive)
                                    ? 'SUCCESS'
                                    : null,
                              ),
                      ),
                      sessions.when(
                        loading: () => const Padding(
                          padding: EdgeInsets.symmetric(vertical: 10),
                          child: MSkeleton(height: 14),
                        ),
                        error: (_, _) => const Text(
                            'Could not load sessions.',
                            style: TextStyle(
                                fontSize: 13, color: AppColors.slate500)),
                        data: (list) {
                          if (list.isEmpty) {
                            return const Text(
                              'No attendance sessions today.',
                              style: TextStyle(
                                  fontSize: 13, color: AppColors.slate500),
                            );
                          }
                          final sorted = [...list]..sort((a, b) =>
                              (b.isActive ? 1 : 0).compareTo(a.isActive ? 1 : 0));
                          return Column(
                            children: [
                              for (final s in sorted.take(8))
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 9),
                                  child: Row(
                                    children: [
                                      Container(
                                        width: 8,
                                        height: 8,
                                        decoration: BoxDecoration(
                                          color: s.isActive
                                              ? AppColors.mint
                                              : AppColors.slate300,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Text(
                                          s.className,
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w600,
                                              color: AppColors.slate800),
                                        ),
                                      ),
                                      Text(
                                        s.isActive
                                            ? '${s.roster} on register'
                                            : s.status.toLowerCase(),
                                        style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.slate500),
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
                ),
                const SizedBox(height: 14),

                // ── Late arrivals ──
                MCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const MSectionTitle(
                          overline: 'Punctuality', title: 'Frequent late arrivals'),
                      late.when(
                        loading: () => const MSkeleton(height: 14),
                        error: (_, _) => const Text(
                            'Could not load late arrivals.',
                            style: TextStyle(
                                fontSize: 13, color: AppColors.slate500)),
                        data: (rows) => rows.isEmpty
                            ? const Text(
                                'No repeated late arrivals in the window.',
                                style: TextStyle(
                                    fontSize: 13, color: AppColors.slate500),
                              )
                            : Column(
                                children: [
                                  for (final s in rows.take(6))
                                    Padding(
                                      padding: const EdgeInsets.only(bottom: 9),
                                      child: Row(
                                        children: [
                                          Expanded(
                                            child: MIdentity(
                                              initials: initials(s.name),
                                              title: s.name,
                                              sub: s.className,
                                              accent: MAccent.amber,
                                            ),
                                          ),
                                          MBadge('${s.count}×',
                                              severity: 'WARNING'),
                                        ],
                                      ),
                                    ),
                                ],
                              ),
                      ),
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

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.today});
  final PresenceToday today;

  @override
  Widget build(BuildContext context) {
    final t = today;
    final rate = t.rateOfMarked;
    final inProgress = t.unmarked > 0 && t.marked > 0;

    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: t.date,
            title: inProgress ? 'Roll-call in progress' : 'Today',
            action: t.proxyAttempts > 0
                ? MBadge('${t.proxyAttempts} proxy blocked',
                    severity: 'WARNING')
                : const MBadge('No proxy attempts', severity: 'SUCCESS'),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                rate == null ? '—' : '${rate.round()}%',
                style: AppType.display(40,
                    weight: FontWeight.w600, letterSpacing: 0),
              ),
              const SizedBox(width: 10),
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  rate == null
                      ? 'roll-call not started'
                      : 'of ${t.marked} marked',
                  style: const TextStyle(
                      fontSize: 13, color: AppColors.slate500),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Counts, not a derived percentage — the four states are what the
          // register actually holds.
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _pill('Present', t.present, AppColors.mint),
              _pill('Late', t.late, AppColors.amber),
              _pill('Absent', t.absent, AppColors.rose),
              _pill('Unmarked', t.unmarked, AppColors.slate400),
            ],
          ),
          if (inProgress) ...[
            const SizedBox(height: 12),
            Text(
              '${t.unmarked} of ${t.totalStudents} students are still unmarked — '
              'the rate above covers only what has been marked so far.',
              style: const TextStyle(
                  fontSize: 11.5, height: 1.45, color: AppColors.slate400),
            ),
          ],
        ],
      ),
    );
  }

  Widget _pill(String label, int value, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('$value',
                style: TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(width: 6),
            Text(label,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.slate600)),
          ],
        ),
      );
}

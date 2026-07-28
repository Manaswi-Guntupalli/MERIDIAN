import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../auth/domain/app_user.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../notifications/data/notifications_repository.dart';
import '../data/family_repository.dart';
import 'family_widgets.dart';

/// The web's `FamilyDashboard`, which serves Student and Parent from the same
/// `/dashboard/me` payload. A parent sees a child selector and plural copy; a
/// student sees their own single card. Keeping one screen for both mirrors the
/// web and means the two roles can never drift apart.
class FamilyHomeScreen extends ConsumerWidget {
  const FamilyHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final isParent = user?.role == UserRole.parent;
    final cards = ref.watch(familyCardsProvider);
    final selected = ref.watch(selectedChildProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(familyCardsProvider);
        ref.invalidate(notificationsProvider);
        await ref.read(familyCardsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: user == null
                ? 'Meridian'
                : 'Good ${_dayPart()}, ${firstName(user.name)}',
            title: isParent ? 'Family' : 'My school',
            subtitle: isParent
                ? "Everything about your children's school day, in one place."
                : 'Your attendance, timetable and fees — always up to date.',
          ),
          MAsyncView<List<FamilyCard>>(
            value: cards,
            loadingLabel: 'Loading your dashboard…',
            onRetry: () => ref.invalidate(familyCardsProvider),
            builder: (list) {
              if (list.isEmpty) {
                return MEmptyState(
                  icon: Icons.school_outlined,
                  title: isParent
                      ? 'No linked children yet'
                      : 'No student record linked',
                  hint: 'Ask the school office to link your account.',
                );
              }
              final index = selected.clamp(0, list.length - 1);
              final card = list[index];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (isParent)
                    ChildSelector(
                      cards: list,
                      selected: index,
                      onSelect: (i) =>
                          ref.read(selectedChildProvider.notifier).select(i),
                    ),
                  SnapshotTiles(card: card),
                  const SizedBox(height: 14),
                  TodayTimetableCard(entries: card.timetableToday),
                  const SizedBox(height: 14),
                  AttendanceHistoryCard(card: card),
                  const SizedBox(height: 14),
                  _ClassTeacherCard(card: card),
                  const SizedBox(height: 14),
                  FamilyFeesCard(card: card),
                  const SizedBox(height: 14),
                  const RecentUpdatesCard(),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  String _dayPart() {
    final h = DateTime.now().hour;
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

class _ClassTeacherCard extends StatelessWidget {
  const _ClassTeacherCard({required this.card});
  final FamilyCard card;

  @override
  Widget build(BuildContext context) {
    final teacher = card.classTeacher;
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Contact', title: 'Class teacher'),
          if (teacher == null)
            const Text('Not assigned.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500))
          else
            MIdentity(
              initials: initials(teacher),
              title: teacher,
              sub: [card.className, card.room]
                  .whereType<String>()
                  .join(' · '),
            ),
        ],
      ),
    );
  }
}

/// The web's "Recent updates" panel — the same notification feed, newest first.
class RecentUpdatesCard extends ConsumerWidget {
  const RecentUpdatesCard({super.key, this.limit = 5});
  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = ref.watch(notificationsProvider);
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Alerts', title: 'Recent updates'),
          notifications.when(
            loading: () => const MSkeleton(height: 14),
            error: (_, _) => const Text('Could not load updates.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500)),
            data: (feed) => feed.items.isEmpty
                ? const Text('No updates yet.',
                    style: TextStyle(fontSize: 13, color: AppColors.slate500))
                : Column(
                    children: [
                      for (final n in feed.items.take(limit))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 9),
                          child: _UpdateRow(
                            title: n.title,
                            body: n.body,
                            severity: n.severity ?? 'INFO',
                            at: n.createdAt,
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

class _UpdateRow extends StatelessWidget {
  const _UpdateRow({
    required this.title,
    required this.body,
    required this.severity,
    required this.at,
  });

  final String title;
  final String body;
  final String severity;
  final DateTime? at;

  @override
  Widget build(BuildContext context) {
    final c = AppColors.severity(severity);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: c.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title,
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.slate900)),
              ),
              if (at != null)
                Text(timeAgo(at),
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.slate400)),
            ],
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(body,
                style: const TextStyle(
                    fontSize: 12, height: 1.4, color: AppColors.slate600)),
          ],
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/ui.dart';
import '../../auth/domain/app_user.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/family_repository.dart';
import 'family_widgets.dart';

/// The Attendance and Fees tabs for Student and Parent. Both are focused views
/// of the same `/dashboard/me` card the home screen summarises, so a parent's
/// child selection carries across tabs.

class FamilyAttendanceScreen extends ConsumerWidget {
  const FamilyAttendanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => _FamilyScaffold(
        overline: 'Presence',
        title: 'Attendance',
        subtitle: 'Every marked day, straight from the register.',
        builder: (card) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AttendanceHistoryCard(card: card),
            const SizedBox(height: 14),
            TodayTimetableCard(entries: card.timetableToday),
          ],
        ),
      );
}

class FamilyFeesScreen extends ConsumerWidget {
  const FamilyFeesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => _FamilyScaffold(
        overline: 'Finance',
        title: 'Fees',
        subtitle: 'What is billed, what is paid, and what is still due.',
        builder: (card) => FamilyFeesCard(card: card),
      );
}

/// Shared plumbing: load the cards, show the parent's child selector, and hand
/// the selected card to the caller. Keeps the two tabs to their content alone.
class _FamilyScaffold extends ConsumerWidget {
  const _FamilyScaffold({
    required this.overline,
    required this.title,
    required this.subtitle,
    required this.builder,
  });

  final String overline;
  final String title;
  final String subtitle;
  final Widget Function(FamilyCard card) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isParent = ref.watch(currentUserProvider)?.role == UserRole.parent;
    final cards = ref.watch(familyCardsProvider);
    final selected = ref.watch(selectedChildProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(familyCardsProvider);
        await ref.read(familyCardsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(overline: overline, title: title, subtitle: subtitle),
          MAsyncView<List<FamilyCard>>(
            value: cards,
            loadingLabel: 'Loading…',
            onRetry: () => ref.invalidate(familyCardsProvider),
            builder: (list) {
              if (list.isEmpty) {
                return const MEmptyState(
                  icon: Icons.school_outlined,
                  title: 'No student record linked',
                  hint: 'Ask the school office to link your account.',
                );
              }
              final index = selected.clamp(0, list.length - 1);
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
                  builder(list[index]),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

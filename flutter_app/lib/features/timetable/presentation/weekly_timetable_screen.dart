import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../shared/ui/ui.dart';
import '../../auth/domain/app_user.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../family/data/family_repository.dart';
import '../../family/presentation/family_widgets.dart' show subjectColor;
import '../data/timetable_repository.dart';

/// The published weekly grid, filtered to whoever is looking at it: a teacher
/// sees the periods they teach, a student sees their class's. Read-only — the
/// grid is edited in Kairos on the web.
class WeeklyTimetableScreen extends ConsumerStatefulWidget {
  const WeeklyTimetableScreen({super.key});

  @override
  ConsumerState<WeeklyTimetableScreen> createState() =>
      _WeeklyTimetableScreenState();
}

class _WeeklyTimetableScreenState
    extends ConsumerState<WeeklyTimetableScreen> {
  /// Defaults to today when it's a working day, else Monday.
  late int _day = () {
    final weekday = DateTime.now().weekday - 1; // Mon = 0
    return weekday >= 0 && weekday <= 4 ? weekday : 0;
  }();

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final timetable = ref.watch(liveTimetableProvider);
    final isTeacher = user?.role == UserRole.teacher;

    // A student's grid is their class's; a teacher's is their own periods.
    // Only a family account may read /dashboard/me, so a teacher must not
    // watch it at all — doing so fetched a 403 under their token and cached it
    // for whoever signed in next.
    final className = isTeacher
        ? null
        : ref.watch(familyCardsProvider).value?.firstOrNull?.className;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(liveTimetableProvider);
        await ref.read(liveTimetableProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: 'Kairos',
            title: 'Timetable',
            subtitle: isTeacher
                ? 'The periods you teach this week.'
                : 'Your class’s week, as published.',
          ),
          MAsyncView<LiveTimetable?>(
            value: timetable,
            loadingLabel: 'Loading timetable…',
            onRetry: () => ref.invalidate(liveTimetableProvider),
            builder: (t) {
              if (t == null) {
                return const MEmptyState(
                  icon: Icons.calendar_month_outlined,
                  title: 'No published timetable',
                  hint: 'The school hasn’t published one yet.',
                );
              }

              bool mine(TimetableSlot s) => isTeacher
                  ? s.teacher == user?.name
                  : className != null && s.className == className;

              final dayCount = t.days.isEmpty ? 5 : t.days.length;
              final day = _day.clamp(0, dayCount - 1);
              final rows = t.forDay(day, where: mine);

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 36,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: dayCount,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) {
                        final active = i == day;
                        return GestureDetector(
                          onTap: () => setState(() => _day = i),
                          child: Container(
                            alignment: Alignment.center,
                            padding:
                                const EdgeInsets.symmetric(horizontal: 16),
                            decoration: BoxDecoration(
                              color:
                                  active ? AppColors.brand : AppColors.surface,
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                  color: active
                                      ? AppColors.brand
                                      : AppColors.line),
                            ),
                            child: Text(
                              i < t.days.length ? t.days[i] : 'Day ${i + 1}',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: active
                                    ? Colors.white
                                    : AppColors.slate600,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (rows.isEmpty)
                    const MEmptyState(
                      icon: Icons.event_available_outlined,
                      title: 'Nothing scheduled',
                      hint: 'No periods on this day.',
                    )
                  else
                    for (final s in rows) _SlotRow(slot: s, showTeacher: !isTeacher),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _SlotRow extends StatelessWidget {
  const _SlotRow({required this.slot, required this.showTeacher});
  final TimetableSlot slot;
  final bool showTeacher;

  @override
  Widget build(BuildContext context) {
    final c = subjectColor(slot.colorHex);
    final sub = showTeacher ? slot.teacher : slot.className;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: c.withValues(alpha: 0.27)),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: c,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text('P${slot.period + 1}',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.white)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(slot.subject,
                      style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate900)),
                  if (sub.isNotEmpty)
                    Text(sub,
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.slate500)),
                ],
              ),
            ),
            if (slot.room != null) MBadge(slot.room!),
          ],
        ),
      ),
    );
  }
}

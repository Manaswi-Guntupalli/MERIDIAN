import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../family/presentation/family_home_screen.dart' show RecentUpdatesCard;
import '../../family/presentation/family_widgets.dart';
import '../data/teacher_repository.dart';
import 'mark_attendance_screen.dart';

/// The web's `TeacherDashboard`: the teacher's own load, today's periods with
/// a one-tap route into roll-call, the classes they lead, and their updates.
class TeacherDashboard extends ConsumerWidget {
  const TeacherDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final dash = ref.watch(teacherDashboardProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(teacherDashboardProvider);
        await ref.read(teacherDashboardProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: user == null
                ? 'Meridian'
                : 'Good ${_dayPart()}, ${firstName(user.name)}',
            title: 'My teaching',
            subtitle:
                'Your classes and today’s schedule. Mark attendance in a tap.',
          ),
          MAsyncView<TeacherDashboardData>(
            value: dash,
            loadingLabel: 'Loading your classes…',
            onRetry: () => ref.invalidate(teacherDashboardProvider),
            builder: (d) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _tiles(d),
                const SizedBox(height: 14),

                // Today's periods. "Mark" appears only where the server would
                // actually accept the write: a teacher may mark the class they
                // are class teacher of, and no other (presence/authz.ts).
                // Offering it everywhere just produced a 403.
                TodayTimetableCard(
                  entries: d.todaySlots,
                  title: 'Today’s schedule',
                  emptyHint: 'Check the timetable for the week ahead.',
                  trailingBuilder: (e) {
                    final canMark = e.classId != null &&
                        d.classesLed.any((c) => c.id == e.classId);
                    if (!canMark) {
                      return e.room == null
                          ? const SizedBox.shrink()
                          : MBadge(e.room!);
                    }
                    return MButton(
                      'Mark',
                      icon: Icons.fact_check_outlined,
                      kind: MButtonKind.ghost,
                      dense: true,
                      onPressed: () => openRollCall(
                        context,
                        classId: e.classId!,
                        className: e.className ?? e.subject,
                      ),
                    );
                  },
                ),
                const SizedBox(height: 14),

                _ClassesLedCard(classes: d.classesLed),
                const SizedBox(height: 14),
                const RecentUpdatesCard(limit: 4),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _tiles(TeacherDashboardData d) {
    final tiles = <Widget>[
      StatTile(
          label: 'Classes led',
          value: '${d.classesLed.length}',
          icon: Icons.school_outlined,
          accent: MAccent.brand),
      StatTile(
          label: 'Students reached',
          value: '${d.studentsReached}',
          icon: Icons.groups_2_outlined,
          accent: MAccent.cyan),
      StatTile(
          label: 'Today’s periods',
          value: '${d.todaySlots.length}',
          icon: Icons.schedule_outlined,
          accent: MAccent.mint),
      StatTile(
        label: 'Weekly load',
        value: '${d.weeklyHours}/${d.maxHours}h',
        sub: d.nearCap ? 'at cap' : null,
        icon: Icons.calendar_month_outlined,
        accent: d.nearCap ? MAccent.rose : MAccent.amber,
      ),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: 12),
            Expanded(
                child: i + 1 < tiles.length
                    ? tiles[i + 1]
                    : const SizedBox.shrink()),
          ],
        ),
      ));
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 12));
    }
    return Column(children: rows);
  }

  String _dayPart() {
    final h = DateTime.now().hour;
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

class _ClassesLedCard extends StatelessWidget {
  const _ClassesLedCard({required this.classes});
  final List<ClassLed> classes;

  @override
  Widget build(BuildContext context) {
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Pulse', title: 'My classes'),
          if (classes.isEmpty)
            const Text('You aren’t a class teacher this term.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500))
          else
            for (final c in classes)
              Padding(
                padding: const EdgeInsets.only(bottom: 9),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => openRollCall(context,
                      classId: c.id, className: c.name),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 11),
                    decoration: BoxDecoration(
                      color: AppColors.well,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(c.name,
                                  style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.slate900)),
                              if (c.room != null)
                                Text(c.room!,
                                    style: const TextStyle(
                                        fontSize: 11.5,
                                        color: AppColors.slate500)),
                            ],
                          ),
                        ),
                        MBadge('${c.students} students'),
                        const SizedBox(width: 6),
                        const Icon(Icons.chevron_right,
                            size: 18, color: AppColors.slate300),
                      ],
                    ),
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../shared/ui/ui.dart';
import '../data/teacher_repository.dart';
import 'mark_attendance_screen.dart';

/// The teacher's classes, as a destination of their own so roll-call is always
/// two taps away — the phone equivalent of the web's `/attendance?classId=`
/// deep links.
class MyClassesScreen extends ConsumerWidget {
  const MyClassesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dash = ref.watch(teacherDashboardProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(teacherDashboardProvider);
        await ref.read(teacherDashboardProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          const MPageHeader(
            overline: 'Pulse · ERP',
            title: 'My classes',
            subtitle: 'Open a class to take roll-call.',
          ),
          MAsyncView<TeacherDashboardData>(
            value: dash,
            loadingLabel: 'Loading your classes…',
            onRetry: () => ref.invalidate(teacherDashboardProvider),
            builder: (d) {
              // Only classes this teacher is the class teacher of: the server
              // permits roll-call for those alone (presence/authz.ts), so
              // listing the other classes they teach would offer a button that
              // can only fail.
              final entries = [
                for (final c in d.classesLed)
                  (
                    id: c.id,
                    name: c.name,
                    sub:
                        '${c.students} students${c.room == null ? '' : ' · ${c.room}'}',
                  ),
              ];

              if (entries.isEmpty) {
                return const MEmptyState(
                  icon: Icons.class_outlined,
                  title: 'You aren’t a class teacher',
                  hint:
                      'Roll-call is taken by each class’s own class teacher. '
                      'Your teaching periods are on the Timetable tab.',
                );
              }
              return Column(
                children: [
                  for (final e in entries)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: MCard(
                        padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                        onTap: () => openRollCall(context,
                            classId: e.id, className: e.name),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: AppColors.brand50,
                                borderRadius: BorderRadius.circular(11),
                              ),
                              child: const Icon(Icons.class_outlined,
                                  size: 20, color: AppColors.brand),
                            ),
                            const SizedBox(width: 13),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(e.name,
                                      style: const TextStyle(
                                          fontSize: 14.5,
                                          fontWeight: FontWeight.w700,
                                          color: AppColors.slate900)),
                                  Text(e.sub,
                                      style: const TextStyle(
                                          fontSize: 12,
                                          color: AppColors.slate500)),
                                ],
                              ),
                            ),
                            const Icon(Icons.chevron_right,
                                size: 20, color: AppColors.slate300),
                          ],
                        ),
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
}

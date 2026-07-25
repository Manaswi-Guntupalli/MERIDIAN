import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/students_repository.dart';

/// The web's Students page on a phone: one searchable roster, filterable by
/// class, with the same fields the table shows (roll, class, blood group,
/// Face ID enrolment). Read-only by design — adding students is a desk task,
/// and the mobile spec keeps creation/config on the web.
class StudentsScreen extends ConsumerStatefulWidget {
  const StudentsScreen({super.key});

  @override
  ConsumerState<StudentsScreen> createState() => _StudentsScreenState();
}

class _StudentsScreenState extends ConsumerState<StudentsScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final students = ref.watch(studentsProvider);
    final classes = ref.watch(classesProvider);
    final query = ref.watch(studentQueryProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(studentsProvider);
        ref.invalidate(classesProvider);
        await ref.read(studentsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: 'Pulse · ERP',
            title: 'Students',
            subtitle: students.hasValue
                ? '${students.value!.length} student(s) on the roster.'
                : 'One event-sourced roster.',
          ),

          // ── Search ──
          TextField(
            controller: _controller,
            onChanged: (v) =>
                ref.read(studentQueryProvider.notifier).search(v.trim()),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search students…',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: query.q.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _controller.clear();
                        ref.read(studentQueryProvider.notifier).search('');
                      },
                    ),
            ),
          ),
          const SizedBox(height: 12),

          // ── Class filter ──
          SizedBox(
            height: 34,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                _classChip('All classes', query.classId == null,
                    () => ref.read(studentQueryProvider.notifier).selectClass(null)),
                ...?classes.value?.map(
                  (c) => _classChip(
                    '${c.name} · ${c.students}',
                    query.classId == c.id,
                    () => ref
                        .read(studentQueryProvider.notifier)
                        .selectClass(c.id),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          MAsyncView<List<StudentRow>>(
            value: students,
            loadingLabel: 'Loading roster…',
            onRetry: () => ref.invalidate(studentsProvider),
            builder: (rows) => rows.isEmpty
                ? const MEmptyState(
                    icon: Icons.school_outlined,
                    title: 'No students found',
                    hint: 'Try a different search or clear the class filter.',
                  )
                : Column(
                    children: [
                      for (final s in rows)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _StudentCard(student: s),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _classChip(String label, bool selected, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 13),
            decoration: BoxDecoration(
              color: selected ? AppColors.brand : AppColors.well,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                  color: selected ? AppColors.brand : AppColors.line),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: selected ? Colors.white : AppColors.slate600,
              ),
            ),
          ),
        ),
      );
}

class _StudentCard extends StatelessWidget {
  const _StudentCard({required this.student});
  final StudentRow student;

  @override
  Widget build(BuildContext context) {
    final s = student;
    return MCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        backgroundColor: AppColors.surface,
        builder: (_) => _StudentSheet(student: s),
      ),
      child: Row(
        children: [
          Expanded(
            child: MIdentity(
              initials: initials(s.name),
              title: s.name,
              sub: 'Roll ${s.rollNo} · ${s.admissionNo}',
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              MBadge(s.className ?? '—'),
              const SizedBox(height: 4),
              if (s.faceEnrolled)
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.face_retouching_natural,
                        size: 13, color: AppColors.mint),
                    SizedBox(width: 3),
                    Text('Face ID',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: AppColors.mint)),
                  ],
                )
              else
                const Text('No Face ID',
                    style: TextStyle(fontSize: 11, color: AppColors.slate400)),
            ],
          ),
        ],
      ),
    );
  }
}

/// The detail the web shows on /students/:id, in a sheet — nothing is invented;
/// blank fields are shown as "—" rather than filled with plausible values.
class _StudentSheet extends StatelessWidget {
  const _StudentSheet({required this.student});
  final StudentRow student;

  @override
  Widget build(BuildContext context) {
    final s = student;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MIdentity(
            initials: initials(s.name),
            title: s.name,
            sub: '${s.className ?? 'Unassigned'} · Roll ${s.rollNo}',
          ),
          const SizedBox(height: 18),
          _row('Admission no', s.admissionNo),
          _row('Blood group', s.bloodGroup ?? '—'),
          _row('Guardian', s.guardianName ?? '—'),
          _row('Phone', s.phone ?? '—'),
          _row('Face enrolment', s.faceEnrolled ? 'Enrolled' : 'Not enrolled'),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 11),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 130,
              child: Text(label,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppColors.slate500)),
            ),
            Expanded(
              child: Text(value,
                  style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.slate800)),
            ),
          ],
        ),
      );
}

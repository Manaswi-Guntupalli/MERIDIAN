import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../dashboard/data/dashboard_repository.dart';
import '../../dashboard/data/intelligence_repository.dart';
import '../data/staff_repository.dart';

/// The web's Staff page: the roster with weekly load, and the one-tap
/// "Absent → cascade" that assigns cover, frees rooms, notifies families and
/// stays reversible. The result sheet replays the server's executed steps.
class StaffScreen extends ConsumerStatefulWidget {
  const StaffScreen({super.key});

  @override
  ConsumerState<StaffScreen> createState() => _StaffScreenState();
}

class _StaffScreenState extends ConsumerState<StaffScreen> {
  String? _running;

  Future<void> _cascade(TeacherRow t) async {
    setState(() => _running = t.id);
    try {
      final result =
          await ref.read(staffRepositoryProvider).runCascade(t.id);
      // The cascade changed reality — everything derived from it must refetch.
      ref.invalidate(staffProvider);
      ref.invalidate(dashboardStatsProvider);
      ref.invalidate(intelligenceProvider);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        backgroundColor: AppColors.surface,
        builder: (_) => _CascadeSheet(result: result),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Cascade failed — ${friendlyError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _running = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final staff = ref.watch(staffProvider);
    final overloaded =
        staff.value?.where((t) => t.overloaded).length ?? 0;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(staffProvider);
        await ref.read(staffProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: 'Pulse · ERP',
            title: 'Staff',
            subtitle:
                'Mark a teacher absent and the cascade assigns cover, frees rooms and notifies families — one reversible action.',
            actions: overloaded > 0
                ? [
                    MBadge('$overloaded near cap',
                        severity: 'WARNING',
                        icon: Icons.warning_amber_rounded)
                  ]
                : null,
          ),
          MAsyncView<List<TeacherRow>>(
            value: staff,
            loadingLabel: 'Loading staff…',
            onRetry: () => ref.invalidate(staffProvider),
            builder: (rows) => rows.isEmpty
                ? const MEmptyState(
                    icon: Icons.groups_2_outlined, title: 'No staff yet')
                : Column(
                    children: [
                      for (final t in rows)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _TeacherCard(
                            teacher: t,
                            busy: _running == t.id,
                            disabled: _running != null && _running != t.id,
                            onCascade: () => _cascade(t),
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

class _TeacherCard extends StatelessWidget {
  const _TeacherCard({
    required this.teacher,
    required this.busy,
    required this.disabled,
    required this.onCascade,
  });

  final TeacherRow teacher;
  final bool busy;
  final bool disabled;
  final VoidCallback onCascade;

  @override
  Widget build(BuildContext context) {
    final t = teacher;
    final accent = t.overloaded
        ? MAccent.rose
        : t.load > 80
            ? MAccent.amber
            : MAccent.brand;

    return MCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: MIdentity(
                  initials: initials(t.name),
                  title: t.name,
                  sub: '${t.department} · ${t.employeeId}',
                  accent: accent,
                ),
              ),
              MBadge(t.overloaded ? 'at cap' : 'balanced',
                  severity: t.overloaded ? 'WARNING' : 'SUCCESS'),
            ],
          ),
          if (t.subjects.isNotEmpty || t.classesLed.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final s in t.subjects) _tag(s, false),
                for (final c in t.classesLed) _tag(c, true),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: MMeter(value: t.load.toDouble(), accent: accent)),
              const SizedBox(width: 10),
              Text(
                '${t.weeklyHours}/${t.maxHours}h',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: t.overloaded ? AppColors.rose : AppColors.slate500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: MButton(
              'Absent → cascade',
              icon: Icons.person_off_outlined,
              kind: MButtonKind.ghost,
              dense: true,
              busy: busy,
              onPressed: disabled ? null : onCascade,
            ),
          ),
        ],
      ),
    );
  }

  Widget _tag(String label, bool isClass) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: isClass ? AppColors.brand50 : AppColors.well,
          borderRadius: BorderRadius.circular(6),
          border:
              Border.all(color: isClass ? AppColors.brand100 : AppColors.line),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: isClass ? FontWeight.w700 : FontWeight.w500,
            color: isClass ? AppColors.brand : AppColors.slate500,
          ),
        ),
      );
}

/// Replays the executed cascade and offers the undo, exactly like the web's
/// timeline modal.
class _CascadeSheet extends ConsumerStatefulWidget {
  const _CascadeSheet({required this.result});
  final CascadeResult result;

  @override
  ConsumerState<_CascadeSheet> createState() => _CascadeSheetState();
}

class _CascadeSheetState extends ConsumerState<_CascadeSheet> {
  bool _undoing = false;
  bool _undone = false;

  Future<void> _undo() async {
    final id = widget.result.eventId;
    if (id == null) return;
    setState(() => _undoing = true);
    try {
      final summary = await ref.read(staffRepositoryProvider).undo(id);
      ref.invalidate(staffProvider);
      ref.invalidate(dashboardStatsProvider);
      ref.invalidate(intelligenceProvider);
      if (!mounted) return;
      setState(() => _undone = true);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Cascade undone — $summary')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Undo failed — ${friendlyError(e)}')),
      );
    } finally {
      if (mounted) setState(() => _undoing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.result;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.brand,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.bolt, size: 18, color: Colors.white),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('The cascade ran',
                            style: AppType.display(17,
                                weight: FontWeight.w600)),
                        Text(
                          '${r.teacherName} · ${r.date} · every step below actually executed',
                          style: const TextStyle(
                              fontSize: 11.5, color: AppColors.slate500),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              for (final s in r.steps) _step(s),
              const SizedBox(height: 4),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
                decoration: BoxDecoration(
                  color: AppColors.well,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${r.covered} covered · ${r.uncovered} uncovered · '
                      '${r.familyUsersNotified} family member(s) notified',
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.slate600),
                    ),
                    if (r.eventId != null) ...[
                      const SizedBox(height: 10),
                      if (_undone)
                        const MBadge('Undone — timetable restored',
                            severity: 'INFO')
                      else
                        MButton(
                          'Undo everything',
                          icon: Icons.undo,
                          kind: MButtonKind.ghost,
                          dense: true,
                          busy: _undoing,
                          onPressed: _undo,
                        ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _step(CascadeStep s) {
    final (IconData icon, Color color) = switch (s.status) {
      'DONE' => (Icons.check_circle, AppColors.mint),
      'PARTIAL' => (Icons.remove_circle, AppColors.amber),
      _ => (Icons.circle_outlined, AppColors.slate400),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(s.label,
                          style: const TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.slate900)),
                    ),
                    if (s.at != null) ...[
                      const SizedBox(width: 7),
                      Text(
                        TimeOfDay.fromDateTime(s.at!.toLocal())
                            .format(context),
                        style: const TextStyle(
                            fontSize: 10.5, color: AppColors.slate400),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(s.detail,
                    style: const TextStyle(
                        fontSize: 12, height: 1.4, color: AppColors.slate500)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../family/presentation/family_widgets.dart' show attendanceColor;
import '../data/teacher_repository.dart';

/// Opens roll-call for a class as its own page.
Future<void> openRollCall(
  BuildContext context, {
  required String classId,
  required String className,
}) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MarkAttendanceScreen(
          classId: classId,
          className: className,
        ),
      ),
    );

/// Roll-call for one class — the mobile form of the web's Attendance page.
///
/// Every tap posts to `/attendance/mark` immediately: the roster is the
/// server's, not a local draft, so two teachers marking the same class can
/// never overwrite each other with stale state.
class MarkAttendanceScreen extends ConsumerStatefulWidget {
  const MarkAttendanceScreen({
    super.key,
    required this.classId,
    required this.className,
  });

  final String classId;
  final String className;

  @override
  ConsumerState<MarkAttendanceScreen> createState() =>
      _MarkAttendanceScreenState();
}

class _MarkAttendanceScreenState extends ConsumerState<MarkAttendanceScreen> {
  /// Student ids with an in-flight write, so their row can show progress
  /// without freezing the whole list.
  final Set<String> _pending = {};

  Future<void> _mark(RosterEntry entry, String status) async {
    if (_pending.contains(entry.studentId)) return;
    setState(() => _pending.add(entry.studentId));
    try {
      await ref.read(teacherRepositoryProvider).mark(
            studentId: entry.studentId,
            classId: widget.classId,
            status: status,
          );
      ref.invalidate(classRosterProvider(widget.classId));
      await ref.read(classRosterProvider(widget.classId).future);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(friendlyError(e))),
      );
    } finally {
      if (mounted) setState(() => _pending.remove(entry.studentId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final roster = ref.watch(classRosterProvider(widget.classId));

    return Scaffold(
      appBar: AppBar(title: Text('${widget.className} · roll-call')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(classRosterProvider(widget.classId));
          await ref.read(classRosterProvider(widget.classId).future);
        },
        child: MAsyncView<ClassRoster>(
          value: roster,
          loadingLabel: 'Loading roster…',
          onRetry: () => ref.invalidate(classRosterProvider(widget.classId)),
          builder: (r) => ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
            children: [
              _Header(roster: r),
              const SizedBox(height: 14),
              if (r.entries.isEmpty)
                const MEmptyState(
                  icon: Icons.groups_2_outlined,
                  title: 'No students in this class',
                )
              else
                for (final e in r.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _StudentRow(
                      entry: e,
                      busy: _pending.contains(e.studentId),
                      onMark: (status) => _mark(e, status),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.roster});
  final ClassRoster roster;

  @override
  Widget build(BuildContext context) {
    final total = roster.entries.length;
    final marked = roster.marked;
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: roster.date,
            title: 'Roll-call',
            action: MBadge('$marked/$total marked',
                severity: marked == total && total > 0 ? 'SUCCESS' : null),
          ),
          MMeter(
            value: total == 0 ? 0 : marked / total * 100,
            accent: marked == total && total > 0 ? MAccent.mint : MAccent.brand,
          ),
          const SizedBox(height: 10),
          const Text(
            'Each tap is saved immediately. Face and QR marks made at the kiosk '
            'appear here too — this is the same register.',
            style: TextStyle(
                fontSize: 11.5, height: 1.45, color: AppColors.slate400),
          ),
        ],
      ),
    );
  }
}

class _StudentRow extends StatelessWidget {
  const _StudentRow({
    required this.entry,
    required this.busy,
    required this.onMark,
  });

  final RosterEntry entry;
  final bool busy;
  final ValueChanged<String> onMark;

  @override
  Widget build(BuildContext context) {
    final marked = entry.status != 'UNMARKED';
    return MCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: MIdentity(
                  initials: initials(entry.name),
                  title: entry.name,
                  sub: 'Roll ${entry.rollNo}'
                      '${entry.source == null ? '' : ' · via ${entry.source!.toLowerCase()}'}',
                  accent: marked ? MAccent.mint : MAccent.brand,
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else if (marked)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: attendanceColor(entry.status).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                        color: attendanceColor(entry.status)
                            .withValues(alpha: 0.35)),
                  ),
                  child: Text(
                    entry.status,
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: attendanceColor(entry.status)),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              for (final s in const ['PRESENT', 'LATE', 'ABSENT', 'LEAVE'])
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _StatusButton(
                      status: s,
                      selected: entry.status == s,
                      enabled: !busy,
                      onTap: () => onMark(s),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusButton extends StatelessWidget {
  const _StatusButton({
    required this.status,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final String status;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = attendanceColor(status);
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? c : c.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: c.withValues(alpha: selected ? 1 : 0.3)),
        ),
        child: Text(
          // Short labels so four fit a phone row without truncating.
          switch (status) {
            'PRESENT' => 'Present',
            'LATE' => 'Late',
            'ABSENT' => 'Absent',
            _ => 'Leave',
          },
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : c,
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/family_repository.dart';

/// Pieces shared by the Student and Parent experiences. Both roles read the
/// same `/dashboard/me` card, so they render through the same widgets — the
/// only difference is the parent's child selector.

/// Severity colour for an attendance status, matching the web's mapping.
Color attendanceColor(String status) => switch (status) {
      'PRESENT' => AppColors.mint,
      'LATE' => AppColors.amber,
      'LEAVE' => AppColors.cyan,
      'ABSENT' => AppColors.rose,
      _ => AppColors.slate300,
    };

String? attendanceSeverity(String status) => switch (status) {
      'PRESENT' => 'SUCCESS',
      'LATE' => 'WARNING',
      'LEAVE' => 'INFO',
      'ABSENT' => 'CRITICAL',
      _ => null,
    };

/// "PRESENT" ➜ "Present" — the API shouts its enums, the UI does not.
String _titleCase(String s) =>
    s.isEmpty ? s : s[0] + s.substring(1).toLowerCase();

/// A subject colour from the solver's hex string, e.g. "#0E7C6B".
Color subjectColor(String hex) {
  final cleaned = hex.replaceAll('#', '');
  final value = int.tryParse(cleaned, radix: 16);
  if (value == null) return AppColors.brand;
  return Color(cleaned.length <= 6 ? 0xFF000000 | value : value);
}

/// The parent's child switcher — hidden for a student, who has one card.
class ChildSelector extends StatelessWidget {
  const ChildSelector({
    super.key,
    required this.cards,
    required this.selected,
    required this.onSelect,
  });

  final List<FamilyCard> cards;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    if (cards.length < 2) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: SizedBox(
        height: 38,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: cards.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (context, i) {
            final active = i == selected;
            final c = cards[i];
            return GestureDetector(
              onTap: () => onSelect(i),
              child: Container(
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 15),
                decoration: BoxDecoration(
                  color: active ? AppColors.brand : AppColors.surface,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                      color: active ? AppColors.brand : AppColors.line),
                ),
                child: Text(
                  '${firstName(c.name)} · ${c.className ?? '—'}',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: active ? Colors.white : AppColors.slate600,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Attendance rate, today's status, fees due and class — the web's snapshot row.
class SnapshotTiles extends StatelessWidget {
  const SnapshotTiles({super.key, required this.card});
  final FamilyCard card;

  @override
  Widget build(BuildContext context) {
    final rate = card.attendanceRate;
    final tiles = <Widget>[
      StatTile(
        label: 'Attendance',
        value: '$rate%',
        sub: 'last ${card.attendanceHistory.length} days',
        icon: Icons.fact_check_outlined,
        accent: rate >= 90
            ? MAccent.mint
            : rate >= 75
                ? MAccent.brand
                : MAccent.amber,
      ),
      StatTile(
        label: 'Today',
        value: card.todayStatus == 'UNMARKED'
            ? 'Not marked'
            : _titleCase(card.todayStatus),
        sub: card.todayStatus == 'UNMARKED' ? 'roll-call pending' : null,
        icon: Icons.today_outlined,
        accent: MAccent.cyan,
      ),
      StatTile(
        label: 'Fees due',
        value: inr(card.outstanding),
        icon: Icons.account_balance_wallet_outlined,
        accent: card.outstanding > 0 ? MAccent.amber : MAccent.mint,
      ),
      StatTile(
        label: 'Class',
        value: card.className ?? '—',
        sub: card.room,
        icon: Icons.meeting_room_outlined,
        accent: MAccent.brand,
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
              child:
                  i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink(),
            ),
          ],
        ),
      ));
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 12));
    }
    return Column(children: rows);
  }
}

/// One day's timetable, colour-coded by subject exactly as the web renders it.
class TodayTimetableCard extends StatelessWidget {
  const TodayTimetableCard({
    super.key,
    required this.entries,
    this.title = 'Today’s timetable',
    this.emptyHint = 'Enjoy the day off — or check the full timetable.',
    this.trailingBuilder,
  });

  final List<TimetableEntry> entries;
  final String title;
  final String emptyHint;

  /// Lets the teacher view add a "Mark attendance" affordance per period.
  final Widget Function(TimetableEntry entry)? trailingBuilder;

  @override
  Widget build(BuildContext context) {
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(overline: 'Schedule', title: title),
          if (entries.isEmpty)
            MEmptyState(
              icon: Icons.event_available_outlined,
              title: 'No classes scheduled today',
              hint: emptyHint,
            )
          else
            for (final e in entries) _PeriodRow(entry: e, trailing: trailingBuilder?.call(e)),
        ],
      ),
    );
  }
}

class _PeriodRow extends StatelessWidget {
  const _PeriodRow({required this.entry, this.trailing});
  final TimetableEntry entry;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = subjectColor(entry.colorHex);
    final subtitle = [
      if (entry.className != null) entry.className!,
      if (entry.teacher != null) entry.teacher!,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: c.withValues(alpha: 0.27)),
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: c,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                'P${entry.period + 1}',
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: Colors.white),
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entry.subject,
                      style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate900)),
                  if (subtitle.isNotEmpty)
                    Text(subtitle,
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.slate500)),
                ],
              ),
            ),
            if (trailing != null) trailing! else if (entry.room != null)
              MBadge(entry.room!),
          ],
        ),
      ),
    );
  }
}

/// The web's day-square strip: one tile per recorded day, newest first.
class AttendanceHistoryCard extends StatelessWidget {
  const AttendanceHistoryCard({super.key, required this.card});
  final FamilyCard card;

  @override
  Widget build(BuildContext context) {
    final days = card.attendanceHistory;
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: 'Presence',
            title: 'Attendance history',
            action: MBadge('last ${days.length} days',
                severity: card.attendanceRate >= 90
                    ? 'SUCCESS'
                    : card.attendanceRate >= 75
                        ? 'INFO'
                        : 'WARNING'),
          ),
          Row(
            children: [
              Text('${card.attendanceRate}%',
                  style: AppType.display(26,
                      weight: FontWeight.w600, letterSpacing: 0)),
              const SizedBox(width: 10),
              Expanded(
                child: MMeter(
                  value: card.attendanceRate.toDouble(),
                  accent: card.attendanceRate >= 90
                      ? MAccent.mint
                      : card.attendanceRate >= 75
                          ? MAccent.brand
                          : MAccent.amber,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (days.isEmpty)
            const Text('No attendance recorded yet.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500))
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final d in days.reversed)
                  Tooltip(
                    message: '${d.date}: ${d.status}',
                    child: Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: attendanceColor(d.status).withValues(alpha: 0.75),
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              for (final s in const ['PRESENT', 'LATE', 'LEAVE', 'ABSENT'])
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: attendanceColor(s).withValues(alpha: 0.75),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(_titleCase(s),
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.slate500)),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The fee list the family sees — amounts and status straight from the ledger.
class FamilyFeesCard extends StatelessWidget {
  const FamilyFeesCard({super.key, required this.card});
  final FamilyCard card;

  @override
  Widget build(BuildContext context) {
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: 'Finance',
            title: 'Fees',
            action: MBadge(
              card.outstanding > 0 ? '${inr(card.outstanding)} due' : 'All clear',
              severity: card.outstanding > 0 ? 'WARNING' : 'SUCCESS',
            ),
          ),
          if (card.fees.isEmpty)
            const Text('No fee records.',
                style: TextStyle(fontSize: 13, color: AppColors.slate500))
          else
            for (final f in card.fees)
              Padding(
                padding: const EdgeInsets.only(bottom: 9),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
                            Text(f.title,
                                style: const TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.slate900)),
                            Text('Due ${f.dueDate}',
                                style: const TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.slate500)),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            f.due > 0 ? inr(f.due) : inr(f.amount),
                            style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.slate900),
                          ),
                          const SizedBox(height: 3),
                          MBadge(f.status,
                              severity: switch (f.status) {
                                'PAID' => 'SUCCESS',
                                'OVERDUE' => 'CRITICAL',
                                _ => 'WARNING',
                              }),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

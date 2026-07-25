import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/emergency_repository.dart';

/// Emergency coordination. Triggering alerts every teacher, parent and admin,
/// freezes attendance and the timetable, and is audited — so it is behind an
/// explicit typed confirmation, not a single tap on a phone in a pocket.
class EmergencyScreen extends ConsumerStatefulWidget {
  const EmergencyScreen({super.key});

  @override
  ConsumerState<EmergencyScreen> createState() => _EmergencyScreenState();
}

const _kinds = [
  (kind: 'FIRE', label: 'Fire', icon: Icons.local_fire_department_outlined, desc: 'Evacuate to assembly ground'),
  (kind: 'EARTHQUAKE', label: 'Earthquake', icon: Icons.waves_outlined, desc: 'Drop, cover, hold'),
  (kind: 'MEDICAL', label: 'Medical', icon: Icons.medical_services_outlined, desc: 'Dispatch medical team'),
  (kind: 'LOCKDOWN', label: 'Lockdown', icon: Icons.lock_outline, desc: 'Secure all rooms'),
];

class _EmergencyScreenState extends ConsumerState<EmergencyScreen> {
  Timer? _ticker;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // Only drives the elapsed clock; the incident data refetches on its own.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _trigger(({String kind, String label, IconData icon, String desc}) k) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Declare a ${k.label.toLowerCase()} emergency?'),
        content: Text(
          'This immediately alerts every teacher, parent and administrator, '
          'freezes attendance and the timetable, and is recorded against your name.\n\n'
          '${k.desc}.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.rose),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Declare ${k.label}'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(emergencyRepositoryProvider).trigger(k.kind);
      ref.invalidate(activeIncidentProvider);
      await ref.read(activeIncidentProvider.future);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resolve(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Declare all clear?'),
        content: const Text(
            'Everyone is notified that the emergency is over, and attendance '
            'and the timetable are unlocked.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('All clear')),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(emergencyRepositoryProvider).resolve(id);
      ref.invalidate(activeIncidentProvider);
      await ref.read(activeIncidentProvider.future);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _elapsed(DateTime? since) {
    if (since == null) return '00:00';
    final s = DateTime.now().difference(since).inSeconds.clamp(0, 1 << 30);
    final h = s ~/ 3600, m = (s % 3600) ~/ 60, sec = s % 60;
    two(int n) => n.toString().padLeft(2, '0');
    return h > 0 ? '$h:${two(m)}:${two(sec)}' : '${two(m)}:${two(sec)}';
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeIncidentProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(activeIncidentProvider);
        await ref.read(activeIncidentProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          const MPageHeader(
            overline: 'Trust Core',
            title: 'Emergency',
            subtitle:
                'One action alerts every teacher, parent and administrator, freezes attendance and the timetable, and is fully audited.',
          ),
          MAsyncView<ActiveIncident?>(
            value: active,
            loadingLabel: 'Checking for incidents…',
            onRetry: () => ref.invalidate(activeIncidentProvider),
            builder: (incident) => incident == null
                ? _declare()
                : _liveIncident(incident.id),
          ),
        ],
      ),
    );
  }

  Widget _declare() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MCard(
            child: Row(
              children: [
                const Icon(Icons.verified_user_outlined,
                    size: 18, color: AppColors.mint),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text('No active emergency.',
                      style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate700)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text('DECLARE AN EMERGENCY', style: AppType.label),
          const SizedBox(height: 10),
          for (final k in _kinds)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: MCard(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                onTap: _busy ? null : () => _trigger(k),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AppColors.rose.withValues(alpha: 0.09),
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(
                            color: AppColors.rose.withValues(alpha: 0.25)),
                      ),
                      child: Icon(k.icon, size: 20, color: AppColors.rose),
                    ),
                    const SizedBox(width: 13),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(k.label,
                              style: const TextStyle(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.slate900)),
                          Text(k.desc,
                              style: const TextStyle(
                                  fontSize: 12.5, color: AppColors.slate500)),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right,
                        size: 20, color: AppColors.slate300),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 4),
          const Text(
            'Every declaration asks for confirmation first and is recorded against your name in the Trust Ledger.',
            style: TextStyle(
                fontSize: 11.5, height: 1.45, color: AppColors.slate400),
          ),
        ],
      );

  Widget _liveIncident(String id) {
    final state = ref.watch(incidentStateProvider(id));
    return MAsyncView<IncidentState>(
      value: state,
      loadingLabel: 'Loading incident…',
      onRetry: () => ref.invalidate(incidentStateProvider(id)),
      builder: (s) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Command banner ──
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.rose.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(14),
              border:
                  Border.all(color: AppColors.rose.withValues(alpha: 0.35)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.crisis_alert,
                        size: 22, color: AppColors.rose),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text('${s.title} · ACTIVE',
                          style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppColors.roseDeep)),
                    ),
                    Text(_elapsed(s.createdAt),
                        style: AppType.display(19,
                            weight: FontWeight.w700, letterSpacing: 0)),
                  ],
                ),
                const SizedBox(height: 8),
                Text(s.instruction,
                    style: const TextStyle(
                        fontSize: 13, height: 1.45, color: AppColors.roseDeep)),
                if (s.triggeredBy != null) ...[
                  const SizedBox(height: 6),
                  Text('Activated by ${s.triggeredBy}',
                      style: const TextStyle(
                          fontSize: 11.5, color: AppColors.slate500)),
                ],
                const SizedBox(height: 12),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    MBadge(
                        'Attendance ${s.attendanceLocked ? "locked" : "unlocked"}',
                        severity: s.attendanceLocked ? 'CRITICAL' : 'SUCCESS'),
                    MBadge(
                        'Timetable ${s.timetableLocked ? "paused" : "live"}',
                        severity: s.timetableLocked ? 'CRITICAL' : 'SUCCESS'),
                  ],
                ),
                const SizedBox(height: 12),
                MButton(
                  'Declare all clear',
                  icon: Icons.check_circle_outline,
                  busy: _busy,
                  onPressed: _busy ? null : () => _resolve(s.id),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Live counters ──
          MCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const MSectionTitle(
                    overline: 'Roll-up', title: 'Who has reported'),
                _counter('Teachers safe',
                    '${s.teachersSafe}/${s.teachersTotal}', AppColors.mint),
                _counter('Need assistance', '${s.teachersNeedAssistance}',
                    AppColors.amber),
                _counter('Teachers pending', '${s.teachersPending}',
                    AppColors.rose),
                _counter('Parents acknowledged',
                    '${s.parentsAcknowledgedPct}%', AppColors.cyan),
              ],
            ),
          ),

          if (s.needAssistance.isNotEmpty) ...[
            const SizedBox(height: 14),
            MCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const MSectionTitle(title: 'Need assistance'),
                  for (final a in s.needAssistance)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber_rounded,
                              size: 16, color: AppColors.amber),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              '${a.teacher}${a.className == null ? '' : ' · ${a.className}'}'
                              '${a.note == null || a.note!.isEmpty ? '' : ' — ${a.note}'}',
                              style: const TextStyle(
                                  fontSize: 13,
                                  height: 1.4,
                                  color: AppColors.slate700),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],

          if (s.timeline.isNotEmpty) ...[
            const SizedBox(height: 14),
            MCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const MSectionTitle(title: 'Timeline'),
                  for (final t in s.timeline.take(10))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 5),
                            child: Icon(Icons.circle,
                                size: 7, color: AppColors.slate300),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(t.message,
                                    style: const TextStyle(
                                        fontSize: 12.5,
                                        height: 1.4,
                                        color: AppColors.slate700)),
                                Text(
                                  [
                                    if (t.actor != null) t.actor!,
                                    if (t.at != null) timeAgo(t.at)
                                  ].join(' · '),
                                  style: const TextStyle(
                                      fontSize: 11, color: AppColors.slate400),
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
        ],
      ),
    );
  }

  Widget _counter(String label, String value, Color color) => Padding(
        padding: const EdgeInsets.only(bottom: 9),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(label,
                  style: const TextStyle(
                      fontSize: 13, color: AppColors.slate600)),
            ),
            Text(value,
                style: TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w700, color: color)),
          ],
        ),
      );
}

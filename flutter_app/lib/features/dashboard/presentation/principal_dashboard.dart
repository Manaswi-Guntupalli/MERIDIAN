import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/dashboard_repository.dart';
import '../data/intelligence_repository.dart';
import 'recommended_actions.dart';

/// The Principal's dashboard — school health, today's attendance, active
/// sessions, fees and alerts. Everything is read live from the same backend the
/// web dashboard uses (`/dashboard/stats`, `/presence/session`).
class PrincipalDashboard extends ConsumerWidget {
  const PrincipalDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final statsAsync = ref.watch(dashboardStatsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(dashboardStatsProvider);
        ref.invalidate(activeSessionsProvider);
        ref.invalidate(intelligenceProvider);
        await ref.read(dashboardStatsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            overline: user?.schoolName ?? 'Meridian',
            title: 'Overview',
            subtitle: _greeting(user?.name),
          ),
          statsAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.only(top: 60),
              child: MLoading(label: 'Loading school metrics…'),
            ),
            error: (e, _) => _ErrorCard(
              message: friendlyError(e),
              onRetry: () => ref.invalidate(dashboardStatsProvider),
            ),
            data: (s) => _DashboardBody(stats: s),
          ),
        ],
      ),
    );
  }

  /// "Good afternoon, Kavita." — the honorific is dropped (greeting on the raw
  /// first token produced "Good afternoon, Dr.."), and the full stop is never
  /// doubled for a name that already ends in one.
  String _greeting(String? name) {
    final part = 'Good ${_dayPart()}';
    final who = name == null ? '' : firstName(name).trim();
    if (who.isEmpty) return '$part.';
    return who.endsWith('.') ? '$part, $who' : '$part, $who.';
  }

  String _dayPart() {
    final h = DateTime.now().hour;
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

class _DashboardBody extends ConsumerWidget {
  const _DashboardBody({required this.stats});
  final DashboardStats stats;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(activeSessionsProvider);
    final rupees = NumberFormat.currency(
        locale: 'en_IN', symbol: '₹', decimalDigits: 0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (stats.emergencyActive) ...[
          _AlertBanner(
            icon: Icons.crisis_alert,
            text: 'An emergency is currently active at your school.',
          ),
          const SizedBox(height: 14),
        ],

        // ── School health ──
        const HealthCard(),
        const SizedBox(height: 14),

        // ── Ranked actions from the intelligence engine (same panel as web) ──
        const RecommendedActions(),
        const SizedBox(height: 14),

        // ── Key counts ──
        _grid([
          StatTile(label: 'Students', value: '${stats.students}', icon: Icons.school_outlined, accent: MAccent.brand),
          StatTile(label: 'Teachers', value: '${stats.teachers}', icon: Icons.groups_2_outlined, accent: MAccent.cyan),
          StatTile(
            label: 'Attendance',
            value: '${stats.attendanceRate}%',
            sub: '${stats.present}/${stats.totalMarked} present',
            icon: Icons.fact_check_outlined,
            accent: stats.attendanceRate >= 90 ? MAccent.mint : stats.attendanceRate >= 75 ? MAccent.amber : MAccent.rose,
          ),
          StatTile(label: 'Classes', value: '${stats.classes}', icon: Icons.class_outlined, accent: MAccent.brand),
        ]),
        const SizedBox(height: 14),

        // ── Fees ──
        MCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const MSectionTitle(overline: 'Finance', title: 'Fee collection'),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Outstanding', style: AppType.label),
                        const SizedBox(height: 2),
                        Text(rupees.format(stats.outstanding),
                            style: AppType.display(24, letterSpacing: 0)),
                      ],
                    ),
                  ),
                  // "Accounts past due" is the same rule the API and the web
                  // use: past the due date and not fully paid. It is NOT the
                  // count of open accounts, so it must not be labelled as one.
                  Text('${stats.overdueCount} past due',
                      style: const TextStyle(fontSize: 12, color: AppColors.slate500)),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Text('Collected ${stats.feeCollectionRate}%',
                      style: const TextStyle(fontSize: 12, color: AppColors.slate600, fontWeight: FontWeight.w600)),
                ],
              ),
              const SizedBox(height: 6),
              MMeter(
                value: stats.feeCollectionRate.toDouble(),
                accent: stats.feeCollectionRate >= 85 ? MAccent.mint : stats.feeCollectionRate >= 60 ? MAccent.amber : MAccent.rose,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // ── Active sessions ──
        MCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              MSectionTitle(
                overline: 'Presence',
                title: 'Active attendance',
                action: sessions.maybeWhen(
                  data: (list) => MBadge('${list.length} live',
                      severity: list.isEmpty ? null : 'SUCCESS'),
                  orElse: () => null,
                ),
              ),
              sessions.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(child: SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2.2))),
                ),
                error: (_, _) => Text('Could not load sessions.',
                    style: const TextStyle(fontSize: 13, color: AppColors.slate500)),
                data: (list) => list.isEmpty
                    ? Text('No attendance sessions running right now.',
                        style: const TextStyle(fontSize: 13, color: AppColors.slate500))
                    : Column(
                        children: [
                          for (final s in list)
                            Padding(
                              padding: const EdgeInsets.only(top: 4, bottom: 4),
                              child: Row(
                                children: [
                                  Container(
                                    width: 8, height: 8,
                                    decoration: const BoxDecoration(color: AppColors.mint, shape: BoxShape.circle),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(s.className,
                                        style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate800)),
                                  ),
                                  Text('${s.roster} on register',
                                      style: const TextStyle(fontSize: 12, color: AppColors.slate500)),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // ── Attention / alerts ──
        MCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const MSectionTitle(title: 'Needs attention'),
              _attention('Uncovered classes today', stats.uncoveredToday, Icons.event_busy_outlined),
              _attention('Documents awaiting review', stats.docsInReview, Icons.description_outlined),
              _attention('Overdue fee accounts', stats.overdueCount, Icons.account_balance_wallet_outlined),
              // The "N staff-hours saved by automation" line was removed: it
              // multiplied the ledger's action count by an invented 8 minutes
              // each and presented the product as a measured saving.
            ],
          ),
        ),
      ],
    );
  }

  Widget _attention(String label, int count, IconData icon) {
    final ok = count == 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: ok ? AppColors.mint : AppColors.amber),
          const SizedBox(width: 10),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13.5, color: AppColors.slate700))),
          MBadge(ok ? 'Clear' : '$count', severity: ok ? 'SUCCESS' : 'WARNING'),
        ],
      ),
    );
  }

  /// Two-up tiles that size to their own content.
  ///
  /// A fixed `childAspectRatio` overflowed on real devices as soon as a tile
  /// carried a sub-line or the user's font scale was above default (seen as
  /// "BOTTOM OVERFLOWED BY 27 PIXELS" on a 1080x2376 phone). Pairing the tiles
  /// in an IntrinsicHeight row lets each row take the height its tallest tile
  /// needs, so the layout holds at any text scale.
  Widget _grid(List<Widget> tiles) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: tiles[i]),
              const SizedBox(width: 12),
              Expanded(
                child: i + 1 < tiles.length
                    ? tiles[i + 1]
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 12));
    }
    return Column(children: rows);
  }
}

enum _HealthState { loading, offline, noData }

/// Shown until the engine publishes a score. Deliberately not a number: a
/// stand-in figure from another formula is what made the score change under
/// the reader a second after the screen opened.
class _HealthPlaceholder extends StatelessWidget {
  const _HealthPlaceholder({required this.state});
  final _HealthState state;

  @override
  Widget build(BuildContext context) {
    final message = switch (state) {
      _HealthState.loading => 'Scoring live school data…',
      _HealthState.offline =>
        'Score unavailable — the intelligence engine is unreachable.',
      _HealthState.noData => 'Not enough recorded data to score the school yet.',
    };

    return MCard(
      lead: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(
              overline: 'Operational health', title: 'School health'),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('—',
                          style: AppType.display(46,
                              weight: FontWeight.w600, letterSpacing: 0)),
                      const SizedBox(width: 6),
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text('/100',
                            style: TextStyle(fontSize: 15, color: AppColors.slate400)),
                      ),
                    ],
                  ),
                ),
              ),
              if (state == _HealthState.loading) ...[
                const SizedBox(width: 10),
                const SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ],
            ],
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < 4; i++)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: MSkeleton(height: 8, radius: 999),
            ),
          const SizedBox(height: 2),
          Text(message,
              style: const TextStyle(fontSize: 11, color: AppColors.slate400)),
        ],
      ),
    );
  }
}

/// School health, sourced only from the intelligence engine.
class HealthCard extends ConsumerWidget {
  const HealthCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The intelligence engine is the only source of this number. The server
    // used to publish a second one from different categories and different
    // weights, and whichever arrived first was drawn — so the score visibly
    // changed a second after the screen opened. Until the engine answers,
    // nothing stands in for it.
    final async = ref.watch(intelligenceProvider);
    final intel = async.value;
    final engine = (intel != null && intel.online) ? intel.payload!.health : null;
    final double? overall = engine?.overall;

    if (overall == null) {
      return _HealthPlaceholder(
        state: async.isLoading
            ? _HealthState.loading
            : engine == null
                ? _HealthState.offline
                : _HealthState.noData,
      );
    }

    // Rendered raw, as the web does: rounding here made the phone read 82
    // where the browser read 82.2 for the same school.
    final (label, accent) = overall >= 85
        ? ('Excellent', MAccent.mint)
        : overall >= 70
            ? ('Healthy', MAccent.brand)
            : overall >= 50
                ? ('Fair', MAccent.amber)
                : ('Needs attention', MAccent.rose);

    return MCard(
      lead: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Operational health', title: 'School health'),
          // The figure yields before the verdict does: "Needs attention" beside
          // a three-digit score overflowed a narrow phone, and a clipped status
          // is worse than a slightly smaller number. Same rule as StatTile.
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      MCountUp(
                        overall,
                        decimals: overall == overall.roundToDouble() ? 0 : 1,
                        style: AppType.display(46,
                            weight: FontWeight.w600, letterSpacing: 0),
                      ),
                      const SizedBox(width: 6),
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text('/100',
                            style: TextStyle(fontSize: 15, color: AppColors.slate400)),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              MBadge(label, severity: accent == MAccent.mint || accent == MAccent.brand ? 'SUCCESS' : accent == MAccent.amber ? 'WARNING' : 'CRITICAL'),
            ],
          ),
          const SizedBox(height: 14),
          // Only categories the engine actually scored. One that abstains for
          // want of data is absent, never drawn as a low bar.
          for (final c in engine!.scoredCategories) _bar(c.label, c.score!.round()),
          const SizedBox(height: 2),
          Text(
            'Weighted across ${engine.scoredCategories.length} categories by the intelligence engine.',
            style: const TextStyle(fontSize: 11, color: AppColors.slate400),
          ),
        ],
      ),
    );
  }

  Widget _bar(String label, int value) {
    final accent = value >= 85 ? MAccent.mint : value >= 70 ? MAccent.brand : value >= 50 ? MAccent.amber : MAccent.rose;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.slate600))),
              Text('$value', style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
            ],
          ),
          const SizedBox(height: 5),
          MMeter(value: value.toDouble(), accent: accent),
        ],
      ),
    );
  }
}

class _AlertBanner extends StatelessWidget {
  const _AlertBanner({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.rose.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.rose.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.rose, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13, color: AppColors.roseDeep, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 40),
      child: Column(
        children: [
          MEmptyState(
            icon: Icons.cloud_off_outlined,
            title: "Couldn't load the dashboard",
            hint: message,
          ),
          const SizedBox(height: 12),
          MButton(
            'Try again',
            icon: Icons.refresh,
            kind: MButtonKind.ghost,
            onPressed: onRetry,
          ),
        ],
      ),
    );
  }
}

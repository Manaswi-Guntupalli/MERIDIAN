import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/navigation/role_nav.dart';
import '../../../core/realtime/realtime_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/navigation/nav_destination.dart';
import '../../../shared/widgets/app_background.dart';
import '../../../shared/widgets/brand_logo.dart';
import '../../auth/presentation/auth_controller.dart';
import 'more_screen.dart';

/// The adaptive home shell. It reads the signed-in user's role, loads that
/// role's navigation, and presents it as a bottom bar on phones or a rail on
/// tablets — with a "More" overflow when a role has more modules than a bottom
/// bar should hold. One app, four role experiences.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  static const int _maxTabs = 5;

  /// The synthetic overflow tab's identity. Phones show it; the tablet rail
  /// lists every destination directly and so has no equivalent.
  static const String _moreKey = 'More';

  /// What is selected, held as a destination identity rather than a bare index.
  ///
  /// The two layouts present *different lists* — the bottom bar shows four
  /// destinations plus "More", the rail shows all ten — so an index means
  /// different things in each. Keeping an index made rotation silently jump
  /// screens (portrait "More" is index 4; rail index 4 is Students). Labels are
  /// unique within a role, so they identify a destination across both layouts.
  String _selectedKey = '';

  @override
  void initState() {
    super.initState();
    // The shell only exists while signed in, so this is the natural place to
    // open (and, on sign-out teardown, close) the realtime stream.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(realtimeServiceProvider).start();
    });
  }

  /// Resolve the current selection into an index within [shown].
  ///
  /// When the selected destination isn't present in this layout, fall back to
  /// wherever it actually lives rather than to whatever happens to share its
  /// old index:
  ///
  ///  * rail "Students" ➜ portrait: Students sits inside the More grid, so
  ///    select More — one tap away, and honest about where it went.
  ///  * portrait "More" ➜ rail: the rail lists everything, so a menu has no
  ///    equivalent; fall back to the first destination.
  int _resolveIndex(List<MDestination> shown, List<MDestination> overflow) {
    final direct = shown.indexWhere((d) => d.label == _selectedKey);
    if (direct != -1) return direct;

    final isInOverflow = overflow.any((d) => d.label == _selectedKey);
    if (isInOverflow) {
      final more = shown.indexWhere((d) => d.label == _moreKey);
      if (more != -1) return more;
    }
    return 0;
  }

  /// Publish the section so the app-wide [AppBackground] tints to match — the
  /// mobile stand-in for the web reading the group off the URL. Deferred a
  /// frame because selection happens during a build.
  void _publishGroup(List<MDestination> shown, int index) {
    if (index < 0 || index >= shown.length) return;
    final group = shown[index].group;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(navGroupProvider.notifier).set(group);
    });
  }

  /// Surfaces a live event in-app, the way the web's toaster does. The system
  /// notification is raised separately by [PushService], so an alert lands
  /// whether or not the app is in the foreground.
  void _showAlert(RealtimeAlert alert) {
    if (!mounted) return;
    final c = AppColors.severity(alert.severity);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: AppColors.slate900,
          duration:
              Duration(seconds: alert.severity == 'CRITICAL' ? 8 : 4),
          content: Row(
            children: [
              Container(width: 3, height: 34, color: c),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(alert.title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 13.5)),
                    if (alert.body.isNotEmpty)
                      Text(alert.body,
                          style: const TextStyle(fontSize: 12, height: 1.35)),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    if (user == null) return const SizedBox.shrink();
    final destinations = navForRole(user.role);

    ref.listen(realtimeAlertsProvider, (_, next) {
      final alert = next.value;
      if (alert != null) _showAlert(alert);
    });

    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth >= 720;
        return isTablet
            ? _railLayout(destinations)
            : _bottomLayout(destinations);
      },
    );
  }

  // ── Phone: bottom navigation bar (+ "More" overflow) ──
  Widget _bottomLayout(List<MDestination> destinations) {
    final List<MDestination> navDests;
    final List<Widget> pages;

    List<MDestination> overflow = const [];

    if (destinations.length <= _maxTabs) {
      navDests = destinations;
      pages = [for (final d in destinations) d.builder(context)];
    } else {
      final primary = destinations.take(_maxTabs - 1).toList();
      overflow = destinations.skip(_maxTabs - 1).toList();
      navDests = [
        ...primary,
        // The overflow grid spans several modules, so it takes the neutral
        // System hue rather than borrowing one section's colour.
        const MDestination(
          label: _moreKey,
          icon: Icons.more_horiz,
          builder: _noop,
          group: NavGroup.system,
        ),
      ];
      pages = [
        for (final d in primary) d.builder(context),
        MoreScreen(destinations: overflow),
      ];
    }

    final index = _resolveIndex(navDests, overflow);
    _publishGroup(navDests, index);
    return Scaffold(
      appBar: _appBar(),
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) =>
            setState(() => _selectedKey = navDests[i].label),
        destinations: [
          for (final d in navDests)
            NavigationDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selectedIcon),
              label: d.navLabel,
            ),
        ],
      ),
    );
  }

  // ── Tablet: navigation rail (all destinations, scroll-safe) ──
  Widget _railLayout(List<MDestination> destinations) {
    // The rail lists every destination, so nothing is in overflow here.
    final index = _resolveIndex(destinations, const []);
    _publishGroup(destinations, index);
    return Scaffold(
      appBar: _appBar(),
      body: Row(
        children: [
          LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: NavigationRail(
                    selectedIndex: index,
                    onDestinationSelected: (i) =>
                        setState(() => _selectedKey = destinations[i].label),
                    labelType: NavigationRailLabelType.all,
                    groupAlignment: -0.9,
                    destinations: [
                      for (final d in destinations)
                        NavigationRailDestination(
                          icon: Icon(d.icon),
                          selectedIcon: Icon(d.selectedIcon),
                          label: Text(d.navLabel),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: IndexedStack(
              index: index,
              children: [for (final d in destinations) d.builder(context)],
            ),
          ),
        ],
      ),
    );
  }

  PreferredSizeWidget _appBar() {
    final user = ref.watch(currentUserProvider);
    return AppBar(
      titleSpacing: 16,
      title: Row(
        children: [
          const BrandLogo(size: 28),
          const SizedBox(width: 10),
          Text('Meridian', style: AppType.display(17)),
        ],
      ),
      actions: [
        PopupMenuButton<String>(
          tooltip: 'Account',
          position: PopupMenuPosition.under,
          onSelected: (v) {
            if (v == 'logout') {
              ref.read(authControllerProvider.notifier).logout();
            }
          },
          itemBuilder: (context) => [
            PopupMenuItem<String>(
              enabled: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user?.name ?? '',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate900)),
                  Text(user?.role.label ?? '',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.slate500)),
                ],
              ),
            ),
            const PopupMenuDivider(),
            const PopupMenuItem<String>(
              value: 'logout',
              child: Row(
                children: [
                  Icon(Icons.logout_rounded, size: 18, color: AppColors.rose),
                  SizedBox(width: 10),
                  Text('Sign out'),
                ],
              ),
            ),
          ],
          child: Padding(
            padding: const EdgeInsets.only(right: 14),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppColors.brand50,
              child: Text(
                initials(user?.name ?? '?'),
                style: const TextStyle(
                  color: AppColors.brand,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

}

// Placeholder builder for the synthetic "More" destination (its page is built
// directly as MoreScreen, so this is never invoked).
Widget _noop(BuildContext context) => const SizedBox.shrink();

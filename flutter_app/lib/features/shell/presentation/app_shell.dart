import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/navigation/role_nav.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/navigation/nav_destination.dart';
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
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    if (user == null) return const SizedBox.shrink();
    final destinations = navForRole(user.role);

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

    if (destinations.length <= _maxTabs) {
      navDests = destinations;
      pages = [for (final d in destinations) d.builder(context)];
    } else {
      final primary = destinations.take(_maxTabs - 1).toList();
      final overflow = destinations.skip(_maxTabs - 1).toList();
      navDests = [
        ...primary,
        const MDestination(
          label: 'More',
          icon: Icons.more_horiz,
          builder: _noop,
        ),
      ];
      pages = [
        for (final d in primary) d.builder(context),
        MoreScreen(destinations: overflow),
      ];
    }

    final index = _index.clamp(0, pages.length - 1);
    return Scaffold(
      appBar: _appBar(),
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final d in navDests)
            NavigationDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selectedIcon),
              label: d.label,
            ),
        ],
      ),
    );
  }

  // ── Tablet: navigation rail (all destinations, scroll-safe) ──
  Widget _railLayout(List<MDestination> destinations) {
    final index = _index.clamp(0, destinations.length - 1);
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
                    onDestinationSelected: (i) => setState(() => _index = i),
                    labelType: NavigationRailLabelType.all,
                    groupAlignment: -0.9,
                    destinations: [
                      for (final d in destinations)
                        NavigationRailDestination(
                          icon: Icon(d.icon),
                          selectedIcon: Icon(d.selectedIcon),
                          label: Text(d.label),
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
                _initials(user?.name ?? '?'),
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

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

// Placeholder builder for the synthetic "More" destination (its page is built
// directly as MoreScreen, so this is never invoked).
Widget _noop(BuildContext context) => const SizedBox.shrink();

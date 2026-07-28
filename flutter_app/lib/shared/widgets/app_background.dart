import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';

/// The module a screen belongs to. These are the web sidebar's nav groups
/// (`client/src/constants/nav.ts`), and they drive the ambient page tint the
/// same way `AmbientBackground.tsx` does — so a given feature is the same
/// colour on both surfaces.
enum NavGroup { overview, pulse, engines, trustCore, system }

/// Hue pair per group, copied from the web's `GROUP_HUES`. The first colour
/// washes the top-left and bottom, the second the right.
const Map<NavGroup, (Color, Color)> _groupHues = {
  // blue + lavender
  NavGroup.overview: (Color(0xFF93C5FD), Color(0xFFC4B5FD)),
  // mint + blue
  NavGroup.pulse: (Color(0xFF6EE7B7), Color(0xFF93C5FD)),
  // peach + pink
  NavGroup.engines: (Color(0xFFFDBA74), Color(0xFFF9A8D4)),
  // gold + peach
  NavGroup.trustCore: (Color(0xFFFCD34D), Color(0xFFFDBA74)),
  // slate + lavender
  NavGroup.system: (Color(0xFFCBD5E1), Color(0xFFC4B5FD)),
};

/// The section whose ambient tint is currently showing.
///
/// The web derives this from the URL; a Flutter shell has no URL, so the shell
/// publishes it here when the tab changes and "More" publishes it while a
/// pushed destination is open. Keeping it app-level means pushed routes get
/// their module's colour too, not just bottom-bar tabs.
class NavGroupNotifier extends Notifier<NavGroup> {
  @override
  NavGroup build() => NavGroup.overview;

  void set(NavGroup group) {
    if (state != group) state = group;
  }
}

final navGroupProvider = NotifierProvider<NavGroupNotifier, NavGroup>(
  NavGroupNotifier.new,
);

/// The background for signed-in screens.
///
/// Three layers, matching the web exactly:
///   1. the `#FBFAF7` canvas (web `body { @apply bg-canvas }`),
///   2. a fixed brand-tinted wash from the top edge (web `body` background-image),
///   3. the group's ambient wash, crossfading over 0.9s when the section
///      changes — never snapping, as on the web.
///
/// The login screen supplies its own pastel wash via `LoginBackground`.
class AppBackground extends ConsumerWidget {
  const AppBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(navGroupProvider);
    final (a, b) = _groupHues[group] ?? _groupHues[NavGroup.overview]!;

    return Stack(
      children: [
        // 1 ── canvas
        const Positioned.fill(child: ColoredBox(color: AppColors.canvas)),

        // 2 ── the brand wash the web pins to the top of every page
        const Positioned.fill(
          child: IgnorePointer(
            child: _Wash(
              color: AppColors.brand,
              center: Alignment(0, -1),
              radius: 0.8,
              opacity: 0.035,
              fadeAt: 0.7,
            ),
          ),
        ),

        // 3 ── the section's ambient tint
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 900),
              switchInCurve: Curves.easeInOut,
              switchOutCurve: Curves.easeInOut,
              // The switcher lays its child out loosely too, so the wash stack
              // has to claim the full box explicitly.
              child: SizedBox.expand(
                key: ValueKey(group),
                child: Stack(
                  children: [
                    // radial-gradient(70% 55% at 10% 0%)
                    _Wash(
                      color: a,
                      center: const Alignment(-0.8, -1),
                      radius: 0.75,
                      opacity: 0.11,
                      midOpacity: 0.06,
                      fadeAt: 0.75,
                    ),
                    // radial-gradient(65% 60% at 100% 30%)
                    _Wash(
                      color: b,
                      center: const Alignment(1, -0.4),
                      radius: 0.7,
                      opacity: 0.09,
                      midOpacity: 0.05,
                      fadeAt: 0.75,
                    ),
                    // radial-gradient(80% 55% at 30% 100%)
                    _Wash(
                      color: a,
                      center: const Alignment(-0.4, 1),
                      radius: 0.85,
                      opacity: 0.07,
                      midOpacity: 0.04,
                      fadeAt: 0.78,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),

        // 4 ── the page itself
        Positioned.fill(child: child),
      ],
    );
  }
}

/// One corner-anchored radial wash with the web's multi-stop falloff, so it
/// reads as faint tinted light rather than a visible ring.
class _Wash extends StatelessWidget {
  const _Wash({
    required this.color,
    required this.center,
    required this.radius,
    required this.opacity,
    required this.fadeAt,
    this.midOpacity,
  });

  final Color color;
  final Alignment center;
  final double radius;
  final double opacity;
  final double? midOpacity;

  /// Where the wash reaches fully transparent, as a fraction of the radius.
  final double fadeAt;

  @override
  Widget build(BuildContext context) {
    final mid = midOpacity;
    // SizedBox.expand, not a bare DecoratedBox: a decoration with no child
    // takes the *smallest* size its constraints allow, and Stack lays out
    // non-positioned children loosely — so without this the wash paints
    // nothing at all.
    return SizedBox.expand(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: center,
            radius: radius,
            colors: [
              color.withValues(alpha: opacity),
              if (mid != null) color.withValues(alpha: mid),
              color.withValues(alpha: 0),
            ],
            stops: [0, if (mid != null) 0.45, fadeAt],
          ),
        ),
      ),
    );
  }
}

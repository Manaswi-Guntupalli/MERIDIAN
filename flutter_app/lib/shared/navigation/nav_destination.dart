import 'package:flutter/widgets.dart';

import '../widgets/app_background.dart';

/// One entry in a role's navigation — a label, an icon, and the screen builder.
/// The adaptive shell decides how to present these (bottom bar on a phone,
/// rail on a tablet, "More" grid for overflow).
class MDestination {
  const MDestination({
    required this.label,
    required this.icon,
    IconData? selectedIcon,
    required this.builder,
    this.group = NavGroup.overview,
    String? navLabel,
  })  : selectedIcon = selectedIcon ?? icon,
        navLabel = navLabel ?? label;

  final String label;

  /// The bottom bar gives each tab a fifth of the screen, so a long name like
  /// "Notifications" wraps and clips. This is the short form shown there; the
  /// page itself still uses [label].
  final String navLabel;
  final IconData icon;
  final IconData selectedIcon;
  final WidgetBuilder builder;

  /// Which web sidebar group this screen belongs to — it sets the ambient
  /// page tint, so Students is mint on the phone exactly as it is in the
  /// browser.
  final NavGroup group;
}

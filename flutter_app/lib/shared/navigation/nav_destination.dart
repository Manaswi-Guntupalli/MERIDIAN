import 'package:flutter/widgets.dart';

/// One entry in a role's navigation — a label, an icon, and the screen builder.
/// The adaptive shell decides how to present these (bottom bar on a phone,
/// rail on a tablet, "More" grid for overflow).
class MDestination {
  const MDestination({
    required this.label,
    required this.icon,
    IconData? selectedIcon,
    required this.builder,
  }) : selectedIcon = selectedIcon ?? icon;

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final WidgetBuilder builder;
}

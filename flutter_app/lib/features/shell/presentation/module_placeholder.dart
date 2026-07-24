import 'package:flutter/material.dart';

import '../../../shared/ui/ui.dart';

/// A holding screen for a module whose real UI lands in a later phase. Keeps
/// the whole shell navigable now, and swaps out for the real screen with a
/// one-line change to the role's nav map.
class ModulePlaceholder extends StatelessWidget {
  const ModulePlaceholder({
    super.key,
    required this.title,
    required this.icon,
    this.overline,
  });

  final String title;
  final IconData icon;
  final String? overline;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        MPageHeader(overline: overline ?? 'Meridian', title: title),
        MEmptyState(
          icon: icon,
          title: '$title — coming soon',
          hint: 'This module is being built. It connects to the same Meridian '
              'backend the web platform uses.',
        ),
      ],
    );
  }
}

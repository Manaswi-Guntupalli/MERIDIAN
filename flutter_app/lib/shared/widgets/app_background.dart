import 'package:flutter/material.dart';

/// The default background for signed-in screens: clean white. (The login screen
/// supplies its own pastel wash via [LoginBackground].) Scaffolds are
/// transparent, so this sits behind every page.
class AppBackground extends StatelessWidget {
  const AppBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(color: Colors.white, child: child);
  }
}

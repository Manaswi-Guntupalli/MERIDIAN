import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'shared/widgets/app_background.dart';

void main() {
  runApp(const ProviderScope(child: MeridianApp()));
}

/// Meridian — the official mobile companion. One app, four role experiences,
/// the same backend as the React web platform.
class MeridianApp extends ConsumerWidget {
  const MeridianApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Meridian',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      // The warm-teal background sits behind every screen (scaffolds are
      // transparent), so the whole app reads like the web.
      builder: (context, child) =>
          AppBackground(child: child ?? const SizedBox.shrink()),
    );
  }
}

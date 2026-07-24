import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/splash_screen.dart';
import '../../features/shell/presentation/app_shell.dart';

/// App routing. A single redirect derives the destination from the auth state
/// the same way the web's `RequireAuth` does: loading → splash, signed out →
/// login, signed in → the role home. `refreshListenable` re-runs the redirect
/// whenever auth changes (login / logout / session expiry).
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loc = state.matchedLocation;
      final atLogin = loc == '/login';
      final atSplash = loc == '/splash';

      return auth.when(
        loading: () => atSplash ? null : '/splash',
        error: (_, _) => atLogin ? null : '/login',
        data: (user) {
          if (user == null) return atLogin ? null : '/login';
          if (atLogin || atSplash) return '/';
          return null;
        },
      );
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/', builder: (_, _) => const AppShell()),
    ],
  );
});

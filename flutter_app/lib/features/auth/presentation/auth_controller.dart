import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/notifications/push_service.dart';
import '../../../core/realtime/realtime_service.dart';
import '../../../core/storage/token_storage.dart';
import '../data/auth_repository.dart';
import '../domain/app_user.dart';

/// The app-wide auth state: `AsyncData(null)` = signed out, `AsyncData(user)` =
/// signed in, `AsyncLoading` = restoring the session on launch. The router
/// watches this to decide where to send the user.
class AuthController extends AsyncNotifier<AppUser?> {
  TokenStorage get _tokens => ref.read(tokenStorageProvider);
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  Future<AppUser?> build() async {
    final token = await _tokens.readToken();
    if (token == null || token.isEmpty) return null;
    // A stored token — validate it against the same /auth/me the web uses.
    try {
      return await _repo.me();
    } catch (_) {
      await _tokens.clear();
      return null;
    }
  }

  /// Sign in with the SAME credentials as the web. Throws on failure so the
  /// login screen can show the backend's human message; only success mutates
  /// the global auth state.
  Future<void> login(
    String email,
    String password, {
    bool rememberMe = false,
  }) async {
    final result = await _repo.login(email, password, rememberMe: rememberMe);
    await _tokens.writeToken(result.token);
    state = AsyncData(result.user);
  }

  /// Rotate the password (the backend revokes other sessions and hands this
  /// device a fresh token). Throws on failure so the caller can show the
  /// backend's message.
  Future<void> changePassword(String current, String next) async {
    final result = await _repo.changePassword(current, next);
    await _tokens.writeToken(result.token);
    state = AsyncData(result.user);
  }

  Future<void> logout() async {
    try {
      await _repo.logout();
    } catch (_) {
      // Best-effort audit call; local sign-out proceeds regardless.
    }
    // Drop the realtime stream and any notifications this user left on the
    // device before clearing the token — a shared phone must not keep
    // receiving the previous account's alerts.
    ref.read(realtimeServiceProvider).stop();
    await ref.read(pushServiceProvider).clear();
    await _tokens.clear();
    state = const AsyncData(null);
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AppUser?>(AuthController.new);

/// Convenience: the current user or null (non-loading reads).
final currentUserProvider = Provider<AppUser?>(
  (ref) => ref.watch(authControllerProvider).asData?.value,
);

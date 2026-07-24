import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';

/// The single Dio instance every feature repository uses. It attaches the JWT
/// bearer on every request (identical to the web's Axios interceptor) and, on a
/// 401, clears the token so the app falls back to signed-out state. It never
/// creates new endpoints — it only calls the existing backend.
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: Env.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ),
  );

  final tokens = ref.read(tokenStorageProvider);

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await tokens.readToken();
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        // A dead session: drop the token. The auth controller re-checks on the
        // next `/auth/me`, flipping the UI to the login screen. We deliberately
        // do NOT touch other providers here to avoid re-entrancy loops.
        if (e.response?.statusCode == 401) {
          await tokens.clear();
        }
        handler.next(e);
      },
    ),
  );

  return dio;
});

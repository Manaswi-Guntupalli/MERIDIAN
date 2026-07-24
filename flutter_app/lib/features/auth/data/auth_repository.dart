import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../domain/app_user.dart';

/// Result of a successful sign-in — the JWT plus the user it belongs to.
class AuthResult {
  const AuthResult({required this.token, required this.user});
  final String token;
  final AppUser user;
}

/// Talks to the EXISTING auth endpoints — no new APIs, no new auth flow.
/// `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`. The same
/// credentials work here and on the React web app, simultaneously.
class AuthRepository {
  AuthRepository(this._dio);
  final Dio _dio;

  Future<AuthResult> login(
    String email,
    String password, {
    bool rememberMe = false,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password, 'rememberMe': rememberMe},
    );
    final data = res.data!;
    return AuthResult(
      token: data['token'] as String,
      user: _fromJson(
        data['user'] as Map<String, dynamic>,
        mustChange: data['mustChangePassword'] as bool? ?? false,
      ),
    );
  }

  Future<AppUser> me() async {
    final res = await _dio.get<Map<String, dynamic>>('/auth/me');
    final data = res.data!;
    return _fromJson(
      data['user'] as Map<String, dynamic>,
      mustChange: data['mustChangePassword'] as bool? ?? false,
    );
  }

  Future<void> logout() => _dio.post('/auth/logout');

  Future<AuthResult> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/change-password',
      data: {'currentPassword': currentPassword, 'newPassword': newPassword},
    );
    final data = res.data!;
    return AuthResult(
      token: data['token'] as String,
      user: _fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  // ── JSON → domain (the mapper the domain model deliberately doesn't carry) ──
  AppUser _fromJson(Map<String, dynamic> j, {bool mustChange = false}) {
    final school = j['school'] as Map<String, dynamic>?;
    final student = j['student'] as Map<String, dynamic>?;
    final cls = student?['class'] as Map<String, dynamic>?;
    return AppUser(
      id: j['id'] as String,
      name: j['name'] as String? ?? '',
      email: j['email'] as String? ?? '',
      role: UserRole.fromApi(j['role'] as String?),
      schoolId: j['schoolId'] as String? ?? '',
      avatarUrl: j['avatarUrl'] as String?,
      phone: j['phone'] as String?,
      mustChangePassword:
          mustChange || (j['mustChangePassword'] as bool? ?? false),
      schoolName: school?['name'] as String?,
      className: cls?['name'] as String?,
      studentId: student?['id'] as String?,
    );
  }
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.read(dioProvider)),
);

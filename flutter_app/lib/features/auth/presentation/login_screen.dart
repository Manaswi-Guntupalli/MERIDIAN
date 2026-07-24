import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/brand_logo.dart';
import '../../../shared/widgets/login_background.dart';
import 'auth_controller.dart';

/// Mobile sign-in. Same credentials, same backend as the web. The one-tap demo
/// roles mirror the web login so the app is instantly demoable.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController(text: 'principal@meridian.school');
  final _password = TextEditingController(text: 'meridian123');
  bool _remember = false;
  bool _obscure = true;
  bool _loading = false;
  String? _error;

  static const _demoRoles = <(String, String)>[
    ('Principal', 'principal@meridian.school'),
    ('Teacher', 'teacher@meridian.school'),
    ('Student', 'student@meridian.school'),
    ('Parent', 'parent@meridian.school'),
    ('Admin', 'admin@meridian.school'),
    ('Super Admin', 'super@meridian.school'),
  ];

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit({String? asEmail}) async {
    final email = asEmail ?? _email.text.trim();
    final password = asEmail != null ? 'meridian123' : _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .login(email, password, rememberMe: _remember);
      // The router redirect takes over on success.
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e, 'Login failed'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: LoginBackground(
          child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const BrandLogo(size: 42),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Meridian',
                              style: AppType.display(18,
                                  weight: FontWeight.w600)),
                          Text('School Operating System',
                              style: TextStyle(
                                  fontSize: 11,
                                  color: AppColors.slate400,
                                  letterSpacing: 0.8)),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 32),
                  Text('Welcome back',
                      style: AppType.display(26, weight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text('Sign in to your command center.',
                      style: TextStyle(color: AppColors.slate500)),
                  const SizedBox(height: 24),
                  _Field(
                    label: 'Email',
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    hint: 'you@school.edu',
                  ),
                  const SizedBox(height: 16),
                  _Field(
                    label: 'Password',
                    controller: _password,
                    obscure: _obscure,
                    hint: '••••••••',
                    trailing: IconButton(
                      icon: Icon(
                        _obscure
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                        size: 20,
                        color: AppColors.slate400,
                      ),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      SizedBox(
                        height: 24,
                        width: 24,
                        child: Checkbox(
                          value: _remember,
                          onChanged: (v) =>
                              setState(() => _remember = v ?? false),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text('Remember me for 7 days',
                          style: TextStyle(
                              fontSize: 13, color: AppColors.slate600)),
                    ],
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.rose.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(
                            color: AppColors.rose.withValues(alpha: 0.3)),
                      ),
                      child: Text(_error!,
                          style: TextStyle(
                              fontSize: 12.5, color: AppColors.roseDeep)),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _loading ? null : () => _submit(),
                    child: _loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.2, color: Colors.white),
                          )
                        : const Text('Sign in'),
                  ),
                  const SizedBox(height: 28),
                  Row(
                    children: [
                      const Expanded(child: Divider()),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text('ONE-TAP DEMO ROLES', style: AppType.label),
                      ),
                      const Expanded(child: Divider()),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (label, email) in _demoRoles)
                        OutlinedButton(
                          onPressed:
                              _loading ? null : () => _submit(asEmail: email),
                          child: Text(label),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: Text('Password for all demo accounts: meridian123',
                        style: TextStyle(
                            fontSize: 11, color: AppColors.slate400)),
                  ),
                ],
              ),
            ),
          ),
        ),
      )),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.controller,
    this.obscure = false,
    this.hint,
    this.trailing,
    this.keyboardType,
    this.onSubmitted,
  });

  final String label;
  final TextEditingController controller;
  final bool obscure;
  final String? hint;
  final Widget? trailing;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6, left: 2),
          child: Text(label.toUpperCase(), style: AppType.label),
        ),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          onSubmitted: onSubmitted,
          decoration: InputDecoration(hintText: hint, suffixIcon: trailing),
        ),
      ],
    );
  }
}

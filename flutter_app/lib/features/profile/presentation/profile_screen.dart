import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../../auth/presentation/auth_controller.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    if (user == null) return const SizedBox.shrink();

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
      children: [
        const MPageHeader(title: 'Profile'),
        MCard(
          child: Column(
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 30,
                    backgroundColor: AppColors.brand50,
                    child: Text(initials(user.name),
                        style: AppType.display(20, color: AppColors.brand, letterSpacing: 0)),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.name, style: AppType.display(20)),
                        const SizedBox(height: 3),
                        Text(user.email, style: const TextStyle(color: AppColors.slate500, fontSize: 13)),
                        const SizedBox(height: 8),
                        MBadge(user.role.label, severity: 'INFO'),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 26),
              _row('School', user.schoolName ?? '—'),
              if (user.className != null) _row('Class', user.className!),
              if (user.phone != null) _row('Phone', user.phone!),
            ],
          ),
        ),
        const SizedBox(height: 14),
        MCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _action(
                icon: Icons.lock_outline,
                label: 'Change password',
                onTap: () => showDialog<void>(
                  context: context,
                  builder: (_) => const _ChangePasswordDialog(),
                ),
              ),
              const Divider(height: 1, indent: 56),
              _action(
                icon: Icons.logout_rounded,
                label: 'Sign out',
                danger: true,
                onTap: () => ref.read(authControllerProvider.notifier).logout(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: Text('Meridian mobile · connected to your school backend',
              style: const TextStyle(fontSize: 11.5, color: AppColors.slate400)),
        ),
      ],
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            SizedBox(width: 74, child: Text(k, style: AppType.label)),
            Expanded(
              child: Text(v,
                  style: const TextStyle(color: AppColors.slate800, fontWeight: FontWeight.w500)),
            ),
          ],
        ),
      );

  Widget _action({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool danger = false,
  }) {
    final color = danger ? AppColors.rose : AppColors.slate700;
    return ListTile(
      leading: Icon(icon, color: color, size: 20),
      title: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 14)),
      trailing: const Icon(Icons.chevron_right, size: 18, color: AppColors.slate400),
      onTap: onTap,
    );
  }
}

class _ChangePasswordDialog extends ConsumerStatefulWidget {
  const _ChangePasswordDialog();

  @override
  ConsumerState<_ChangePasswordDialog> createState() =>
      _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends ConsumerState<_ChangePasswordDialog> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_next.text.length < 8) {
      setState(() => _error = 'New password must be at least 8 characters.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .changePassword(_current.text, _next.text);
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password updated')),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _current,
            obscureText: true,
            decoration: const InputDecoration(hintText: 'Current password'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _next,
            obscureText: true,
            decoration: const InputDecoration(hintText: 'New password (min 8)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(color: AppColors.roseDeep, fontSize: 12.5)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
              : const Text('Update'),
        ),
      ],
    );
  }
}

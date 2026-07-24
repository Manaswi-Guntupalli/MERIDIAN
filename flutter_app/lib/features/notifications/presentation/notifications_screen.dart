import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/notifications_repository.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(notificationsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(notificationsProvider);
        await ref.read(notificationsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          MPageHeader(
            title: 'Notifications',
            actions: [
              feedAsync.maybeWhen(
                data: (f) => f.unread == 0
                    ? const SizedBox.shrink()
                    : TextButton(
                        onPressed: () async {
                          await ref
                              .read(notificationsRepositoryProvider)
                              .markAllRead();
                          ref.invalidate(notificationsProvider);
                        },
                        child: const Text('Mark all read'),
                      ),
                orElse: () => const SizedBox.shrink(),
              ),
            ],
          ),
          feedAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.only(top: 60),
              child: MLoading(),
            ),
            error: (e, _) => Padding(
              padding: const EdgeInsets.only(top: 40),
              child: MEmptyState(
                icon: Icons.cloud_off_outlined,
                title: "Couldn't load notifications",
                hint: friendlyError(e),
              ),
            ),
            data: (feed) => feed.items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.only(top: 40),
                    child: MEmptyState(
                      icon: Icons.notifications_none_outlined,
                      title: 'You’re all caught up',
                      hint: 'New alerts about attendance, fees and approvals will appear here.',
                    ),
                  )
                : Column(
                    children: [
                      for (final n in feed.items) ...[
                        _NotificationTile(
                          n: n,
                          onTap: () async {
                            if (!n.read) {
                              await ref
                                  .read(notificationsRepositoryProvider)
                                  .markRead(n.id);
                              ref.invalidate(notificationsProvider);
                            }
                          },
                        ),
                        const SizedBox(height: 10),
                      ],
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.n, required this.onTap});
  final AppNotification n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = AppColors.severity(n.severity);
    return MCard(
      padding: const EdgeInsets.all(14),
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: c.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(_icon(n.category), color: c, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        n.title,
                        style: TextStyle(
                          fontWeight: n.read ? FontWeight.w600 : FontWeight.w700,
                          color: AppColors.slate900,
                        ),
                      ),
                    ),
                    if (!n.read)
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: AppColors.brand,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(n.body,
                    style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.slate600)),
                const SizedBox(height: 6),
                Text(timeAgo(n.createdAt),
                    style: const TextStyle(fontSize: 11.5, color: AppColors.slate400)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IconData _icon(String? category) => switch (category) {
        'ATTENDANCE' => Icons.fact_check_outlined,
        'SECURITY' => Icons.shield_outlined,
        'TIMETABLE' => Icons.calendar_month_outlined,
        'FEES' => Icons.account_balance_wallet_outlined,
        _ => Icons.notifications_outlined,
      };
}

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/util/format.dart';
import '../../../shared/ui/ui.dart';
import '../data/notifications_repository.dart';
import 'notifications_screen.dart' show notificationIcon;

/// Opens one notification as its own page.
Future<void> openNotification(BuildContext context, AppNotification n) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => NotificationDetailScreen(n: n)),
    );

/// A single notification, read in full.
///
/// The feed shows a two-line preview so a long school notice cannot push every
/// other alert off the screen; the whole text lives here, laid out the way its
/// author wrote it — paragraph breaks intact, and selectable so a parent can
/// copy a date into their calendar.
class NotificationDetailScreen extends StatelessWidget {
  const NotificationDetailScreen({super.key, required this.n});

  final AppNotification n;

  @override
  Widget build(BuildContext context) {
    final c = AppColors.severity(n.severity);
    final category = n.category;

    return Scaffold(
      appBar: AppBar(title: Text(_heading(category))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          MCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: c.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(notificationIcon(category), color: c, size: 20),
                    ),
                    const SizedBox(width: 12),
                    // The subject gets the full width — a badge beside it
                    // squeezes a normal-length subject onto three lines.
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(n.title,
                              style: AppType.display(20, weight: FontWeight.w600)),
                          const SizedBox(height: 7),
                          Row(
                            children: [
                              if (category != null && category.isNotEmpty) ...[
                                MBadge(_badgeLabel(category)),
                                const SizedBox(width: 8),
                              ],
                              Text(
                                timeAgo(n.createdAt),
                                style: const TextStyle(
                                    fontSize: 12, color: AppColors.slate400),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Divider(height: 1, color: AppColors.line),
                ),
                SelectableText(
                  n.body,
                  style: const TextStyle(
                    fontSize: 14.5,
                    height: 1.55,
                    color: AppColors.slate700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// A school notice is a different kind of thing from an alert, and the title
  /// bar should say so.
  static String _heading(String? category) =>
      category == 'NOTICE' ? 'School Notice' : 'Notification';

  static String _badgeLabel(String category) =>
      category[0] + category.substring(1).toLowerCase();
}

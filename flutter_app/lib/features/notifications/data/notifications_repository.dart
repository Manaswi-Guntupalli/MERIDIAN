import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.read,
    required this.createdAt,
    this.severity,
    this.category,
  });

  final String id;
  final String title;
  final String body;
  final bool read;
  final DateTime? createdAt;
  final String? severity;
  final String? category;

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        read: j['read'] as bool? ?? false,
        createdAt: DateTime.tryParse(j['createdAt'] as String? ?? ''),
        severity: j['severity'] as String?,
        category: j['category'] as String?,
      );
}

class NotificationFeed {
  const NotificationFeed({required this.items, required this.unread});
  final List<AppNotification> items;
  final int unread;
}

class NotificationsRepository {
  NotificationsRepository(this._dio);
  final Dio _dio;

  Future<NotificationFeed> fetch() async {
    final res = await _dio.get<Map<String, dynamic>>('/notifications');
    final items = (res.data!['notifications'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map(AppNotification.fromJson)
        .toList();
    return NotificationFeed(
      items: items,
      unread: (res.data!['unread'] ?? 0) as int,
    );
  }

  // Both are PATCH on the server (notifications.routes.ts) — POSTing here got
  // a 404, so "mark read" silently did nothing.
  Future<void> markAllRead() => _dio.patch('/notifications/read-all');
  Future<void> markRead(String id) => _dio.patch('/notifications/$id/read');
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (ref) => NotificationsRepository(ref.read(dioProvider)),
);

final notificationsProvider = FutureProvider.autoDispose<NotificationFeed>(
  (ref) => ref.read(notificationsRepositoryProvider).fetch(),
);

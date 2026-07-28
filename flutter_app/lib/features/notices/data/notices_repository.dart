import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';

// ── GET /notices/audiences, POST /notices/draft, POST /notices/send ──
//
// The same three endpoints the web uses. The server decides what this account
// may address and who that resolves to; the app only renders those choices and
// posts back the notice a human approved.

/// Who the notice is about.
enum NoticeScope { school, grade, cls }

extension NoticeScopeApi on NoticeScope {
  String get api => switch (this) {
        NoticeScope.school => 'SCHOOL',
        NoticeScope.grade => 'GRADE',
        NoticeScope.cls => 'CLASS',
      };

  static NoticeScope? fromApi(String v) => switch (v) {
        'SCHOOL' => NoticeScope.school,
        'GRADE' => NoticeScope.grade,
        'CLASS' => NoticeScope.cls,
        _ => null,
      };
}

/// Which people inside that scope receive it.
enum NoticeRecipients { students, parents, both, teachers }

extension NoticeRecipientsApi on NoticeRecipients {
  String get api => switch (this) {
        NoticeRecipients.students => 'STUDENTS',
        NoticeRecipients.parents => 'PARENTS',
        NoticeRecipients.both => 'BOTH',
        NoticeRecipients.teachers => 'TEACHERS',
      };

  String get label => switch (this) {
        NoticeRecipients.students => 'Students',
        NoticeRecipients.parents => 'Parents',
        NoticeRecipients.both => 'Students + Parents',
        NoticeRecipients.teachers => 'Teachers',
      };

  static NoticeRecipients? fromApi(String v) => switch (v) {
        'STUDENTS' => NoticeRecipients.students,
        'PARENTS' => NoticeRecipients.parents,
        'BOTH' => NoticeRecipients.both,
        'TEACHERS' => NoticeRecipients.teachers,
        _ => null,
      };
}

/// One selectable value inside a scope (a class, or a grade).
class ScopeOption {
  const ScopeOption({required this.id, required this.label});
  final String id;
  final String label;

  factory ScopeOption.fromJson(Map<String, dynamic> j) => ScopeOption(
        id: j['id']?.toString() ?? '',
        label: j['label']?.toString() ?? '',
      );
}

/// A scope this sender is permitted to use, with its valid recipient groups.
class AudienceOption {
  const AudienceOption({
    required this.scope,
    required this.label,
    required this.options,
    required this.recipients,
  });

  final NoticeScope scope;
  final String label;
  final List<ScopeOption> options;
  final List<NoticeRecipients> recipients;

  /// SCHOOL needs no further choice; GRADE and CLASS do.
  bool get needsOption => scope != NoticeScope.school;

  static AudienceOption? fromJson(Map<String, dynamic> j) {
    final scope = NoticeScopeApi.fromApi(j['scope']?.toString() ?? '');
    if (scope == null) return null;
    return AudienceOption(
      scope: scope,
      label: j['label']?.toString() ?? '',
      options: ((j['options'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(ScopeOption.fromJson)
          .toList(),
      recipients: ((j['recipients'] as List?) ?? const [])
          .map((r) => NoticeRecipientsApi.fromApi(r.toString()))
          .whereType<NoticeRecipients>()
          .toList(),
    );
  }
}

/// What this account may send, as the server reports it.
class NoticePermissions {
  const NoticePermissions({required this.audiences, required this.tones});
  final List<AudienceOption> audiences;
  final List<String> tones;

  bool get isEmpty => audiences.isEmpty;

  factory NoticePermissions.fromJson(Map<String, dynamic> j) => NoticePermissions(
        audiences: ((j['audiences'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(AudienceOption.fromJson)
            .whereType<AudienceOption>()
            .toList(),
        tones: ((j['tones'] as List?) ?? const []).map((t) => t.toString()).toList(),
      );
}

/// The audience the user has chosen, in the shape the API expects.
class AudienceSelection {
  const AudienceSelection({
    required this.scope,
    required this.recipients,
    this.scopeId,
  });

  final NoticeScope scope;
  final NoticeRecipients recipients;
  final String? scopeId;

  Map<String, dynamic> toJson() => {
        'scope': scope.api,
        if (scopeId != null && scopeId!.isNotEmpty) 'scopeId': scopeId,
        'recipients': recipients.api,
      };
}

/// A generated draft, with the reach it was written for.
class NoticeDraft {
  const NoticeDraft({
    required this.text,
    required this.audience,
    required this.recipientCount,
  });
  final String text;
  final String audience;
  final int recipientCount;

  factory NoticeDraft.fromJson(Map<String, dynamic> j) => NoticeDraft(
        text: j['draft']?.toString() ?? '',
        audience: j['audience']?.toString() ?? '',
        recipientCount: (j['recipientCount'] ?? 0) as int,
      );
}

/// The outcome of an approved send.
class NoticeSendResult {
  const NoticeSendResult({
    required this.delivered,
    required this.audience,
    required this.teacherEdited,
  });
  final int delivered;
  final String audience;
  final bool teacherEdited;

  factory NoticeSendResult.fromJson(Map<String, dynamic> j) => NoticeSendResult(
        delivered: (j['delivered'] ?? 0) as int,
        audience: j['audience']?.toString() ?? '',
        teacherEdited: (j['teacherEdited'] ?? false) as bool,
      );
}

class NoticesRepository {
  NoticesRepository(this._dio);
  final Dio _dio;

  Future<NoticePermissions> permissions() async {
    final res = await _dio.get<Map<String, dynamic>>('/notices/audiences');
    return NoticePermissions.fromJson(res.data ?? const {});
  }

  /// Rewrites the staff member's facts. Persists nothing and sends nothing.
  Future<NoticeDraft> draft({
    required String subject,
    required String context,
    required String tone,
    required AudienceSelection audience,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>('/notices/draft', data: {
      'subject': subject,
      'context': context,
      'tone': tone,
      'audience': audience.toJson(),
    });
    return NoticeDraft.fromJson(res.data ?? const {});
  }

  /// The only call that delivers anything, and only after a human approved
  /// [body]. `aiDraft` lets the server record whether the wording was edited.
  Future<NoticeSendResult> send({
    required String subject,
    required String body,
    required AudienceSelection audience,
    required bool aiAssisted,
    String? aiDraft,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>('/notices/send', data: {
      'subject': subject,
      'body': body,
      'audience': audience.toJson(),
      'aiAssisted': aiAssisted,
      'aiDraft': ?aiDraft,
    });
    return NoticeSendResult.fromJson(res.data ?? const {});
  }
}

final noticesRepositoryProvider = Provider<NoticesRepository>(
  (ref) => NoticesRepository(ref.read(dioProvider)),
);

/// Session-scoped: what this account may send depends on who is signed in.
final noticePermissionsProvider = FutureProvider.autoDispose<NoticePermissions>(
  (ref) => ref.read(noticesRepositoryProvider).permissions(),
);

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/core/theme/app_theme.dart';
import 'package:meridian_app/features/notices/data/notices_repository.dart';
import 'package:meridian_app/features/notices/presentation/ai_notice_screen.dart';
import 'package:meridian_app/shared/ui/ui.dart';

/// AI Notice on mobile.
///
/// The rule the whole feature rests on is that nothing is delivered without a
/// human pressing send, and that the reach offered is the reach the server
/// granted — never a list the client invented. These tests pin both, plus the
/// two states that decide whether a teacher can trust the screen: the "edited
/// by you" signal, and a failed send keeping the words they approved.

/// What the server returns for a class teacher: one scope, no Teachers group.
final _teacherPerms = NoticePermissions(
  audiences: [
    const AudienceOption(
      scope: NoticeScope.cls,
      label: 'A class you teach',
      options: [
        ScopeOption(id: 'c6a', label: '6A'),
        ScopeOption(id: 'c7a', label: '7A'),
      ],
      recipients: [
        NoticeRecipients.students,
        NoticeRecipients.parents,
        NoticeRecipients.both,
      ],
    ),
  ],
  tones: const ['Professional', 'Friendly'],
);

const _aiDraft = 'Dear Students and Parents,\n\nThe practical moves to Period 5.';

class _FakeNotices extends NoticesRepository {
  _FakeNotices({this.sendFails = false}) : super(Dio());

  final bool sendFails;
  int drafts = 0;
  Map<String, dynamic>? lastSend;

  @override
  Future<NoticePermissions> permissions() async => _teacherPerms;

  @override
  Future<NoticeDraft> draft({
    required String subject,
    required String context,
    required String tone,
    required AudienceSelection audience,
  }) async {
    drafts++;
    return const NoticeDraft(
      text: _aiDraft,
      audience: 'Class 6A · students and parents',
      recipientCount: 44,
    );
  }

  @override
  Future<NoticeSendResult> send({
    required String subject,
    required String body,
    required AudienceSelection audience,
    required bool aiAssisted,
    String? aiDraft,
  }) async {
    lastSend = {
      'subject': subject,
      'body': body,
      'scope': audience.scope,
      'scopeId': audience.scopeId,
      'recipients': audience.recipients,
      'aiAssisted': aiAssisted,
      'aiDraft': aiDraft,
    };
    if (sendFails) throw Exception('network down');
    return const NoticeSendResult(
      delivered: 44,
      audience: 'Class 6A · students and parents',
      teacherEdited: true,
    );
  }
}

/// Bounded pumps rather than `pumpAndSettle`: the loading state spins
/// indefinitely, so waiting for a quiescent frame can hang.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<_FakeNotices> _pump(WidgetTester tester, {bool sendFails = false}) async {
  tester.view.physicalSize = const Size(430, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final repo = _FakeNotices(sendFails: sendFails);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [noticesRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: AiNoticeScreen()),
      ),
    ),
  );
  await _settle(tester);
  return repo;
}

/// Opens a dropdown and picks the entry with [option] — `.last` because the
/// closed field renders the same text as the menu item.
Future<void> _choose(WidgetTester tester, Finder dropdown, String option) async {
  await tester.tap(dropdown);
  await _settle(tester);
  await tester.tap(find.text(option).last);
  await _settle(tester);
}

MButton _button(WidgetTester tester, String label) =>
    tester.widget<MButton>(find.widgetWithText(MButton, label));

/// The composer is taller than any test viewport, so scroll the control into
/// view before tapping — an off-screen tap lands on nothing and passes silently.
Future<void> _tapButton(WidgetTester tester, String label) async {
  final finder = find.widgetWithText(MButton, label);
  await tester.ensureVisible(finder);
  await _settle(tester);
  await tester.tap(finder);
  await _settle(tester);
}

Future<void> _typeInto(WidgetTester tester, Finder field, String text) async {
  await tester.ensureVisible(field);
  await _settle(tester);
  await tester.enterText(field, text);
  await _settle(tester);
}

/// Everything needed before a draft can be requested.
Future<void> _fillForm(WidgetTester tester) async {
  await _choose(tester, find.byType(DropdownButtonFormField<NoticeScope>),
      'A class you teach');
  await _choose(tester, find.byType(DropdownButtonFormField<String>).first, '6A');
  await _choose(tester, find.byType(DropdownButtonFormField<NoticeRecipients>),
      'Students + Parents');
  await _typeInto(tester, find.widgetWithText(TextField, 'Subject'),
      'Chemistry practical rescheduled');
  await _typeInto(tester, find.widgetWithText(TextField, 'Context'),
      'Moved from Period 2 to Period 5.');
}

void main() {
  group('AI Notice offers only the reach the server granted', () {
    testWidgets('a class teacher gets no school-wide option', (tester) async {
      await _pump(tester);
      await tester.tap(find.byType(DropdownButtonFormField<NoticeScope>));
      await _settle(tester);

      expect(find.text('A class you teach'), findsWidgets);
      expect(find.text('Entire school'), findsNothing);
      expect(find.text('A grade'), findsNothing);
    });

    testWidgets('a class teacher cannot address Teachers', (tester) async {
      await _pump(tester);
      await _choose(tester, find.byType(DropdownButtonFormField<NoticeScope>),
          'A class you teach');
      await tester.tap(find.byType(DropdownButtonFormField<NoticeRecipients>));
      await _settle(tester);

      expect(find.text('Students + Parents'), findsWidgets);
      expect(find.text('Teachers'), findsNothing);
    });

    testWidgets('an account with no audiences is told so, not shown a form',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            noticePermissionsProvider.overrideWith(
              (ref) async => const NoticePermissions(audiences: [], tones: []),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            home: const Scaffold(body: AiNoticeScreen()),
          ),
        ),
      );
      await _settle(tester);

      expect(find.text('No audiences available to you'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<NoticeScope>), findsNothing);
    });
  });

  group('Nothing is generated or sent by accident', () {
    testWidgets('Draft with AI stays disabled until the form is complete',
        (tester) async {
      final repo = await _pump(tester);
      expect(_button(tester, 'Draft with AI').onPressed, isNull);

      // Audience alone is not enough — the facts are what get rewritten.
      await _choose(tester, find.byType(DropdownButtonFormField<NoticeScope>),
          'A class you teach');
      await _choose(
          tester, find.byType(DropdownButtonFormField<String>).first, '6A');
      await _choose(tester, find.byType(DropdownButtonFormField<NoticeRecipients>),
          'Students + Parents');
      expect(_button(tester, 'Draft with AI').onPressed, isNull);

      await _typeInto(
          tester, find.widgetWithText(TextField, 'Subject'), 'Practical moved');
      expect(_button(tester, 'Draft with AI').onPressed, isNull,
          reason: 'a subject with no facts has nothing to rewrite');

      await _typeInto(tester, find.widgetWithText(TextField, 'Context'),
          'Moved from Period 2 to Period 5.');
      expect(_button(tester, 'Draft with AI').onPressed, isNotNull);
      expect(repo.drafts, 0, reason: 'no request before the button is pressed');
    });

    testWidgets('there is no send button until a draft exists', (tester) async {
      await _pump(tester);
      expect(find.widgetWithText(MButton, 'Review & Send'), findsNothing);
      expect(find.text('No draft yet'), findsOneWidget);
    });
  });

  group('Draft, edit, send', () {
    testWidgets('the draft appears and an edit is flagged as the human\'s',
        (tester) async {
      final repo = await _pump(tester);
      await _fillForm(tester);

      await _tapButton(tester, 'Draft with AI');
      expect(repo.drafts, 1);
      expect(find.text(_aiDraft), findsOneWidget);
      expect(find.text('edited by you'), findsNothing);

      await tester.enterText(
          find.widgetWithText(TextField, _aiDraft), '$_aiDraft\n\nPlease be punctual.');
      await _settle(tester);
      expect(find.text('edited by you'), findsOneWidget);
    });

    testWidgets('send posts the approved words, not the model\'s',
        (tester) async {
      final repo = await _pump(tester);
      await _fillForm(tester);
      await _tapButton(tester, 'Draft with AI');

      const approved = '$_aiDraft\n\nPlease be punctual.';
      await _typeInto(tester, find.widgetWithText(TextField, _aiDraft), approved);
      await _tapButton(tester, 'Review & Send');

      expect(repo.lastSend, isNotNull);
      expect(repo.lastSend!['body'], approved);
      // The draft rides along only so the server can record that it changed.
      expect(repo.lastSend!['aiDraft'], _aiDraft);
      expect(repo.lastSend!['aiAssisted'], isTrue);
      expect(repo.lastSend!['scope'], NoticeScope.cls);
      expect(repo.lastSend!['scopeId'], 'c6a');
      expect(repo.lastSend!['recipients'], NoticeRecipients.both);
    });

    testWidgets('a delivered notice clears the composer', (tester) async {
      await _pump(tester);
      await _fillForm(tester);
      await _tapButton(tester, 'Draft with AI');
      await _tapButton(tester, 'Review & Send');

      expect(find.text('Notice sent to 44 recipient(s) — Class 6A · students and parents.'),
          findsOneWidget);
      expect(find.text('No draft yet'), findsOneWidget,
          reason: 'the same notice must not be one tap from going out twice');
    });

    testWidgets('a failed send keeps the approved text so it can be retried',
        (tester) async {
      await _pump(tester, sendFails: true);
      await _fillForm(tester);
      await _tapButton(tester, 'Draft with AI');
      await _tapButton(tester, 'Review & Send');

      expect(find.text(_aiDraft), findsOneWidget,
          reason: 'losing the approved wording on a network blip is unacceptable');
      expect(find.widgetWithText(MButton, 'Review & Send'), findsOneWidget);
    });

    testWidgets('Discard clears the draft without sending', (tester) async {
      final repo = await _pump(tester);
      await _fillForm(tester);
      await _tapButton(tester, 'Draft with AI');

      await _tapButton(tester, 'Discard');

      expect(find.text('No draft yet'), findsOneWidget);
      expect(repo.lastSend, isNull);
    });
  });
}

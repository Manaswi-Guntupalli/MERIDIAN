import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/core/theme/app_theme.dart';
import 'package:meridian_app/features/notifications/data/notifications_repository.dart';
import 'package:meridian_app/features/notifications/presentation/notifications_screen.dart';

/// A school notice runs to several paragraphs. Inline, one of them would push
/// every other alert off the feed, so the row shows a two-line preview and the
/// full text lives on its own page.

const _notice = '''
Dear Students and Parents of Class 6A,

Tomorrow's Chemistry practical has been rescheduled from Period 2 to Period 5.

Students are reminded to bring their lab coat and practical record book.

Sincerely,
Mr. Rao
Teacher''';

final _feed = NotificationFeed(
  unread: 1,
  items: [
    AppNotification(
      id: 'n1',
      title: 'Chemistry practical rescheduled',
      body: _notice,
      read: false,
      createdAt: DateTime.now().subtract(const Duration(minutes: 4)),
      severity: 'INFO',
      category: 'NOTICE',
    ),
    AppNotification(
      id: 'n2',
      title: 'Fee due',
      body: 'Term 2 fee is due on 30 July.',
      read: true,
      createdAt: DateTime.now().subtract(const Duration(hours: 3)),
      severity: 'WARNING',
      category: 'FEES',
    ),
  ],
);

/// Safe to settle fully here: with the feed provided up front there is no
/// spinner, and neither page runs a repeating animation — but a page
/// transition must finish before the route underneath goes offstage.
Future<void> _settle(WidgetTester tester) =>
    tester.pumpAndSettle(const Duration(milliseconds: 50));

Future<void> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [notificationsProvider.overrideWith((ref) async => _feed)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: NotificationsScreen()),
      ),
    ),
  );
  await _settle(tester);
}

/// The rendered line count of the body inside the feed row.
int _bodyLines(WidgetTester tester) {
  final text = tester.widget<Text>(find.text(_notice).first);
  return text.maxLines ?? 1 << 20;
}

void main() {
  testWidgets('the feed shows a preview, not the whole notice', (tester) async {
    await _pump(tester);

    expect(find.text('Chemistry practical rescheduled'), findsOneWidget);
    expect(_bodyLines(tester), 2,
        reason: 'an unclamped notice pushes the rest of the feed off screen');
    expect(find.text('Read'), findsWidgets, reason: 'the row must invite the tap');
  });

  testWidgets('tapping a notification opens it in full', (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Chemistry practical rescheduled'));
    await _settle(tester);

    // On the detail page the body is complete and unclamped.
    expect(find.text('School Notice'), findsOneWidget);
    final body = tester.widget<SelectableText>(find.byType(SelectableText));
    expect(body.data, _notice);
    expect(find.text('Term 2 fee is due on 30 July.'), findsNothing,
        reason: 'the detail page shows one notification, not the feed');
  });

  testWidgets('a non-notice alert opens with a neutral heading', (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Fee due'));
    await _settle(tester);

    expect(find.text('Notification'), findsOneWidget);
    expect(find.text('School Notice'), findsNothing);
  });

  testWidgets('the detail page can be dismissed back to the feed',
      (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Chemistry practical rescheduled'));
    await _settle(tester);

    await tester.tap(find.byTooltip('Back'));
    await _settle(tester);

    expect(find.text('Fee due'), findsOneWidget);
    expect(find.byType(SelectableText), findsNothing);
  });
}

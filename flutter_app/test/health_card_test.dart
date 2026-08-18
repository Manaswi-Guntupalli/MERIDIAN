import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/core/theme/app_theme.dart';
import 'package:meridian_app/features/dashboard/data/intelligence_repository.dart';
import 'package:meridian_app/features/dashboard/presentation/principal_dashboard.dart';

/// School health has exactly one owner: the intelligence engine.
///
/// The server used to publish a second score from different categories and
/// different weights, and the dashboard drew whichever arrived first — so the
/// headline number visibly changed under the reader about a second after the
/// screen opened (82, then 82.2). These tests pin the rule that replaced it:
/// until the engine answers, nothing stands in for its number.

IntelHealth _health({double? overall = 90.7, bool documentsAbstains = true}) =>
    IntelHealth(
      overall: overall,
      method: 'overall = sum(weight x category score) / sum(weights of categories with data)',
      categories: [
        const IntelHealthCategory(name: 'attendance', score: 92.9, weight: 0.35),
        const IntelHealthCategory(name: 'finance', score: 83.5, weight: 0.28),
        const IntelHealthCategory(name: 'timetable', score: 93, weight: 0.20),
        // Too few documents processed to score — the engine abstains.
        IntelHealthCategory(
            name: 'documents', score: documentsAbstains ? null : 27.5, weight: 0.08),
        const IntelHealthCategory(name: 'operations', score: 99.6, weight: 0.09),
      ],
    );

IntelResult _online({double? overall = 90.7}) => IntelResult(
      online: true,
      payload: IntelPayload(
        recommendations: const [],
        insights: const [],
        health: _health(overall: overall),
        anchorDate: '2026-07-28',
        engineVersion: '1.0.0',
        computedAt: DateTime(2026, 7, 28),
      ),
    );

/// Pumps just the health card, with the engine result the test dictates.
/// The score counts into place over one sweep (AppMotion.sweep = 800ms), so a
/// test reading the figure has to let the animation land first.
Future<void> _settleCount(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 900));
  await tester.pump();
}

Future<void> _pump(WidgetTester tester, Future<IntelResult> result) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [intelligenceProvider.overrideWith((ref) => result)],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: SingleChildScrollView(child: HealthCard())),
      ),
    ),
  );
  await tester.pump();
}

/// The rendered score, or null when the card is showing a placeholder.
String? _renderedScore(WidgetTester tester) {
  final texts = tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data)
      .whereType<String>();
  for (final t in texts) {
    if (RegExp(r'^\d+(\.\d+)?$').hasMatch(t)) return t;
  }
  return null;
}

void main() {
  testWidgets('no number is shown while the engine is still computing',
      (tester) async {
    final pending = Completer<IntelResult>();
    await _pump(tester, pending.future);

    expect(_renderedScore(tester), isNull,
        reason: 'a stand-in score is what made the number change under the reader');
    expect(find.text('—'), findsOneWidget);
    expect(find.text('Scoring live school data…'), findsOneWidget);

    pending.complete(_online());
    await tester.pump();
    await _settleCount(tester);
    expect(_renderedScore(tester), '90.7');
  });

  testWidgets('the engine score is rendered exactly, not rounded',
      (tester) async {
    await _pump(tester, Future.value(_online()));
    await _settleCount(tester);

    // 90.7 here and 90.7 in the browser — rounding made the phone read 82
    // where the web read 82.2 for the same school.
    expect(find.text('90.7'), findsOneWidget);
    expect(find.text('91'), findsNothing);
  });

  testWidgets('a category the engine did not score is absent, not drawn at zero',
      (tester) async {
    await _pump(tester, Future.value(_online()));
    await _settleCount(tester);

    expect(find.text('Attendance'), findsOneWidget);
    expect(find.text('Finance'), findsOneWidget);
    expect(find.text('Timetable'), findsOneWidget);
    expect(find.text('Operations'), findsOneWidget);
    expect(find.text('Documents'), findsNothing,
        reason: 'abstaining means "not measured", never "measured as bad"');
    expect(find.text('Weighted across 4 categories by the intelligence engine.'),
        findsOneWidget);
  });

  testWidgets('an unreachable engine says so instead of showing another number',
      (tester) async {
    await _pump(tester,
        Future.value(const IntelResult(online: false, error: 'unreachable')));
    await tester.pump(const Duration(milliseconds: 300));

    expect(_renderedScore(tester), isNull);
    expect(
        find.text('Score unavailable — the intelligence engine is unreachable.'),
        findsOneWidget);
  });

  testWidgets('too little data to score reads as unmeasured, not as zero',
      (tester) async {
    await _pump(tester, Future.value(_online(overall: null)));
    await tester.pump(const Duration(milliseconds: 300));

    expect(_renderedScore(tester), isNull);
    expect(find.text('0'), findsNothing);
    expect(find.text('Not enough recorded data to score the school yet.'),
        findsOneWidget);
  });
}

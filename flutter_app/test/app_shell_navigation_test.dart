import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/core/theme/app_theme.dart';
import 'package:meridian_app/features/auth/domain/app_user.dart';
import 'package:meridian_app/features/auth/presentation/auth_controller.dart';
import 'package:meridian_app/features/shell/presentation/app_shell.dart';

/// The shell presents two different destination lists — a five-slot bottom bar
/// on phones and a full rail on tablets. Selection must survive the switch by
/// identity, not by index: index 4 is "More" on a phone but the fifth real
/// destination on a tablet, so an index-based shell silently changed screens on
/// rotation.

const _principal = AppUser(
  id: 'u1',
  name: 'Dr. Kavita Menon',
  email: 'principal@meridian.school',
  role: UserRole.principal,
  schoolId: 's1',
  schoolName: 'Meridian Public School',
);

/// Phone: 5 tabs. Tablet: rail (the shell switches at 720dp width).
const Size phone = Size(400, 900);
const Size tablet = Size(1000, 800);

Future<void> _pumpShell(WidgetTester tester, {required Size size}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [currentUserProvider.overrideWithValue(_principal)],
      child: MaterialApp(theme: AppTheme.light, home: const AppShell()),
    ),
  );
  await tester.pump();
}

/// Bounded pumps, never `pumpAndSettle`: the shell hosts indefinitely
/// repeating animations (skeleton shimmer, the ambient background crossfade),
/// so waiting for a quiescent frame would hang.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

Future<void> _resize(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  await _settle(tester);
}

/// The label under the currently selected bottom-bar destination.
String? _selectedBottomLabel(WidgetTester tester) {
  final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
  final dest = bar.destinations[bar.selectedIndex] as NavigationDestination;
  return dest.label;
}

String _selectedRailLabel(WidgetTester tester) {
  final rail = tester.widget<NavigationRail>(find.byType(NavigationRail));
  final dest = rail.destinations[rail.selectedIndex!];
  return (dest.label as Text).data!;
}

void main() {
  group('AppShell selection survives a layout switch', () {
    testWidgets('phone shows a bottom bar, tablet shows a rail', (tester) async {
      await _pumpShell(tester, size: phone);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);

      await _resize(tester, tablet);
      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets('a shared destination keeps its selection across rotation',
        (tester) async {
      await _pumpShell(tester, size: phone);

      // Timetable is a real destination in BOTH layouts (index 2 either way).
      await tester.tap(find.text('Timetable'));
      await _settle(tester);
      expect(_selectedBottomLabel(tester), 'Timetable');

      await _resize(tester, tablet);
      expect(_selectedRailLabel(tester), 'Timetable');
    });

    testWidgets('"More" does not become the rail destination at its index',
        (tester) async {
      // The regression: portrait "More" is index 4; the rail's index 4 is
      // Students, so rotating silently opened Students.
      await _pumpShell(tester, size: phone);
      await tester.tap(find.text('More'));
      await _settle(tester);
      expect(_selectedBottomLabel(tester), 'More');

      await _resize(tester, tablet);
      expect(_selectedRailLabel(tester), isNot('Students'));
      // A menu has no rail equivalent, so it falls back to the first
      // destination — predictable, and never a screen the user did not choose.
      expect(_selectedRailLabel(tester), 'Dashboard');
    });

    testWidgets('an overflow destination returns to More on the phone',
        (tester) async {
      // Students exists only in the rail; on a phone it lives inside More, so
      // that is where the selection should land — one tap away, not Dashboard.
      await _pumpShell(tester, size: tablet);
      await tester.tap(find.text('Students'));
      await _settle(tester);
      expect(_selectedRailLabel(tester), 'Students');

      await _resize(tester, phone);
      expect(_selectedBottomLabel(tester), 'More');
    });

    testWidgets('round trip returns to the same destination', (tester) async {
      await _pumpShell(tester, size: phone);
      await tester.tap(find.text('Copilot'));
      await _settle(tester);

      await _resize(tester, tablet);
      expect(_selectedRailLabel(tester), 'Copilot');
      await _resize(tester, phone);
      expect(_selectedBottomLabel(tester), 'Copilot');
    });

    testWidgets('defaults to the first destination before any tap',
        (tester) async {
      await _pumpShell(tester, size: phone);
      expect(_selectedBottomLabel(tester), 'Dashboard');

      await _resize(tester, tablet);
      expect(_selectedRailLabel(tester), 'Dashboard');
    });
  });
}

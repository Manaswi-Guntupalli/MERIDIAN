import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/main.dart';

void main() {
  testWidgets('App boots into the splash while restoring the session',
      (tester) async {
    await tester.pumpWidget(const ProviderScope(child: MeridianApp()));
    await tester.pump();

    // Before any network resolves, the splash brand mark is shown.
    expect(find.text('MERIDIAN'), findsOneWidget);
  });
}

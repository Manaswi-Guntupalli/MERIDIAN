import 'package:flutter_test/flutter_test.dart';
import 'package:meridian_app/core/util/format.dart';

void main() {
  group('scoreLabel matches how the web prints a score', () {
    test('a one-decimal score keeps its decimal', () {
      // The engine's health score. The browser shows 82.2; so must the phone.
      expect(scoreLabel(82.2), '82.2');
      expect(scoreLabel(93.5), '93.5');
    });

    test('a whole number drops the decimal, as JavaScript does', () {
      // Dart's toString() would give "82.0" here — the web never shows that.
      expect(scoreLabel(82.0), '82');
      expect(scoreLabel(100.0), '100');
      expect(scoreLabel(0.0), '0');
    });

    test('an int is printed unchanged', () {
      // The offline fallback path passes the server's already-rounded int.
      expect(scoreLabel(82), '82');
      expect(scoreLabel(100), '100');
    });

    test('trailing-zero decimals collapse', () {
      expect(scoreLabel(93.0), '93');
    });

    test('the engine emits at most one decimal, so values are stable', () {
      expect(scoreLabel(82.24), '82.2');
      expect(scoreLabel(82.25), '82.3');
    });

    test('the full 0-100 range renders without artefacts', () {
      for (var i = 0; i <= 1000; i++) {
        final label = scoreLabel(i / 10);
        expect(label.contains('e'), isFalse, reason: '$label used exponent form');
        expect(label.endsWith('.0'), isFalse, reason: '$label kept a bare .0');
      }
    });
  });

  group('initials skips honorifics', () {
    test('a titled name uses the person, not the title', () {
      expect(initials('Dr. Kavita Menon'), 'KM');
      expect(firstName('Dr. Kavita Menon'), 'Kavita');
    });

    test('an untitled name is unchanged', () {
      expect(initials('Rahul Deshpande'), 'RD');
      expect(firstName('Rahul Deshpande'), 'Rahul');
    });

    test('a title alone still renders something', () {
      expect(initials('Dr.'), 'D');
    });

    test('an empty name does not crash', () {
      expect(initials(''), '?');
    });
  });
}

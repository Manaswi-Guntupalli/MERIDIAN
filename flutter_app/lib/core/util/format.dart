import 'package:intl/intl.dart';

/// Indian-format rupees with no paise — mirrors the web's `inr()`.
final NumberFormat _inr =
    NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
String inr(num value) => _inr.format(value);

/// A 0-100 score written the way the web writes it.
///
/// `HealthGauge` renders the engine's value verbatim, and JavaScript prints
/// 82.2 as "82.2" but 82.0 as "82". Dart's `toString()` would give "82.0", so
/// a whole number drops its decimal here — otherwise the same school reads
/// differently on the two surfaces.
String scoreLabel(num value) {
  final rounded = (value * 10).round() / 10; // the engine emits at most 1dp
  return rounded == rounded.roundToDouble()
      ? rounded.toInt().toString()
      : rounded.toString();
}

/// Compact "time ago" — mirrors the web's `timeAgo`.
String timeAgo(DateTime? d) {
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inSeconds < 45) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  if (diff.inDays < 30) return '${(diff.inDays / 7).floor()}w ago';
  return '${(diff.inDays / 30).floor()}mo ago';
}

// Titles that are not the person's name. Kept in sync with the web's
// `HONORIFICS` in client/src/lib/utils.ts so both surfaces greet and abbreviate
// a given user identically.
const _honorifics = {
  'dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'miss', 'sir',
  'madam', 'rev', 'fr', 'capt', 'col', 'lt', 'sgt',
};

/// The name split into parts, with a leading honorific dropped — but only when
/// it isn't the whole name, so "Dr." alone still renders as something.
List<String> _nameParts(String name) {
  final parts =
      name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.length > 1 &&
      _honorifics.contains(
          parts.first.replaceAll(RegExp(r'\.$'), '').toLowerCase())) {
    return parts.sublist(1);
  }
  return parts;
}

/// The person's given name, skipping any honorific
/// ("Dr. Kavita Menon" → "Kavita"). Greeting on the first token instead
/// produced "Good afternoon, Dr.." — a title and two full stops.
String firstName(String name) {
  final parts = _nameParts(name);
  return parts.isEmpty ? name : parts.first;
}

/// Up to two initials from the name proper, e.g. "Dr. Kavita Menon" → "KM".
String initials(String name) {
  final letters = _nameParts(name)
      .map((p) => p[0])
      .take(2)
      .join()
      .toUpperCase();
  return letters.isEmpty ? '?' : letters;
}

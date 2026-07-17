// Lumen — normalisation and OCR repair.
//
// OCR errors are not random noise; they are *systematic* confusions between
// glyphs that look alike. And crucially, we usually know what kind of value we
// are looking at. That context is the whole trick:
//
//   In a phone number, "O" is certainly a zero.
//   In a surname,      "0" is certainly an "O".
//
// The same character, opposite corrections, decided by the field's declared
// type. A general-purpose spellchecker cannot do this, which is why type-aware
// repair beats raw engine accuracy on exactly the fields schools care about.
//
// Every repair is reported (`corrected` + `note`) rather than applied silently.
// A system that quietly rewrites a child's name has not earned trust, however
// good its guess was.

import { similarity as similarityLocal } from './text.js';
import type { FieldSpec } from './types.js';

export interface NormalizeResult {
  value: string;
  corrected: boolean;
  /** Human-readable description of what we changed, for the audit trail. */
  note?: string;
  /** Set when the raw text is genuinely ambiguous (e.g. 03/04 as a date). */
  ambiguous?: boolean;
}

const pass = (value: string): NormalizeResult => ({ value, corrected: false });

/** Glyphs OCR mistakes for digits, in contexts where only digits are legal. */
const TO_DIGIT: Record<string, string> = {
  O: '0', o: '0', D: '0', Q: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  E: '3',
  A: '4',
  S: '5', s: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
};

/** …and the reverse, for contexts where only letters are legal. */
const TO_LETTER: Record<string, string> = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B',
};

function digitsOnly(s: string): { out: string; fixed: number } {
  let out = '';
  let fixed = 0;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (TO_DIGIT[ch]) {
      out += TO_DIGIT[ch];
      fixed++;
    }
  }
  return { out, fixed };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      // Keep initials as initials: "r." not "R".
      if (/^[a-z]\.$/.test(w)) return w.toUpperCase();
      // Honour Irish/Scottish and Indian compound surnames.
      if (/^(mc|mac|o')/.test(w) && w.length > 3) {
        const cut = w.startsWith("o'") ? 2 : w.startsWith('mac') ? 3 : 2;
        return w.slice(0, cut).replace(/^./, (c) => c.toUpperCase()) + w.charAt(cut).toUpperCase() + w.slice(cut + 1);
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

// ─────────────────────────────  names  ─────────────────────────────

const NAME_TITLES = /^(mr|mrs|ms|miss|dr|shri|smt|sri|prof)\.?\s+/i;

export function normalizeName(raw: string): NormalizeResult {
  let v = raw.trim();
  let corrected = false;
  const notes: string[] = [];

  // Names never contain digits — any digit here is a misread letter.
  if (/\d/.test(v)) {
    const before = v;
    v = v.replace(/\d/g, (d) => TO_LETTER[d] ?? '');
    if (v !== before) {
      corrected = true;
      notes.push('repaired digits misread as letters');
    }
  }

  v = v.replace(/[^A-Za-z.'\- ]/g, ' ').replace(/\s+/g, ' ').trim();

  const withoutTitle = v.replace(NAME_TITLES, '');
  if (withoutTitle !== v) {
    v = withoutTitle;
    corrected = true;
    notes.push('removed honorific');
  }

  const cased = titleCase(v);
  if (cased !== v) {
    // ALL-CAPS forms are the norm on Indian school paperwork; recasing them is
    // a presentation fix, not a correction, so it doesn't count as a repair.
    v = cased;
  }

  return { value: v, corrected, note: notes.length ? notes.join('; ') : undefined };
}

// ─────────────────────────────  dates  ─────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31 February and friends — Date rolls them over, so a round-trip
  // mismatch means the components were never a real calendar date.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function expandYear(y: number): number {
  if (y >= 1000) return y;
  // Two-digit years on school forms: 26 -> 2026, 89 -> 1989.
  const currentShort = new Date().getFullYear() % 100;
  return y <= currentShort + 5 ? 2000 + y : 1900 + y;
}

/**
 * Parse the date formats that actually appear on Indian school paperwork.
 *
 * The hard case is 03/04/2011. Day-first and month-first are both plausible and
 * both produce a valid date, so no amount of parsing can resolve it. We assume
 * day-first (the Indian convention) but flag `ambiguous`, which knocks the
 * field's confidence down and routes it to a human. Silently picking one and
 * reporting 95% confidence would be the dishonest option.
 */
export function normalizeDate(raw: string): NormalizeResult {
  const cleaned = raw.trim().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned) return pass('');

  // Repair digit-shaped letters, but only inside numeric runs.
  let v = cleaned.replace(/\b[\dOolIiSsBZzGqg]{1,4}\b/g, (tok) => {
    if (/^\d+$/.test(tok)) return tok;
    if (/[A-Za-z]/.test(tok) && /\d/.test(tok)) return digitsOnly(tok).out || tok;
    return tok;
  });
  const corrected = v !== cleaned;

  // OCR loves to insert a space mid-number: "1 2/08/2011".
  v = v.replace(/(\d)\s+(\d)/g, '$1$2');

  // 12 Aug 2011 · Aug 12 2011 · 12-Aug-2011
  const named = v.match(/(\d{1,2})[\s\-/]*([A-Za-z]{3,9})[\s\-/]*(\d{2,4})/);
  if (named && MONTHS[named[2].toLowerCase()]) {
    const out = iso(expandYear(Number(named[3])), MONTHS[named[2].toLowerCase()], Number(named[1]));
    if (out) return { value: out, corrected, note: corrected ? 'repaired misread digits' : undefined };
  }
  const namedFirst = v.match(/([A-Za-z]{3,9})[\s\-/]*(\d{1,2})[\s\-/]*(\d{2,4})/);
  if (namedFirst && MONTHS[namedFirst[1].toLowerCase()]) {
    const out = iso(expandYear(Number(namedFirst[3])), MONTHS[namedFirst[1].toLowerCase()], Number(namedFirst[2]));
    if (out) return { value: out, corrected, note: corrected ? 'repaired misread digits' : undefined };
  }

  // yyyy-mm-dd — unambiguous by construction.
  const isoLike = v.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoLike) {
    const out = iso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));
    if (out) return { value: out, corrected };
  }

  // An unbroken 8-digit run is ddmmyyyy — either printed without separators or
  // OCR dropped the slashes. Only exactly 8 digits qualifies; anything longer
  // has extra garbage in it and guessing an alignment would fabricate a date.
  const solid = v.match(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/);
  if (solid) {
    const out = iso(Number(solid[3]), Number(solid[2]), Number(solid[1]));
    if (out) return { value: out, corrected: true, note: 'read as ddmmyyyy (separators missing)' };
  }

  // dd/mm/yyyy or mm/dd/yyyy.
  const numeric = v.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = expandYear(Number(numeric[3]));

    if (a > 12 && b <= 12) {
      const out = iso(y, b, a); // must be dd/mm
      if (out) return { value: out, corrected };
    }
    if (b > 12 && a <= 12) {
      const out = iso(y, a, b); // must be mm/dd
      if (out) return { value: out, corrected, note: 'read as month-first (day > 12)' };
    }
    // Genuinely ambiguous — assume day-first, but say so.
    const dayFirst = iso(y, b, a);
    if (dayFirst) {
      return {
        value: dayFirst,
        corrected,
        ambiguous: a !== b,
        note: a !== b ? `ambiguous: ${a}/${b} could also be ${b}/${a}` : undefined,
      };
    }
  }

  return { value: cleaned, corrected: false, note: 'could not be parsed as a date' };
}

// ─────────────────────────  phone / email  ─────────────────────────

export function normalizePhone(raw: string): NormalizeResult {
  const { out, fixed } = digitsOnly(raw);
  let d = out;
  const notes: string[] = [];
  if (fixed) notes.push(`repaired ${fixed} misread digit${fixed > 1 ? 's' : ''}`);

  // Strip the country/trunk prefixes Indian forms use interchangeably.
  if (d.length === 12 && d.startsWith('91')) {
    d = d.slice(2);
    notes.push('removed +91 prefix');
  } else if (d.length === 13 && d.startsWith('091')) {
    d = d.slice(3);
    notes.push('removed 0-91 prefix');
  } else if (d.length === 11 && d.startsWith('0')) {
    d = d.slice(1);
    notes.push('removed trunk 0');
  }

  if (d.length === 10) {
    return { value: `+91 ${d}`, corrected: notes.length > 0, note: notes.join('; ') || undefined };
  }

  // On a noisy read the value drags in neighbouring digits (a date, a form
  // number) and "all the digits" becomes a 20-character monster. If a single
  // valid mobile shape is embedded in the run, that is the phone number; if
  // several are, choosing one would be a guess, so we decline.
  if (d.length > 10) {
    const windows = new Set<string>();
    for (let i = 0; i + 10 <= d.length; i++) {
      const win = d.slice(i, i + 10);
      if (/^[6-9]/.test(win)) windows.add(win);
    }
    if (windows.size === 1) {
      const [win] = windows;
      notes.push('isolated the 10-digit mobile from surrounding digits');
      return { value: `+91 ${win}`, corrected: true, note: notes.join('; ') };
    }
  }

  // Not a recognisable Indian mobile — hand back the digits and let the
  // validator complain, rather than inventing a shape it doesn't have.
  return { value: d || raw.trim(), corrected: fixed > 0, note: notes.join('; ') || undefined };
}

export function normalizeEmail(raw: string): NormalizeResult {
  const before = raw.trim();
  let v = before;
  const notes: string[] = [];

  // OCR sprays spaces around punctuation: "aarav.s@ meridian.school".
  const despaced = v.replace(/\s+/g, '');
  if (despaced !== v) {
    v = despaced;
    notes.push('removed spurious spaces');
  }

  // Forms are sometimes typed with the word instead of the glyph.
  v = v.replace(/\(at\)|\[at\]|\sat\s/gi, '@').replace(/\(dot\)|\[dot\]/gi, '.');

  v = v.toLowerCase();

  // A comma next to a dot's position is nearly always a misread period.
  v = v.replace(/,/g, '.');
  // Collapse doubled separators left behind by the repairs above.
  v = v.replace(/\.{2,}/g, '.').replace(/@{2,}/g, '@').replace(/^[.@]+|[.@]+$/g, '');

  // A lost @ sign. On photographed forms the @ glyph frequently dies into a
  // 'd', 'a', 'q' or 'g' ("krishnan@gmail" → "krishnandgmail"). We only dare
  // reconstruct it when a known provider domain is clearly visible in the
  // tail AND the character in front of it is one of those @-shaped misreads —
  // both conditions together make the reading essentially unambiguous.
  if (!v.includes('@') && v.length >= 8) {
    const PROVIDERS = ['gmail.com', 'gmail', 'yahoo.co.in', 'yahoo.com', 'yahoo', 'outlook.com', 'outlook', 'hotmail.com', 'hotmail', 'rediffmail.com', 'rediffmail', 'icloud.com', 'icloud'];
    outer: for (const provider of PROVIDERS) {
      // Search the tail of the string for a close occurrence of the provider.
      for (let i = Math.max(1, v.length - provider.length - 8); i + provider.length <= v.length; i++) {
        const window = v.slice(i, i + provider.length);
        if (similarityLocal(window, provider) >= 0.85 && /[daqgo0&]/.test(v[i - 1])) {
          v = v.slice(0, i - 1) + '@' + v.slice(i);
          notes.push('reconstructed a lost @ before a known provider');
          break outer;
        }
      }
    }
  }

  // Domain snapping. The local part of an email is a name — unguessable, so
  // we never touch it. The domain is different: a handful of providers cover
  // the overwhelming majority of Indian school paperwork, and "gmali.corn" has
  // exactly one plausible reading. Snap only on a close match to that short
  // list; an unfamiliar domain (a school's own, a company's) passes untouched.
  const at = v.lastIndexOf('@');
  if (at > 0 && at < v.length - 3) {
    const domain = v.slice(at + 1);
    const KNOWN = ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com'];
    if (!KNOWN.includes(domain)) {
      let bestDomain = '';
      let bestSim = 0;
      for (const known of KNOWN) {
        const sim = similarityLocal(domain, known);
        if (sim > bestSim) {
          bestSim = sim;
          bestDomain = known;
        }
      }
      if (bestSim >= 0.82) {
        v = v.slice(0, at + 1) + bestDomain;
        notes.push(`repaired domain "${domain}" → "${bestDomain}"`);
      }
    }
  }

  const corrected = v !== before.toLowerCase();
  if (corrected && !notes.length) notes.push('normalised punctuation');
  return { value: v, corrected, note: notes.join('; ') || undefined };
}

// ────────────────────────────  numbers  ────────────────────────────

export function normalizeMoney(raw: string): NormalizeResult {
  const before = raw.trim();
  // Drop currency marks and thousands separators, keep the decimal point.
  const stripped = before.replace(/[₹$€£]|rs\.?|inr/gi, '').replace(/,/g, '').trim();
  const { out } = digitsOnly(stripped.replace(/\./g, '#'));
  const withDot = out && stripped.includes('.') ? stripped.replace(/[^\d.]/g, '') : out;
  const n = Number(withDot);
  if (!withDot || Number.isNaN(n)) return { value: before, corrected: false, note: 'not a readable amount' };
  const value = String(Math.round(n * 100) / 100);
  return { value, corrected: value !== before, note: value !== before ? 'stripped currency formatting' : undefined };
}

export function normalizeNumber(raw: string, decimal: boolean): NormalizeResult {
  const before = raw.trim();
  const m = before.match(/-?[\d.,OolIiSsBZzGqg]+/);
  if (!m) return { value: before, corrected: false, note: 'no number found' };
  const cleaned = m[0].replace(/,/g, '');
  const { out, fixed } = digitsOnly(decimal ? cleaned.replace(/\./g, '') : cleaned);
  if (!out) return { value: before, corrected: false, note: 'no number found' };

  let value: string;
  if (decimal && cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const ip = digitsOnly(parts[0]).out || '0';
    const fp = digitsOnly(parts[1] ?? '').out;
    value = fp ? `${Number(ip)}.${fp}` : String(Number(ip));
  } else {
    value = String(Number(out));
  }
  return {
    value,
    corrected: fixed > 0 || value !== before,
    note: fixed ? `repaired ${fixed} misread digit${fixed > 1 ? 's' : ''}` : undefined,
  };
}

export function normalizePercentage(raw: string): NormalizeResult {
  const r = normalizeNumber(raw.replace('%', ''), true);
  if (r.value === '') return r;
  const n = Number(r.value);
  if (Number.isNaN(n)) return { value: raw.trim(), corrected: false, note: 'not a readable percentage' };
  return { ...r, value: String(Math.round(n * 100) / 100) };
}

export function normalizePincode(raw: string): NormalizeResult {
  const { out, fixed } = digitsOnly(raw);
  // Same containment logic as phones: a PIN is exactly one 6-digit shape not
  // starting with 0. If the read dragged in extra digits, extract the shape
  // only when it is unambiguous.
  if (out.length > 6) {
    const windows = new Set<string>();
    for (let i = 0; i + 6 <= out.length; i++) {
      const win = out.slice(i, i + 6);
      if (/^[1-9]/.test(win)) windows.add(win);
    }
    if (windows.size === 1) {
      const [win] = windows;
      return { value: win, corrected: true, note: 'isolated the 6-digit PIN from surrounding digits' };
    }
    // Many candidates: return the over-long junk so the validator flags it
    // loudly instead of us silently picking a wrong-but-valid-looking PIN.
  }
  return {
    value: out,
    corrected: fixed > 0,
    note: fixed ? `repaired ${fixed} misread digit${fixed > 1 ? 's' : ''}` : undefined,
  };
}

// ───────────────────────────  categorical  ──────────────────────────

export function normalizeBloodGroup(raw: string): NormalizeResult {
  const before = raw.trim();
  // Accept "B +ve", "Bpositive", "0+" (zero misread for O), "AB Negative".
  let v = before.toUpperCase().replace(/\s+/g, '');
  const notes: string[] = [];

  if (v.startsWith('0')) {
    v = 'O' + v.slice(1);
    notes.push('read 0 as blood group O');
  }
  v = v.replace(/POSITIVE|POS|PVE|VE\+/g, '+').replace(/NEGATIVE|NEG|NVE/g, '-');
  v = v.replace(/[^ABO+-]/g, '');

  const m = v.match(/^(AB|A|B|O)\s*([+-])?/);
  if (!m) return { value: before, corrected: false, note: 'not a recognisable blood group' };
  const group = m[1];
  const sign = m[2] ?? '';
  const value = sign ? `${group}${sign}` : group;
  if (!sign) notes.push('rhesus factor missing');
  return { value, corrected: value !== before, note: notes.join('; ') || undefined };
}

export function normalizeGender(raw: string): NormalizeResult {
  const before = raw.trim();
  const v = before.toLowerCase().replace(/[^a-z]/g, '');
  if (!v) return pass(before);
  if (/^m(ale)?$/.test(v) || v === 'boy') return { value: 'Male', corrected: before !== 'Male' };
  if (/^f(emale)?$/.test(v) || v === 'girl') return { value: 'Female', corrected: before !== 'Female' };
  if (/^(o|other|others|transgender|nonbinary)$/.test(v)) return { value: 'Other', corrected: before !== 'Other' };
  return { value: before, corrected: false, note: 'unrecognised gender value' };
}

// ────────────────────────────  address  ────────────────────────────

const ADDRESS_EXPANSIONS: [RegExp, string][] = [
  [/\brd\b\.?/gi, 'Road'],
  [/\bst\b\.?/gi, 'Street'],
  [/\bave\b\.?/gi, 'Avenue'],
  [/\blne?\b\.?/gi, 'Lane'],
  [/\bnr\b\.?/gi, 'Near'],
  [/\bopp\b\.?/gi, 'Opposite'],
  [/\bapt\b\.?/gi, 'Apartment'],
  [/\bblk\b\.?/gi, 'Block'],
  [/\bsec\b\.?/gi, 'Sector'],
  [/\bcolo?n?y?\b\.?/gi, 'Colony'],
];

export function normalizeAddress(raw: string): NormalizeResult {
  const before = raw.trim();
  let v = before.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,{2,}/g, ',').trim();
  const notes: string[] = [];

  // Only recase if the source is shouting or whispering — respect deliberate
  // mixed case, which is usually a human typing it correctly.
  const isUniformCase = v === v.toUpperCase() || v === v.toLowerCase();
  if (isUniformCase && v.length > 3) {
    v = titleCase(v)
      // Keep PIN codes and house numbers as-is after title casing.
      .replace(/\b(\d+)([a-z])\b/gi, (_m, d, s) => d + s.toUpperCase());
  }

  const expanded = ADDRESS_EXPANSIONS.reduce((acc, [re, full]) => acc.replace(re, full), v);
  if (expanded !== v) {
    v = expanded;
    notes.push('expanded abbreviations');
  }

  v = v.replace(/\s+/g, ' ').replace(/\s,/g, ',').trim().replace(/[,;]$/, '');
  return { value: v, corrected: v !== before, note: notes.join('; ') || undefined };
}

export function normalizeId(raw: string): NormalizeResult {
  // IDs mix letters and digits by design (ADM-2026-014), so we must not apply
  // either repair table — we'd corrupt legitimate values. Only tidy the shape.
  const before = raw.trim();
  const v = before.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9\-/]/g, '');
  return { value: v, corrected: v !== before, note: v !== before ? 'removed stray characters' : undefined };
}

// ────────────────────────────  dispatch  ───────────────────────────

/** Route a raw read to the repair strategy its declared type calls for. */
export function normalizeField(raw: string, spec: FieldSpec): NormalizeResult {
  const value = raw.trim();
  if (!value) return pass('');

  switch (spec.type) {
    case 'name':
      return normalizeName(value);
    case 'date':
      return normalizeDate(value);
    case 'email':
      return normalizeEmail(value);
    case 'phone':
      return normalizePhone(value);
    case 'money':
      return normalizeMoney(value);
    case 'integer':
      return normalizeNumber(value, false);
    case 'decimal':
      return normalizeNumber(value, true);
    case 'percentage':
      return normalizePercentage(value);
    case 'pincode':
      return normalizePincode(value);
    case 'bloodGroup':
      return normalizeBloodGroup(value);
    case 'gender':
      return normalizeGender(value);
    case 'address':
      return normalizeAddress(value);
    case 'id':
      return normalizeId(value);
    case 'checkbox':
    case 'signature':
    case 'text':
    default: {
      const v = value.replace(/\s+/g, ' ').trim();
      // Snap to the closest allowed option when the field is a fixed set.
      if (spec.options?.length) {
        const hit = spec.options.find((o) => o.toLowerCase() === v.toLowerCase());
        if (hit) return { value: hit, corrected: hit !== value };
      }
      return { value: v, corrected: v !== value };
    }
  }
}

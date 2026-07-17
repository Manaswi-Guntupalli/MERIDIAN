// Lumen — text geometry + OCR-aware string matching.
//
// Two problems this module solves:
//
// 1. OCR gives us a bag of positioned words, not lines. Newlines in the raw
//    text are the engine's guess; the *geometry* is the truth. So we rebuild
//    lines by vertical overlap, which survives multi-column layouts and skew.
//
// 2. A scan of "Student Name" may come back as "Studenl Narne". Exact matching
//    would miss it, and plain Levenshtein treats l→t as an equally-bad error as
//    l→q. But OCR errors are not random: they are confusions between glyphs
//    that *look alike*. So we make those substitutions cheap and everything
//    else expensive. That single change is what lets label anchors survive real
//    scans without hand-tuning a threshold per document.

import type { Line, Word } from './types.js';

/** Glyph pairs OCR genuinely confuses. Cost 0.25 instead of 1.0. */
const CONFUSIONS: [string, string][] = [
  ['0', 'o'], ['0', 'd'], ['0', 'q'], ['1', 'l'], ['1', 'i'], ['1', 'j'],
  ['2', 'z'], ['5', 's'], ['6', 'b'], ['8', 'b'], ['9', 'g'], ['9', 'q'],
  ['c', 'e'], ['c', 'o'], ['d', 'cl'], ['f', 't'], ['g', 'q'], ['h', 'b'],
  ['i', 'j'], ['i', 'l'], ['m', 'rn'], ['n', 'r'], ['u', 'v'], ['v', 'y'],
  ['w', 'vv'], ['t', 'f'], ['a', 'o'], ['e', 'a'], ['s', 'z'], ['b', 'h'],
];

const confusionCost = new Map<string, number>();
for (const [a, b] of CONFUSIONS) {
  if (a.length === 1 && b.length === 1) {
    confusionCost.set(a + b, 0.25);
    confusionCost.set(b + a, 0.25);
  }
}

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  return confusionCost.get(a + b) ?? 1;
}

/** Lowercase, strip punctuation/accents, collapse whitespace. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@.\-/+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein distance where visually-confusable glyph swaps are cheap.
 * Returns a fractional distance (confusions contribute 0.25 each).
 */
export function ocrDistance(a: string, b: string): number {
  const s = norm(a);
  const t = norm(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let prev = new Array<number>(t.length + 1);
  let curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + subCost(s[i - 1], t[j - 1]), // substitution
      );
      // Transposition (OCR/typing swap): "Nmae" -> "Name"
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        curr[j] = Math.min(curr[j], prev[j - 1] - 1 + 0.5);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/** 0..1 similarity. 1 = identical. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(norm(a).length, norm(b).length);
  if (longest === 0) return 1;
  return Math.max(0, 1 - ocrDistance(a, b) / longest);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Cluster words into visual lines by vertical overlap.
 *
 * The band a word must overlap is the *median* extent of the row's members,
 * not their min/max envelope. That distinction is what stops transitive
 * chaining: a page decoration (a photo box's caption, a marginal stamp)
 * whose text sits vertically *between* two rows would otherwise join one row,
 * stretch its envelope toward the next row, and pull the two rows into a
 * single line — after which every label/value relationship on them is
 * garbage. With a median band, one interloper cannot drag the row's
 * boundaries anywhere.
 *
 * Membership needs ≥50% overlap of the smaller height, so mixed font sizes —
 * a 20pt heading beside 9pt body text — still separate cleanly.
 */
export function buildLines(words: Word[]): Line[] {
  let usable = words.filter((w) => w.text.trim().length > 0);
  if (!usable.length) return [];

  // Discard vertical-outlier boxes before clustering. On rough scans the
  // engine emits "words" for table borders and ink blobs whose boxes span
  // many text rows; such a box vertically overlaps *every* row it crosses,
  // so it stitches unrelated rows into one line and the page's geometry
  // collapses (observed: 99 words reduced to 17 salad lines). Real text is
  // never 3× the page's median glyph height — titles top out around 2.5× —
  // so the cut removes only artifacts.
  const sortedH = usable.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medH = Math.max(6, sortedH[sortedH.length >> 1]);
  const filtered = usable.filter((w) => w.y1 - w.y0 <= medH * 3);
  if (filtered.length >= usable.length * 0.5) usable = filtered;

  const sorted = [...usable].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: { words: Word[]; y0s: number[]; y1s: number[] }[] = [];

  for (const w of sorted) {
    let joined = false;
    // Only recent rows can still be joined — input is y-sorted, so anything
    // further back is physically above this word.
    for (let r = rows.length - 1; r >= Math.max(0, rows.length - 4); r--) {
      const row = rows[r];
      const bandY0 = median(row.y0s);
      const bandY1 = median(row.y1s);
      const overlap = Math.min(w.y1, bandY1) - Math.max(w.y0, bandY0);
      const minH = Math.max(1, Math.min(w.y1 - w.y0, bandY1 - bandY0));
      if (overlap / minH >= 0.5) {
        row.words.push(w);
        row.y0s.push(w.y0);
        row.y1s.push(w.y1);
        joined = true;
        break;
      }
    }
    if (!joined) rows.push({ words: [w], y0s: [w.y0], y1s: [w.y1] });
  }

  return rows
    .map((row) => {
      const ws = row.words.sort((a, b) => a.x0 - b.x0);
      return {
        words: ws,
        text: ws.map((w) => w.text).join(' '),
        x0: Math.min(...ws.map((w) => w.x0)),
        y0: Math.min(...ws.map((w) => w.y0)),
        x1: Math.max(...ws.map((w) => w.x1)),
        y1: Math.max(...ws.map((w) => w.y1)),
        conf: ws.reduce((a, w) => a + w.conf, 0) / ws.length,
      };
    })
    .sort((a, b) => a.y0 - b.y0);
}

/** Bounding box that encloses every given word. */
export function bboxOf(words: Word[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...words.map((w) => w.x0)),
    y0: Math.min(...words.map((w) => w.y0)),
    x1: Math.max(...words.map((w) => w.x1)),
    y1: Math.max(...words.map((w) => w.y1)),
  };
}

/**
 * Find where `phrase` occurs inside a line's word array, OCR-tolerantly.
 * Returns the matched word span and how good the match was, or null.
 *
 * Real forms print labels as "Student Name", "Student's Name :", "Name of
 * Student" — so we slide a window sized to the phrase across the line rather
 * than requiring token-for-token equality.
 */
export function findPhrase(
  line: Line,
  phrase: string,
  minScore = 0.72,
): { start: number; end: number; score: number } | null {
  const target = norm(phrase);
  if (!target) return null;
  const tokenCount = target.split(' ').length;
  let best: { start: number; end: number; score: number } | null = null;

  // Allow the window to run a token short/long — OCR splits and merges words.
  for (let start = 0; start < line.words.length; start++) {
    for (let len = Math.max(1, tokenCount - 1); len <= tokenCount + 1; len++) {
      const end = start + len;
      if (end > line.words.length) break;
      const candidate = line.words
        .slice(start, end)
        .map((w) => w.text)
        .join(' ');
      // Labels are usually followed by a colon; ignore it when scoring.
      const score = similarity(candidate.replace(/[:.–-]+\s*$/, ''), target);
      if (score >= minScore && (!best || score > best.score)) best = { start, end, score };
    }
  }
  return best;
}

/** Strip the leading separator a label leaves behind (":", "-", "."). */
export function stripSeparators(s: string): string {
  return s.replace(/^[\s:.–—_-]+/, '').replace(/[\s_.]+$/, '').trim();
}

/**
 * Dotted/underscored fill lines ("Name: ______") read back as junk. A value
 * that is only rule characters is really an empty field, and saying so is more
 * useful than surfacing "___" as if it were a name.
 */
export function isFillerOnly(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /^[_.\-–—…\s|:]+$/.test(t);
}

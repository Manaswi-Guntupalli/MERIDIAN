// Lumen — field extraction.
//
// The strategy is the one a human uses: find the printed label, then read what
// sits next to it. Never "the value is 40% down the page" — that shatters the
// first time a school changes its letterhead.
//
// The subtlety that makes or breaks this is knowing where a value *ends*. On a
// line reading
//
//     Class: 8    Section: A    Gender: Male
//
// naive "read everything after the label" gives Class = "8 Section: A Gender:
// Male". So before extracting anything we locate *every* field's label on every
// line, and then each value is bounded by the next label along. Fields defend
// each other's boundaries — which is why extraction gets more accurate as a
// template describes more of the form, not less.

import { bboxOf, findPhrase, isFillerOnly, norm, similarity, stripSeparators } from './text.js';
import { normalizeField } from './normalize.js';
import { validateField } from './validate.js';
import { scoreField, statusFor } from './confidence.js';
import type { DocTemplate, ExtractedValue, FieldSpec, Line, PageResult, Word } from './types.js';

/** Where a field's label was found on the page. */
interface LabelHit {
  key: string;
  spec: FieldSpec;
  pageIndex: number;
  line: Line;
  /** Word indices within the line: [start, end). */
  start: number;
  end: number;
  score: number;
  anchor: string;
}

const MIN_ANCHOR_SCORE = 0.74;

/**
 * On a degraded page the *labels* are degraded too — "Student Name" arrives as
 * "Vndert Gane" — so a threshold tuned for clean scans finds nothing at all.
 * Relaxing it per-page trades a little precision for recall exactly where
 * recall is the bottleneck; the weak label score still flows into the field's
 * confidence, so anything found this way is review-routed, never silently
 * trusted.
 */
function anchorThresholdFor(page: PageResult): number {
  if (page.source === 'TEXT_LAYER') return MIN_ANCHOR_SCORE;
  if (page.quality.verdict === 'POOR' || page.ocrConfidence < 0.55) return 0.58;
  if (page.quality.verdict === 'FAIR' || page.ocrConfidence < 0.72) return 0.66;
  return MIN_ANCHOR_SCORE;
}

/** Patterns strong enough to identify a value with no label in sight. */
const PATTERNS: Partial<Record<FieldSpec['type'], RegExp>> = {
  email: /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  // Ten digits starting 6-9, tolerating a separator after ANY digit — OCR
  // scatters spaces unpredictably ("98201 1 4455"), so demanding one tidy
  // 5+5 split (an earlier version) missed real numbers on noisy scans.
  phone: /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/,
  pincode: /\b[1-9]\d{5}\b/,
  date: /\b\d{1,2}\s?[-/.]\s?\d{1,2}\s?[-/.]\s?\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/,
  bloodGroup: /\b(?:AB|A|B|O)\s?[+-](?:ve)?\b/i,
};

/**
 * Find every field label on every line, once.
 *
 * We keep only the best-scoring claim on any overlapping span: "Father's Name"
 * and "Name" both match the same words, and the longer, more specific anchor is
 * the right winner. Without this, generic anchors cannibalise specific ones.
 */
function locateLabels(template: DocTemplate, pages: PageResult[]): LabelHit[] {
  const hits: LabelHit[] = [];

  for (const page of pages) {
    const anchorMin = anchorThresholdFor(page);
    // Median word height — the page's body-text size. Titles run much bigger.
    // Measured over words that look like actual text: a noisy binarised scan
    // is littered with one-character specks, and letting them into the median
    // shrinks it until every real line reads as "title-sized" and gets held
    // to the near-exact bar — which silently turns off label matching on
    // precisely the pages that need the relaxed threshold most.
    const heights = page.words
      .filter((w) => /[a-z0-9]{2,}/i.test(w.text))
      .map((w) => w.y1 - w.y0)
      .sort((a, b) => a - b);
    const medianH = heights.length ? heights[heights.length >> 1] : 12;

    for (const line of page.lines) {
      // Big text is a title, not a label. On a noisy page the relaxed anchor
      // threshold would happily read "TEACHER REG" as "Teacher Name" and
      // extract "ISTRATION FORM" as the applicant — so headline-sized lines
      // must clear a near-exact bar before they may claim a field.
      const lineH = line.y1 - line.y0;
      const lineMin = lineH > medianH * 1.55 ? Math.max(anchorMin, 0.88) : anchorMin;

      const lineHits: LabelHit[] = [];
      for (const spec of template.fields) {
        let best: LabelHit | null = null;
        for (const anchor of spec.anchors) {
          const m = findPhrase(line, anchor, lineMin);
          if (!m) continue;
          // Prefer the better match; tie-break toward the longer anchor, which
          // is the more specific claim.
          const better =
            !best ||
            m.score > best.score + 0.02 ||
            (Math.abs(m.score - best.score) <= 0.02 && anchor.length > best.anchor.length);
          if (better) {
            best = { key: spec.key, spec, pageIndex: page.index, line, start: m.start, end: m.end, score: m.score, anchor };
          }
        }
        if (best) lineHits.push(best);
      }

      // Resolve overlapping claims on this line — longest span wins, then score.
      lineHits.sort((a, b) => b.end - b.start - (a.end - a.start) || b.score - a.score);
      const taken: LabelHit[] = [];
      for (const hit of lineHits) {
        const clashes = taken.some((t) => hit.start < t.end && t.start < hit.end);
        if (!clashes) taken.push(hit);
      }
      hits.push(...taken);
    }
  }
  return hits;
}

/**
 * A value is a *contiguous* run of words. Columns, photo boxes and marginalia
 * are separated from it by a visibly wide gap, so we cut at the first gap that
 * is far larger than a word space.
 *
 * This is what stops "Employee Name: Priya Menon" from swallowing the "AFFIX
 * PASSPORT PHOTOGRAPH" box sitting further along the same visual line — those
 * words are on the same row, but they are plainly not part of the value, and
 * the whitespace is what says so.
 *
 * The threshold scales with text height, so it works the same on an 8pt form
 * and a 14pt one.
 */
function contiguousRun(words: Word[]): Word[] {
  const run: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0) {
      const gap = words[i].x0 - words[i - 1].x1;
      const h = Math.max(words[i].y1 - words[i].y0, 6);
      if (gap > h * 2.4) break;
    }
    run.push(words[i]);
  }
  return run;
}

/** Words on `line` after `fromIndex`, stopping at the next label or column. */
function valueWordsOnLine(line: Line, fromIndex: number, allHits: LabelHit[]): Word[] {
  const laterLabels = allHits
    .filter((h) => h.line === line && h.start >= fromIndex)
    .map((h) => h.start)
    .sort((a, b) => a - b);
  const stop = laterLabels.length ? laterLabels[0] : line.words.length;
  return contiguousRun(line.words.slice(fromIndex, stop));
}

/**
 * Some forms print the label above its box rather than beside it. If the line
 * is empty to the right, look directly underneath — but only at text that is
 * horizontally aligned with the label, so we don't grab the neighbouring
 * column's value.
 */
function valueWordsBelow(hit: LabelHit, page: PageResult, allHits: LabelHit[]): Word[] {
  const label = bboxOf(hit.line.words.slice(hit.start, hit.end));
  const lineHeight = Math.max(hit.line.y1 - hit.line.y0, 8);

  // Stacked-label layouts print several labels side by side on one line, each
  // with its value underneath. The next label to the right is therefore the
  // hard boundary of *this* field's column — its own value starts directly
  // below it. Whitespace contiguity alone can't be trusted here because
  // tightly-set columns have smaller gaps than a wide word space.
  const rightNeighbours = allHits
    .filter((h) => h.line === hit.line && h.start >= hit.end)
    .map((h) => hit.line.words[h.start].x0);
  const boundX = rightNeighbours.length ? Math.min(...rightNeighbours) - lineHeight * 0.5 : Infinity;

  const candidates = page.lines
    .filter((l) => l.y0 > hit.line.y0 + lineHeight * 0.4 && l.y0 - hit.line.y1 < lineHeight * 1.8)
    .sort((a, b) => a.y0 - b.y0);

  for (const line of candidates) {
    // Don't steal another field's label.
    const isLabelLine = allHits.some((h) => h.line === line);
    if (isLabelLine) continue;
    // Anchor on the first word sitting under the label, then extend by
    // contiguity up to the neighbouring column. A fixed right-hand cutoff
    // would truncate long values ("City International School" losing its
    // "School"); the gap and the next column's x together are the boundary.
    const startIdx = line.words.findIndex((w) => w.x1 > label.x0 - lineHeight && w.x0 < label.x1 + lineHeight * 3);
    if (startIdx === -1) continue;
    const run = contiguousRun(line.words.slice(startIdx));
    const words: Word[] = [];
    for (const w of run) {
      if (w.x0 >= boundX) break;
      words.push(w);
    }
    const text = words.map((w) => w.text).join(' ');
    if (!isFillerOnly(text)) return words;
  }
  return [];
}

/** Continuation lines for wrapped values (addresses, reasons, remarks). */
function continuationWords(hit: LabelHit, page: PageResult, allHits: LabelHit[], already: Word[]): Word[] {
  const lineHeight = Math.max(hit.line.y1 - hit.line.y0, 8);
  const taken = new Set(already);
  const out: Word[] = [];
  // Strictly *below* the label's line. Rendering quirks can split one visual
  // row into two Line clusters at nearly the same y; without the exclusions
  // here the value's own words get collected a second time and the field
  // reads "22 Gandhi Road, Camp, 22 Gandhi Road, Camp, Pune".
  const following = page.lines
    .filter((l) => l !== hit.line && l.y0 > hit.line.y0 + lineHeight * 0.55)
    .sort((a, b) => a.y0 - b.y0);

  let previousBottom = hit.line.y1;
  for (const line of following) {
    // Stop at the first gap — a wrapped value is tightly spaced.
    if (line.y0 - previousBottom > lineHeight * 0.9) break;
    // Stop at the next field.
    if (allHits.some((h) => h.line === line)) break;
    const fresh = line.words.filter((w) => !taken.has(w));
    const text = fresh.map((w) => w.text).join(' ');
    if (isFillerOnly(text)) break;
    out.push(...fresh);
    fresh.forEach((w) => taken.add(w));
    previousBottom = line.y1;
    if (out.length > 40) break; // runaway guard
  }
  return out;
}

/**
 * Checkbox groups: "[X] Male  [ ] Female".
 * We find each option's text near the label and inspect the marker beside it.
 */
function readCheckbox(hit: LabelHit, page: PageResult, spec: FieldSpec): { value: string; words: Word[]; conf: number } | null {
  if (!spec.options?.length) return null;
  const lineHeight = Math.max(hit.line.y1 - hit.line.y0, 8);
  const zone = page.lines.filter(
    (l) => l.y1 >= hit.line.y0 - lineHeight * 0.5 && l.y0 <= hit.line.y1 + lineHeight * 2.2,
  );

  const marked: { option: string; words: Word[]; conf: number }[] = [];
  // A ticked box reads as [X], (X), X, or a bare x adjacent to the option.
  const isTick = (t: string) => /^[\[(]?\s*[xX✓]\s*[\])]?$/.test(t.trim());
  // OCR misreads X as K or Y inside a merged token ("[K1Male"); a struck box
  // leaves *some* letter in the bracket, an empty box leaves none. The "1"s
  // are the box's own strokes ("]" misread), so digits don't count as ink.
  const prefixTicked = (prefix: string) => /[xkvy✓]/i.test(prefix.replace(/[\[\]()|.\d\s]/g, ''));

  for (const line of zone) {
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const wNorm = norm(w.text);

      // Clean case: the option is its own token, the box is its neighbour.
      // Only the token BEFORE counts: forms print "[X] Male [ ] Female", so in
      // a group the tick after "Male" belongs to "Female". Crediting either
      // side would mark the wrong option in every multi-option row.
      const exact = spec.options.find((o) => norm(o) === wNorm);
      if (exact) {
        const before = line.words[i - 1]?.text ?? '';
        if (isTick(before)) {
          marked.push({ option: exact, words: [line.words[i - 1], w], conf: w.conf });
        }
        continue;
      }

      // Merged case: box and option OCR'd as one token ("[X]Male", "[K1Male").
      // The option's own glyphs degrade too ("(Y)Fomale"), so the tail is
      // matched fuzzily rather than exactly — the box prefix still has to
      // show a tick, which keeps a mangled unticked option from matching.
      const merged = spec.options.find((o) => {
        const oNorm = norm(o);
        if (wNorm.length <= oNorm.length) return false;
        return similarity(wNorm.slice(-oNorm.length), oNorm) >= 0.75;
      });
      if (merged && prefixTicked(w.text.slice(0, w.text.length - merged.length))) {
        marked.push({ option: merged, words: [w], conf: w.conf * 0.8 });
      }
    }
  }
  if (marked.length === 1) return { value: marked[0].option, words: marked[0].words, conf: marked[0].conf };
  if (marked.length > 1) {
    // Multiple ticks: report them all and let a human resolve it. Picking one
    // would be guessing at the applicant's intent.
    return {
      value: marked.map((m) => m.option).join(', '),
      words: marked.flatMap((m) => m.words),
      conf: Math.min(...marked.map((m) => m.conf)) * 0.5,
    };
  }
  return null;
}

/**
 * Page-wide pattern search, used when the label yields nothing (or garbage).
 *
 * `used` makes matches consumable: a form carries a mobile number AND an
 * emergency contact, and both are phone-shaped. Without consumption, every
 * phone-typed field would grab the first number on the page and the second
 * one would silently vanish. With it, fields claim matches in template order
 * — which follows document order on every real form we model.
 */
function patternSearch(
  spec: FieldSpec,
  pages: PageResult[],
  used: Set<string>,
  near?: { pageIndex: number; y0: number; y1: number },
): { words: Word[]; pageIndex: number; text: string } | null {
  const re = PATTERNS[spec.type];
  if (!re) return null;
  for (const page of pages) {
    if (near && page.index !== near.pageIndex) continue;
    for (let li = 0; li < page.lines.length; li++) {
      const line = page.lines[li];
      // When rescuing a *labeled* field, only the label's neighbourhood
      // counts. A date is a date anywhere on the page, and without this
      // constraint a failed date-of-birth would happily steal the admission
      // date from five rows down — a wrong value wearing a valid shape, which
      // is the most dangerous kind.
      if (near) {
        const h = Math.max(near.y1 - near.y0, 8);
        const mid = (line.y0 + line.y1) / 2;
        if (mid < near.y0 - h * 1.2 || mid > near.y1 + h * 2.6) continue;
      }
      const m = line.text.match(re);
      if (!m) continue;
      const key = `${spec.type}:${page.index}:${li}:${m.index}`;
      if (used.has(key)) continue;
      used.add(key);
      // Map the matched substring back to the words that produced it.
      const matchedNorm = norm(m[0]).replace(/\s/g, '');
      const words: Word[] = [];
      let acc = '';
      for (const w of line.words) {
        if (matchedNorm.includes(norm(w.text).replace(/\s/g, '')) || acc.length) {
          words.push(w);
          acc += norm(w.text).replace(/\s/g, '');
          if (acc.length >= matchedNorm.length) break;
        }
      }
      return { words: words.length ? words : line.words, pageIndex: page.index, text: m[0] };
    }
  }
  return null;
}

function cropOf(words: Word[], page: PageResult): { x: number; y: number; w: number; h: number } {
  if (!words.length) return { x: 0, y: 0, w: 0, h: 0 };
  const b = bboxOf(words);
  // Pad slightly so the proof box frames the text instead of clipping it.
  const padX = (b.x1 - b.x0) * 0.02 + 3;
  const padY = (b.y1 - b.y0) * 0.12 + 3;
  return {
    x: Math.max(0, (b.x0 - padX) / page.width),
    y: Math.max(0, (b.y0 - padY) / page.height),
    w: Math.min(1, (b.x1 - b.x0 + padX * 2) / page.width),
    h: Math.min(1, (b.y1 - b.y0 + padY * 2) / page.height),
  };
}

export interface ExtractOptions {
  /** Detect ink under signature labels. Injected so extract stays pure. */
  signaturePresent?: (pageIndex: number, region: { x: number; y: number; w: number; h: number }) => Promise<boolean>;
  /**
   * Re-OCR a tight crop of the page (magnified, single-line segmentation).
   * Full-page OCR must segment the whole layout at once and splits its
   * attention accordingly; a second look at just the value's pixels, blown up
   * 2×, routinely recovers fields the first pass mangled. Injected so extract
   * stays pure of imaging concerns.
   */
  reread?: (
    pageIndex: number,
    region: { x: number; y: number; w: number; h: number },
  ) => Promise<{ text: string; conf: number } | null>;
}

/**
 * Rescue labels the full-page pass couldn't read.
 *
 * On a rough scan the printed labels degrade with everything else — "Student
 * Name" arrives as "Vinderi Game" and no anchor threshold can honestly bridge
 * that. But a magnified single-line re-read of just that line routinely comes
 * back far cleaner, because the engine no longer has to segment the whole
 * noisy page at once. So: for lines that matched nothing, re-read the line
 * and try the anchors against the *re-read* text.
 *
 * The label span is taken as the line's leading tokens — true of every
 * left-label layout, and harmless in stacked layouts where the label line
 * holds nothing else. Confidence carries the discount (score × 0.85, on top
 * of the page's quality cap), so nothing found this way auto-accepts on a
 * poor page.
 */
async function rescueLabels(
  template: DocTemplate,
  pages: PageResult[],
  hits: LabelHit[],
  reread: NonNullable<ExtractOptions['reread']>,
): Promise<void> {
  const MAX_LINES = 16; // cost guard: ~300ms per re-read
  for (const page of pages) {
    if (page.source !== 'OCR') continue;
    if (page.quality.verdict === 'GOOD' && page.ocrConfidence >= 0.6) continue;

    const wanted = template.fields.filter((spec) => !hits.some((h) => h.key === spec.key));
    if (!wanted.length) continue; // this page has nothing to rescue; later pages might

    const candidates = page.lines
      .filter((l) => !hits.some((h) => h.line === l) && l.words.length >= 1 && l.text.replace(/[^a-z]/gi, '').length >= 4)
      .slice(0, MAX_LINES);

    for (const line of candidates) {
      const region = cropOf(line.words, page);
      if (region.w <= 0) continue;
      const second = await reread(page.index, region);
      const cleanText = second?.text.trim();
      if (!cleanText) continue;

      let best: { spec: FieldSpec; anchor: string; score: number } | null = null;
      for (const spec of wanted) {
        if (hits.some((h) => h.key === spec.key)) continue;
        for (const anchor of spec.anchors) {
          // The label is the line's head. Both reads of it get a vote — the
          // full-page pass and the magnified re-read fail differently, and
          // either one coming close is evidence the label is really there.
          const target = norm(anchor);
          const score = Math.max(
            similarity(norm(cleanText).slice(0, target.length + 3), anchor),
            similarity(norm(line.text).slice(0, target.length + 3), anchor),
          );
          if (score >= 0.6 && (!best || score > best.score)) best = { spec, anchor, score };
        }
      }
      if (!best) continue;

      const anchorTokens = best.anchor.split(/\s+/).length;
      hits.push({
        key: best.spec.key,
        spec: best.spec,
        pageIndex: page.index,
        line,
        start: 0,
        end: Math.min(anchorTokens, line.words.length),
        score: best.score * 0.85,
        anchor: best.anchor,
      });
    }
  }
}

export async function extractFields(
  template: DocTemplate,
  pages: PageResult[],
  opts: ExtractOptions = {},
): Promise<ExtractedValue[]> {
  const hits = locateLabels(template, pages);
  if (opts.reread) await rescueLabels(template, pages, hits, opts.reread);
  const pageByIndex = new Map(pages.map((p) => [p.index, p]));
  const usedPatternMatches = new Set<string>();
  const out: ExtractedValue[] = [];

  for (const spec of template.fields) {
    // Best label hit for this field across the document.
    const candidates = hits.filter((h) => h.key === spec.key).sort((a, b) => b.score - a.score || a.pageIndex - b.pageIndex);
    const hit = candidates[0];

    let words: Word[] = [];
    let pageIndex = 0;
    let labelScore = 0;
    let source: ExtractedValue['source'] = pages[0]?.source === 'TEXT_LAYER' ? 'TEXT_LAYER' : 'OCR';
    let rawText = '';

    if (hit) {
      const page = pageByIndex.get(hit.pageIndex)!;
      pageIndex = hit.pageIndex;
      labelScore = hit.score;

      // Any field with a fixed option set may be printed as a tick-box group
      // ("[X] Male  [ ] Female") rather than as free text. Keying off
      // `options` rather than the `checkbox` type means gender, payment mode
      // and consent all get this for free, and a form that prints the same
      // field as plain text still falls through to the normal path below.
      if (spec.options?.length) {
        const box = readCheckbox(hit, page, spec);
        if (box) {
          words = box.words;
          rawText = box.value;
        }
      }

      if (!rawText) {
        // 1. To the right, bounded by the next label.
        words = valueWordsOnLine(hit.line, hit.end, hits);
        let text = stripSeparators(words.map((w) => w.text).join(' '));

        // 2. Nothing usable there — try directly below.
        if (isFillerOnly(text)) {
          const below = valueWordsBelow(hit, page, hits);
          if (below.length) {
            words = below;
            text = stripSeparators(below.map((w) => w.text).join(' '));
          }
        }

        // 3. Wrapped values continue onto following lines.
        if (spec.multiline && !isFillerOnly(text)) {
          const more = continuationWords(hit, page, hits, words);
          if (more.length) {
            words = [...words, ...more];
            text = stripSeparators(words.map((w) => w.text).join(' '));
          }
        }
        rawText = isFillerOnly(text) ? '' : text;
      }
    }

    // 4. Still nothing — fall back to a page-wide pattern hunt.
    //
    // With one exception: dates. An email or a mobile number is effectively
    // unique on a school form, so finding it anywhere is finding *it*. Dates
    // are the opposite — admission date, birth date, issue date all share one
    // shape, and a page-wide hunt for an unlabelled birth date will simply
    // return whichever date comes first. Better an honest MISSING than a
    // valid-looking wrong date, so the hunt only runs when the template has a
    // single date field and confusion is impossible.
    const dateFields = template.fields.filter((f) => f.type === 'date').length;
    const patternAllowed = spec.type !== 'date' || dateFields === 1;
    if (!rawText && patternAllowed) {
      const found = patternSearch(spec, pages, usedPatternMatches);
      if (found) {
        words = found.words;
        pageIndex = found.pageIndex;
        rawText = found.text;
        source = 'REGEX';
        // We matched a shape, not a label: we're confident about the value's
        // form and much less confident it belongs to this field.
        labelScore = 0.55;
      }
    }

    // `let`, not `const`: the pattern-rescue below may relocate the value to a
    // different page, and every later consumer (crop, quality, re-read) must
    // follow it there or the proof box lands on the wrong page.
    let page = pageByIndex.get(pageIndex) ?? pages[0];

    // Signatures can't be read, only detected. Saying "present" honestly beats
    // OCR'ing a squiggle into "Mmm~".
    if (spec.type === 'signature') {
      const region = hit ? cropOf(hit.line.words.slice(hit.start, hit.end), page) : { x: 0, y: 0, w: 0, h: 0 };
      let present = Boolean(rawText);
      if (hit && opts.signaturePresent) {
        // Probe *beside* the label, never across it. The word "Signature:" is
        // itself ink, so a region containing the label would report every form
        // as signed — including the blank ones, which is the only case anyone
        // actually needs this feature to catch.
        const startX = Math.min(0.97, region.x + region.w);
        const probe = {
          x: startX,
          y: Math.max(0, region.y - 0.035),
          w: Math.min(1 - startX, 0.3),
          h: Math.min(1 - Math.max(0, region.y - 0.035), region.h + 0.06),
        };
        present = await opts.signaturePresent(pageIndex, probe);
      }
      const value = present ? 'Present' : 'Not detected';
      out.push({
        key: spec.key,
        label: spec.label,
        value,
        rawValue: rawText,
        confidence: hit ? (present ? 0.9 : 0.75) : 0.4,
        ocrConfidence: hit ? hit.score : 0,
        page: pageIndex,
        crop: region,
        status: present ? 'AUTO' : 'REVIEW',
        source: 'DERIVED',
        valid: true,
        corrected: false,
        required: Boolean(spec.required),
        validationMessage: present ? undefined : 'No ink found in the signature area — check the original.',
      });
      continue;
    }

    let ocrConfidence = words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0;
    let normalised = normalizeField(rawText, spec);
    let validation = validateField(normalised.value, spec);
    let rereadUsed = false;

    // ── Pattern rescue for a garbage labeled read. ──
    // On degraded pages a (relaxed) label match sometimes captures junk —
    // "Fury" as a phone number — while the real value sits perfectly readable
    // elsewhere on the page. If the labeled value fails validation and a
    // strongly-shaped pattern for this type validates, the shape wins: a
    // string that IS a phone number beats one that is not, wherever it was
    // found relative to the label.
    if (rawText && !validation.valid && PATTERNS[spec.type] && page?.source === 'OCR') {
      const anchor = hit ? { pageIndex: hit.pageIndex, y0: hit.line.y0, y1: hit.line.y1 } : undefined;
      const found = patternSearch(spec, pages, usedPatternMatches, anchor);
      if (found) {
        const candidate = normalizeField(found.text, spec);
        const candidateValidation = validateField(candidate.value, spec);
        if (candidateValidation.valid) {
          words = found.words;
          pageIndex = found.pageIndex;
          page = pageByIndex.get(pageIndex) ?? page;
          rawText = found.text;
          normalised = candidate;
          validation = candidateValidation;
          source = 'REGEX';
          labelScore = 0.55;
          ocrConfidence = found.words.length
            ? found.words.reduce((a, w) => a + w.conf, 0) / found.words.length
            : ocrConfidence;
        }
      }
    }

    // ── Second look at a doubtful read. ──
    // Only for OCR'd single-line values that either failed validation or read
    // below 0.8: a magnified single-line pass over just the value's crop. The
    // replacement bar is deliberately one-directional — a re-read is adopted
    // only when it *fixes* validity or clearly out-scores the original, so the
    // worst it can do is cost a little time.
    if (
      opts.reread &&
      rawText &&
      words.length &&
      page?.source === 'OCR' &&
      !spec.multiline &&
      (!validation.valid || ocrConfidence < 0.8)
    ) {
      const second = await opts.reread(pageIndex, cropOf(words, page));
      if (second?.text.trim()) {
        const secondRaw = stripSeparators(second.text);
        const secondNorm = normalizeField(secondRaw, spec);
        const secondValid = validateField(secondNorm.value, spec);
        const fixesValidity = secondValid.valid && !validation.valid;
        const clearlyBetter = secondValid.valid === validation.valid && second.conf > ocrConfidence + 0.08;
        if (secondNorm.value && (fixesValidity || clearlyBetter)) {
          rawText = secondRaw;
          normalised = secondNorm;
          validation = secondValid;
          ocrConfidence = Math.max(ocrConfidence, second.conf);
          rereadUsed = true;
        }
      }
    }

    const confidence = rawText
      ? scoreField({
          ocrConfidence,
          labelScore,
          source,
          valid: validation.valid,
          corrected: normalised.corrected,
          ambiguous: normalised.ambiguous,
          quality: page?.quality ?? { sharpness: 1, contrast: 1, dpi: 300, inkCoverage: 0.05, verdict: 'GOOD', notes: [] },
        })
      : 0;

    const notes = [validation.message, normalised.note, rereadUsed ? 'recovered by magnified re-read' : undefined]
      .filter(Boolean)
      .join(' · ');

    out.push({
      key: spec.key,
      label: spec.label,
      value: normalised.value,
      rawValue: rawText,
      confidence,
      ocrConfidence: Number(ocrConfidence.toFixed(4)),
      page: pageIndex,
      crop: cropOf(words, page),
      status: statusFor(confidence, validation.valid, normalised.value, Boolean(spec.required)),
      source,
      valid: validation.valid,
      validationMessage: notes || undefined,
      corrected: normalised.corrected || rereadUsed,
      required: Boolean(spec.required),
    });
  }

  return out;
}

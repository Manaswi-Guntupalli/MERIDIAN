// Lumen — document type detection.
//
// No fixed coordinates, no filename sniffing, no "the user told us so". We read
// the page and decide what it is from its own words, the way a clerk would:
// mostly by the title at the top, corroborated by the vocabulary below it.
//
// Two ideas do the heavy lifting:
//
// 1. **Position is evidence.** "Transfer Certificate" printed as a heading is a
//    near-certain identification; the same phrase buried in a paragraph on page
//    3 is a passing mention. So signals found in the headline band score
//    substantially higher.
//
// 2. **Confidence must reflect ambiguity.** A report card and a mark sheet share
//    most of their vocabulary. Scoring the winner alone would report 95% on a
//    coin-flip. Instead we compare the winner to the runner-up, so a close call
//    honestly reports itself as a close call and lands in the review queue.

import { TEMPLATES } from './templates.js';
import { norm, similarity } from './text.js';
import type { DocTemplate, PageResult } from './types.js';

export interface Classification {
  type: string;
  confidence: number;
  /** Ranked alternatives — surfaced in the UI so a human can override. */
  ranked: { type: string; label: string; score: number }[];
  matched: string[];
}

/** The top slice of page 1, where forms print their title. */
const HEADLINE_BAND = 0.22;
const HEADLINE_BONUS = 2.2;

function scoreTemplate(
  tpl: DocTemplate,
  haystack: string,
  headline: string,
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];

  for (const signal of tpl.signals) {
    const phrase = norm(signal.phrase);
    if (!phrase) continue;

    if (headline.includes(phrase)) {
      score += signal.weight * HEADLINE_BONUS;
      matched.push(signal.phrase);
      continue;
    }
    if (haystack.includes(phrase)) {
      score += signal.weight;
      matched.push(signal.phrase);
      continue;
    }
    // Fall back to fuzzy matching for multi-word signals — a single OCR slip in
    // "Bonafide Certificate" shouldn't cost us the whole identification.
    if (phrase.length >= 10) {
      const window = phrase.length;
      let best = 0;
      // Sample the haystack rather than testing every offset; a title-length
      // phrase doesn't need character-precision alignment to be recognised.
      for (let i = 0; i + window <= haystack.length; i += Math.max(1, Math.floor(window / 3))) {
        const sim = similarity(haystack.slice(i, i + window), phrase);
        if (sim > best) best = sim;
        if (best > 0.92) break;
      }
      if (best >= 0.82) {
        score += signal.weight * best * 0.8; // discounted: it's a fuzzy hit
        matched.push(`${signal.phrase} (~${Math.round(best * 100)}%)`);
      }
    }
  }
  return { score, matched };
}

export function classify(pages: PageResult[]): Classification {
  const first = pages[0];
  const fullText = norm(pages.map((p) => p.text).join('\n'));

  // Build the headline from geometry, not from the first N characters: on a
  // two-column form the title is still the top band, but it is nowhere near the
  // first line of the reading order.
  let headline = '';
  if (first?.lines?.length) {
    const cutoff = first.height * HEADLINE_BAND;
    headline = norm(
      first.lines
        .filter((l) => l.y0 <= cutoff)
        .map((l) => l.text)
        .join(' '),
    );
  }

  const scored = TEMPLATES.map((tpl) => {
    const { score, matched } = scoreTemplate(tpl, fullText, headline);
    return { type: tpl.type, label: tpl.label, score, matched };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const runnerUp = scored[1];

  // Nothing matched at all — an unknown or unreadable page. Say so: the type
  // is UNKNOWN, not a silent default. (Extraction still runs with the default
  // template's anchors — generic fields like names and dates overlap across
  // forms — but the document is honestly labelled until a human sets a type.)
  if (!winner || winner.score <= 0) {
    return {
      type: 'UNKNOWN',
      confidence: 0,
      ranked: scored.slice(0, 5).map(({ type, label, score }) => ({ type, label, score: Math.round(score) })),
      matched: [],
    };
  }

  // Absolute evidence: did we see enough to be sure of anything?
  const evidence = Math.min(1, winner.score / 22);
  // Relative evidence: how much better than the next-best guess?
  const margin = runnerUp && runnerUp.score > 0 ? 1 - runnerUp.score / winner.score : 1;
  // Both must hold. Strong-but-ambiguous and clear-but-thin are each uncertain.
  const confidence = Math.max(0, Math.min(0.99, evidence * (0.55 + 0.45 * margin)));

  return {
    type: winner.type,
    confidence: Number(confidence.toFixed(3)),
    ranked: scored.slice(0, 5).map(({ type, label, score }) => ({ type, label, score: Math.round(score) })),
    matched: winner.matched,
  };
}

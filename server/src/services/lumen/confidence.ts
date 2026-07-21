// Lumen — confidence scoring.
//
// A confidence score is a promise to the user: "at 96% you can skim this; at
// 60% go look at the paper." That promise is only worth anything if the number
// is *calibrated* — if things marked 95% are actually right ~95% of the time.
//
// Tesseract's own confidence answers a much narrower question than users think.
// It says "I am sure these pixels are the letter B." It does not know whether B
// belongs in this field, whether we read the right box, or whether the value is
// possible. So the raw engine number is only the first of several independent
// ways a field can be wrong, and we combine them multiplicatively: every
// additional way to be wrong can only lower the score.
//
// The deliberate consequence is that scores are conservative. A field that
// reads cleanly but fails validation scores low even though the OCR was
// flawless — because the *value* is what the user is trusting, not the pixels.

import type { FieldSource, FieldStatus, QualityMetrics } from './types.js';

/**
 * Above this, a field is accepted without human review.
 *
 * Set high on purpose. The cost of the two errors is wildly asymmetric: a
 * false review wastes five seconds of a clerk's time, while a false accept puts
 * a wrong blood group on a child's record and nobody ever looks again. When in
 * doubt, ask.
 */
export const AUTO_ACCEPT = 0.9;

/** How much we trust a value based on *how* we obtained it. */
const SOURCE_TRUST: Record<FieldSource, number> = {
  // The file told us its own text. Not a guess.
  TEXT_LAYER: 1.0,
  // Pixels, recognised. The engine's own score already reflects the risk.
  OCR: 1.0,
  // Found by pattern anywhere on the page rather than next to its label — the
  // value is well-formed, but we're less certain it belongs to this field.
  REGEX: 0.85,
  // A language model's reading. Plausible, fluent, and capable of inventing
  // things that were never on the page, so it never auto-accepts alone.
  AI: 0.8,
  // Computed from other fields rather than read.
  DERIVED: 0.75,
};

export interface ScoreInput {
  /** Engine confidence for the value's own tokens, 0..1. */
  ocrConfidence: number;
  /** How well the printed label matched our anchor, 0..1. */
  labelScore: number;
  source: FieldSource;
  valid: boolean;
  /** The normaliser had to repair the raw read. */
  corrected: boolean;
  /** The raw text genuinely supports more than one reading. */
  ambiguous?: boolean;
  quality: QualityMetrics;
  /** Cross-field validation contradicted this field. */
  contradicted?: boolean;
}

export function scoreField(input: ScoreInput): number {
  // Start from what the engine thinks of the pixels.
  let score = Math.max(0, Math.min(1, input.ocrConfidence));

  // Did we read the right box? A weak label match means the value may be
  // correctly recognised but attached to the wrong field — a silent, nasty
  // failure, so it's weighted heavily.
  score *= 0.35 + 0.65 * Math.max(0, Math.min(1, input.labelScore));

  score *= SOURCE_TRUST[input.source] ?? 0.8;

  // A repair means the raw read was wrong at least once. Our fix is probably
  // right, but "probably" is the point of a confidence score.
  if (input.corrected) score *= 0.94;

  // Two readings are defensible and we picked one. That's a coin-flip we should
  // not hide behind a high number.
  if (input.ambiguous) score *= 0.62;

  // Page legibility caps everything: on a poor scan, high per-word confidence
  // often means the engine is confidently wrong.
  const qualityCap = input.quality.verdict === 'GOOD' ? 1 : input.quality.verdict === 'FAIR' ? 0.93 : 0.8;
  score *= qualityCap;

  // Validation failure is decisive. We read *something*, but it isn't a phone
  // number, so no amount of pixel confidence should let it through unseen.
  if (!input.valid) score = Math.min(score, 0.45);

  // Contradicted by another field: both can't be right, so neither is trusted.
  if (input.contradicted) score = Math.min(score, 0.7);

  return Math.max(0, Math.min(0.99, Number(score.toFixed(4))));
}

export function statusFor(confidence: number, valid: boolean, value: string, expected: boolean): FieldStatus {
  // An empty field means two very different things:
  //  · EXPECTED on this document type → MISSING. A human should look — the
  //    form normally carries it, so its absence is document-quality news.
  //  · not expected → ABSENT. This form version simply doesn't have the box.
  //    Not an OCR failure, not review work; the row is kept only so a clerk
  //    can hand-fill it later if they want to.
  if (!value.trim()) return expected ? 'MISSING' : 'ABSENT';
  if (!valid) return 'REVIEW';
  return confidence >= AUTO_ACCEPT ? 'AUTO' : 'REVIEW';
}

/**
 * Document-level confidence.
 *
 * A plain mean would let twelve easy fields drown out the one that's wrong —
 * and the one that's wrong is the entire reason a human is looking. So expected
 * fields carry triple weight, and a missing expected field is scored as a zero
 * rather than skipped. The headline number should get *worse* when something
 * important is absent, not quietly improve because there's less to average.
 * ABSENT fields (not expected, not on this form version) are excluded
 * entirely — a form can't lose marks for boxes it never had.
 */
export function documentConfidence(
  fields: { confidence: number; expected: boolean; status: FieldStatus }[],
): number {
  const counted = fields.filter((f) => f.status !== 'ABSENT');
  if (!counted.length) return 0;
  let weighted = 0;
  let weight = 0;
  for (const f of counted) {
    const w = f.expected ? 3 : 1;
    weighted += (f.status === 'MISSING' ? 0 : f.confidence) * w;
    weight += w;
  }
  return Number((weighted / weight).toFixed(4));
}

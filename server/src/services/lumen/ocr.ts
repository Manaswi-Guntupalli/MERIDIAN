// Lumen — the OCR engine layer.
//
// Tesseract workers are expensive to spin up (each one loads a ~15MB language
// model), so we pool them and reuse them across documents. Batch uploads then
// pay that cost once instead of once per file.
//
// This module is deliberately the *only* place that knows Tesseract exists.
// Everything above it consumes `Word[]`, which is why the text-layer fast path
// can substitute itself transparently.

import os from 'node:os';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Word } from './types.js';

const POOL_SIZE = Math.max(1, Math.min(4, (os.cpus()?.length ?? 2) - 1));

interface Pooled {
  worker: Worker;
  busy: boolean;
}

const pool: Pooled[] = [];
const waiters: ((p: Pooled) => void)[] = [];
let initialising: Promise<void> | null = null;

async function spawn(): Promise<Pooled> {
  const worker = await createWorker('eng', 1, {
    // Tesseract's logger is extremely chatty; stay quiet unless debugging.
    logger: () => {},
    errorHandler: (e) => console.warn('[lumen/ocr]', e),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    // Forms are printed with a known character set; excluding exotic glyphs
    // measurably reduces confusions on noisy scans.
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;/@#&()\\-_+₹$%\'"[]',
    preserve_interword_spaces: '1',
  });
  return { worker, busy: false };
}

async function ensurePool(): Promise<void> {
  if (pool.length) return;
  if (!initialising) {
    initialising = (async () => {
      const created = await Promise.all(Array.from({ length: POOL_SIZE }, () => spawn()));
      pool.push(...created);
      console.log(`[lumen/ocr] ${pool.length} OCR worker(s) ready`);
    })();
  }
  await initialising;
}

async function acquire(): Promise<Pooled> {
  await ensurePool();
  const free = pool.find((p) => !p.busy);
  if (free) {
    free.busy = true;
    return free;
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release(p: Pooled): void {
  const next = waiters.shift();
  if (next) {
    next(p); // hand the worker straight to whoever is queued — stays busy
    return;
  }
  p.busy = false;
}

/** Tesseract reports bbox in the image's own pixel space; that's what we want. */
function flattenWords(data: unknown): Word[] {
  const out: Word[] = [];
  const blocks = (data as { blocks?: unknown[] })?.blocks ?? [];
  for (const block of blocks as any[]) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        for (const w of line?.words ?? []) {
          const text = String(w?.text ?? '').trim();
          if (!text) continue;
          const b = w?.bbox;
          if (!b) continue;
          out.push({
            text,
            conf: Math.max(0, Math.min(1, Number(w?.confidence ?? 0) / 100)),
            x0: b.x0,
            y0: b.y0,
            x1: b.x1,
            y1: b.y1,
          });
        }
      }
    }
  }
  return out;
}

export interface OcrResult {
  words: Word[];
  text: string;
  confidence: number;
}

export async function recognise(image: Buffer, psm: PSM = PSM.AUTO): Promise<OcrResult> {
  const p = await acquire();
  try {
    if (psm !== PSM.AUTO) await p.worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await p.worker.recognize(image, {}, { blocks: true, text: true });
    if (psm !== PSM.AUTO) await p.worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const words = flattenWords(data);
    return {
      words,
      text: String((data as { text?: string }).text ?? ''),
      confidence: words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0,
    };
  } finally {
    release(p);
  }
}

/**
 * How "language-like" is this read? Used to compare *reads of the same page* —
 * different rotations, different preprocessing variants — so it only has to be
 * monotonic, not calibrated.
 *
 * Confidence alone is a trap: an upside-down page yields few words at
 * deceptively high confidence. Weighting by how much real text we recovered is
 * what actually separates a good read from a confident empty one.
 */
export function legibilityScore(r: OcrResult): number {
  const solid = r.words.filter((w) => w.conf > 0.6 && /[a-z0-9]/i.test(w.text));
  const letters = solid.reduce((a, w) => a + w.text.length, 0);
  return letters * (r.confidence || 0.01);
}

const legibility = legibilityScore;

/**
 * Decide whether the page is upright, and if not, by how much it's turned.
 *
 * We try the cheap thing first: read it as-is. If that looks like real text we
 * stop — which is the overwhelmingly common case and costs one low-res pass.
 * Only when the page reads like noise do we pay for the other three rotations.
 */
export async function detectOrientation(
  probeImage: Buffer,
): Promise<{ rotation: number; trials: { rotation: number; score: number }[] }> {
  const sharp = (await import('sharp')).default;
  const small = await sharp(probeImage).greyscale().resize({ width: 1000, withoutEnlargement: true }).png().toBuffer();

  const upright = await recognise(small);
  const uprightScore = legibility(upright);
  const trials = [{ rotation: 0, score: Math.round(uprightScore) }];

  // A confidently-read page with real content needs no further investigation.
  if (uprightScore > 400 && upright.confidence > 0.7) return { rotation: 0, trials };

  // The bar a challenger must clear scales with how bad the page is. On a
  // legible page a wrongly-rotated read scores near zero, so 1.4× is already
  // decisive. On a *garbage* page every rotation reads garbage, the scores
  // are all noise-level, and a relative bar alone lets noise rotate a
  // perfectly upright page sideways — observed doing exactly that, turning a
  // bad-but-extractable scan into vertical word salad. Hence the absolute
  // floor: a challenger must not merely beat upright, it must demonstrate
  // genuinely readable text (a score no noise-read achieves) before we
  // physically rotate someone's document.
  let best = { rotation: 0, score: uprightScore };
  for (const rotation of [90, 180, 270]) {
    const rotated = await sharp(small).rotate(rotation).png().toBuffer();
    const score = legibility(await recognise(rotated));
    trials.push({ rotation, score: Math.round(score) });
    if (score > Math.max(best.score * 1.4, 250)) best = { rotation, score };
  }
  return { rotation: best.rotation, trials };
}

/** Read a tight crop with single-line segmentation — used for value re-reads. */
export async function recogniseLine(image: Buffer): Promise<OcrResult> {
  return recognise(image, PSM.SINGLE_LINE);
}

export async function shutdownOcr(): Promise<void> {
  await Promise.all(pool.map((p) => p.worker.terminate().catch(() => {})));
  pool.length = 0;
  initialising = null;
}

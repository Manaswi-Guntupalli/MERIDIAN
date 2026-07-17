// Lumen — ingestion. Turns whatever the user uploaded into positioned words.
//
// The central decision here is the one that makes Lumen both accurate and
// honest: **not every PDF needs OCR.**
//
// A PDF exported from a computer already contains its text, with exact glyph
// positions. Running OCR on it would take a perfect signal, rasterise it into
// pixels, and then guess at those pixels — throwing away accuracy for no
// reason. So we look for a real text layer first and use it when it's there
// (fast, effectively lossless), and fall back to the full imaging pipeline for
// scans, photos, and image-only PDFs. That's the same split AWS Textract and
// Google Document AI make, for the same reason.
//
// Pages are decided independently, because a single PDF genuinely can mix a
// digital cover sheet with scanned attachments.

import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { badRequest } from '../../lib/errors.js';
import { preprocessPage, makePreview } from './preprocess.js';
import { detectOrientation, recognise, legibilityScore, type OcrResult } from './ocr.js';
import { correctPerspective } from './perspective.js';
import { buildLines } from './text.js';
import type { PageResult, QualityMetrics, Word } from './types.js';

const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));

// These must be real URLs with a trailing slash — pdf.js validates the format
// and rejects a bare filesystem path. On Windows that means `D:\...\cmaps\`
// fails and `file:///D:/.../cmaps/` works, so build them via pathToFileURL
// rather than string-concatenating a path.
const asDirUrl = (dir: string) => pathToFileURL(dir).href.replace(/\/?$/, '/');
const STANDARD_FONT_DATA_URL = asDirUrl(path.join(PDFJS_ROOT, 'standard_fonts'));
const CMAP_URL = asDirUrl(path.join(PDFJS_ROOT, 'cmaps'));

/** Render target for OCR — ~260 DPI on A4, the sweet spot for Tesseract. */
const OCR_RENDER_WIDTH = 2200;
/** Cheaper render for pages we'll read from the text layer (preview only). */
const PREVIEW_RENDER_WIDTH = 1100;

export const SUPPORTED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
];

/**
 * A page needs this much real text before we trust its text layer. Scanned PDFs
 * often carry a few stray characters (a footer stamp, a scanner watermark), and
 * treating those as "has text" would skip OCR on a page that desperately needs
 * it.
 */
const TEXT_LAYER_MIN_CHARS = 60;

export interface IngestProgress {
  (stage: string, pageIndex: number, totalPages: number): void;
}

function perfectQuality(notes: string[] = []): QualityMetrics {
  // A digital text layer has no scan artefacts to measure — it is by
  // construction pristine. Reporting invented blur metrics here would be a lie.
  return { sharpness: 1, contrast: 1, dpi: 300, inkCoverage: 0.05, verdict: 'GOOD', notes };
}

/**
 * Convert a pdf.js text item into word boxes.
 *
 * pdf.js gives us a run of text with one transform for the whole run, not
 * per-glyph boxes. So when a run holds several words we split on whitespace and
 * apportion the run's measured width across them by character count. For proof
 * crops and label anchoring that's comfortably precise; it would not be precise
 * enough for glyph-level work, and we don't do glyph-level work.
 */
function itemToWords(item: any, viewport: any): Word[] {
  const str: string = item.str ?? '';
  if (!str.trim()) return [];

  const tx = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.hypot(tx[1], tx[3]) || 10;
  const runWidth = (item.width ?? 0) * viewport.scale;
  const x0 = tx[4];
  const baseline = tx[5];
  // Text sits on its baseline; allow for ascender above and descender below.
  const top = baseline - fontHeight * 0.88;
  const bottom = baseline + fontHeight * 0.22;

  const tokens = str.split(/(\s+)/).filter((t) => t.length);
  const totalChars = str.length || 1;
  const words: Word[] = [];
  let cursor = x0;

  for (const token of tokens) {
    const tokenWidth = (token.length / totalChars) * runWidth;
    if (token.trim()) {
      words.push({
        text: token,
        conf: 1, // exact, not recognised — this is the file's own text
        x0: cursor,
        y0: top,
        x1: cursor + tokenWidth,
        y1: bottom,
      });
    }
    cursor += tokenWidth;
  }
  return words;
}

async function renderPage(page: any, targetWidth: number): Promise<{ buffer: Buffer; scale: number; viewport: any }> {
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  // PDFs assume white paper; without this, transparent areas render black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas }).promise;
  return { buffer: canvas.toBuffer('image/png'), scale, viewport };
}

export type IngestedPage = PageResult & {
  previewJpeg: Buffer;
  /** The exact image the winning OCR pass read — crops for re-reads must come
   *  from this buffer so their coordinates line up with the word boxes. */
  workBuffer: Buffer;
};

/** Run the imaging pipeline over one rasterised page and read it. */
async function ocrImagePage(
  index: number,
  raster: Buffer,
  pageWidthInches: number,
  onProgress?: IngestProgress,
  totalPages = 1,
): Promise<IngestedPage> {
  // Photographed pages first get flattened back into scans. Scanner output
  // (paper filling the frame) is detected and left untouched inside.
  onProgress?.('Checking for camera perspective', index, totalPages);
  const persp = await correctPerspective(raster);

  onProgress?.('Detecting orientation', index, totalPages);
  const { rotation } = await detectOrientation(persp.buffer);

  onProgress?.('Cleaning image', index, totalPages);
  const pre = await preprocessPage(persp.buffer, { rotation, pageWidthInches });
  if (persp.note) pre.quality.notes.unshift(persp.note);

  onProgress?.('Reading text', index, totalPages);
  let best: OcrResult = await recognise(pre.buffer);
  let bestBuffer = pre.buffer;
  let width = pre.width;
  let height = pre.height;

  // ── Multi-pass rescue. ──
  // Image-quality diagnosis is fallible: JPEG block edges register as
  // "sharpness", washout hides in the histogram, and the wrong preprocessing
  // recipe gets picked. Rather than trusting the diagnosis, we check the
  // *outcome* — if the read looks weak, try two structurally different
  // variants and keep whichever read recovers the most legible text. This is
  // empirical where the single-pass approach was diagnostic, and it is the
  // difference between "our blur heuristic guessed right" and robustness.
  const firstScore = legibilityScore(best);
  if (firstScore < 380 || best.confidence < 0.68) {
    onProgress?.('Weak read — trying image variants', index, totalPages);
    const variants: { name: string; make: () => Promise<{ buf: Buffer; w: number; h: number }> }[] = [
      {
        // Hard ink/paper decision: rescues washed-out grey mush and kills
        // JPEG mosquito noise that fools the engine's internal binariser.
        name: 'binarised',
        make: async () => ({ buf: await sharp(pre.buffer).threshold(165).png().toBuffer(), w: pre.width, h: pre.height }),
      },
      {
        // Un-upscale: a 100-DPI original blown up by a copier (or by our own
        // upscaler) is smeared at large size but often clean at its native
        // scale, where strokes are 1-2px instead of 4px of gradient.
        name: 'downscaled',
        make: async () => {
          const w = Math.max(900, Math.round(pre.width * 0.55));
          const buf = await sharp(pre.buffer).resize({ width: w, kernel: 'lanczos3' }).png().toBuffer();
          const meta = await sharp(buf).metadata();
          return { buf, w: meta.width ?? w, h: meta.height ?? Math.round((pre.height * w) / pre.width) };
        },
      },
    ];
    for (const variant of variants) {
      const { buf, w, h } = await variant.make();
      const attempt = await recognise(buf);
      // Demand a decisive win — swapping variants for a 5% score wobble would
      // add noise, not robustness.
      if (legibilityScore(attempt) > legibilityScore(best) * 1.2) {
        best = attempt;
        bestBuffer = buf;
        width = w;
        height = h;
        pre.quality.notes.push(`Standard read was weak — the ${variant.name} variant read better and was used.`);
      }
    }
  }

  const words = best.words;
  if (!words.length) pre.quality.notes.push('No readable text found on this page.');

  // The preview must match the coordinate space the crops refer to, so it is
  // rendered from the image the winning pass read — same rotation, same
  // deskew, same aspect. (Normalised crop coordinates survive the proportional
  // resize.) Preview from pre.buffer stays visually clean even when the
  // binarised variant won, because both share dimensions.
  const previewJpeg = await makePreview(bestBuffer === pre.buffer ? pre.buffer : bestBuffer);

  return {
    index,
    width,
    height,
    source: 'OCR',
    rotation: pre.rotation,
    skewDeg: pre.skewDeg,
    ocrConfidence: Number(best.confidence.toFixed(4)),
    words,
    lines: buildLines(words),
    text: best.text,
    quality: pre.quality,
    previewJpeg,
    workBuffer: bestBuffer,
  };
}

async function ingestPdf(buffer: Buffer, onProgress?: IngestProgress): Promise<IngestedPage[]> {
  let pdf: any;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      useSystemFonts: true,
    }).promise;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (/password/i.test(msg)) throw badRequest('This PDF is password-protected. Please upload an unlocked copy.');
    if (/invalid pdf structure|xref|startxref|unexpected/i.test(msg)) {
      throw badRequest('This file could not be opened as a PDF — it may be corrupted.');
    }
    // Anything else is our problem, not the file's. Blaming the upload for a
    // configuration bug sends the user off to re-scan a document that was
    // fine, so surface the real cause instead of a confident wrong guess.
    console.error('[lumen/ingest] unexpected PDF failure:', err);
    throw badRequest(`This PDF could not be processed: ${msg || 'unknown error'}`);
  }

  if (pdf.numPages < 1) throw badRequest('This PDF contains no pages.');

  const pages: IngestedPage[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const pageWidthInches = base.width / 72;

    onProgress?.('Inspecting page', i, pdf.numPages);
    const content = await page.getTextContent();
    const rawText = content.items.map((it: any) => it.str ?? '').join('');
    const charCount = rawText.replace(/\s/g, '').length;

    if (charCount >= TEXT_LAYER_MIN_CHARS) {
      // ── Fast path: the file already knows what it says. ──
      const { buffer: raster, viewport } = await renderPage(page, PREVIEW_RENDER_WIDTH);
      const words: Word[] = [];
      for (const item of content.items) {
        if ((item as any).str !== undefined) words.push(...itemToWords(item, viewport));
      }
      const lines = buildLines(words);
      pages.push({
        index: i,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        source: 'TEXT_LAYER',
        rotation: 0,
        skewDeg: 0,
        ocrConfidence: 1,
        words,
        lines,
        text: lines.map((l) => l.text).join('\n'),
        quality: perfectQuality(['Digital PDF — text read directly, no OCR needed.']),
        previewJpeg: await makePreview(raster),
        workBuffer: raster, // unused on this path — re-reads only apply to OCR pages
      });
    } else {
      // ── Scan path: rasterise and do it the hard way. ──
      const { buffer: raster } = await renderPage(page, OCR_RENDER_WIDTH);
      pages.push(await ocrImagePage(i, raster, pageWidthInches, onProgress, pdf.numPages));
    }
  }

  await pdf.cleanup?.();
  await pdf.destroy?.();
  return pages;
}

async function ingestImage(buffer: Buffer, onProgress?: IngestProgress): Promise<IngestedPage[]> {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw badRequest('This image could not be decoded — it may be corrupted.');
  }
  if (!meta.width || !meta.height) throw badRequest('This image has no readable dimensions.');

  // Normalise to PNG first so downstream stages see one predictable format
  // (and so EXIF orientation from phone cameras is baked in, not ignored).
  const normalised = await sharp(buffer).rotate().png().toBuffer();
  const pageWidthInches = 8.27;
  return [await ocrImagePage(0, normalised, pageWidthInches, onProgress, 1)];
}

export async function ingest(
  file: { buffer: Buffer; mimeType: string; fileName: string },
  onProgress?: IngestProgress,
): Promise<IngestedPage[]> {
  if (!file.buffer?.length) throw badRequest('The uploaded file is empty.');

  const mime = (file.mimeType || '').toLowerCase();
  const isPdf = mime.includes('pdf') || file.fileName.toLowerCase().endsWith('.pdf');

  // Trust the bytes, not the declared MIME type: browsers lie, and a mislabelled
  // upload should still work rather than fail with a confusing error.
  const looksPdf = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';

  if (looksPdf || isPdf) return ingestPdf(file.buffer, onProgress);
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/i.test(file.fileName)) {
    return ingestImage(file.buffer, onProgress);
  }
  throw badRequest(`Unsupported file type "${mime || path.extname(file.fileName)}". Upload a PDF, PNG, JPG, WEBP or TIFF.`);
}

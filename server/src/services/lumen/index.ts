// Lumen — the pipeline orchestrator.
//
// Everything below is deliberately thin: each stage lives in its own module and
// this file just sequences them and times them. That ordering is the design,
// though, so it's worth stating why it is what it is:
//
//   ingest      → get positioned words (text layer if we can, OCR if we must)
//   classify    → work out what the document is, from its own words
//   extract     → find each field by its printed label
//   cross-check → catch values that can't all be true at once
//   AI repair   → mend low-confidence reads, grounded in the page
//   duplicates  → is this person already in the system?
//   score       → one honest number for the whole document
//
// Classification comes *before* extraction because you cannot know which
// labels to look for until you know what you're holding. And AI repair comes
// after cross-checking so the model sees which fields we already distrust.

import sharp from 'sharp';
import { ingest, type IngestProgress } from './ingest.js';
import { classify } from './classify.js';
import { recogniseLine } from './ocr.js';
import { extractFields } from './extract.js';
import { crossValidate } from './validate.js';
import { aiRefine, findDuplicates, missingFieldInsights, qualityInsights } from './postprocess.js';
import { documentConfidence, statusFor } from './confidence.js';
import { templateFor } from './templates.js';
import { inkInRegion } from './preprocess.js';
import { savePagePreview } from './storage.js';
import type { Insight, ProcessResult, StageTiming } from './types.js';

/**
 * Cut a field's region out of the page and magnify it for a second OCR pass.
 * 2× with Lanczos: enough to give Tesseract fat, clean strokes; more starts
 * amplifying noise instead of signal.
 */
async function cropForReread(
  workBuffer: Buffer,
  pageW: number,
  pageH: number,
  region: { x: number; y: number; w: number; h: number },
): Promise<Buffer | null> {
  const pad = 4;
  const left = Math.max(0, Math.round(region.x * pageW) - pad);
  const top = Math.max(0, Math.round(region.y * pageH) - pad);
  const width = Math.min(pageW - left, Math.round(region.w * pageW) + pad * 2);
  const height = Math.min(pageH - top, Math.round(region.h * pageH) + pad * 2);
  if (width < 12 || height < 8) return null;
  try {
    return await sharp(workBuffer)
      .extract({ left, top, width, height })
      .resize({ width: Math.min(width * 2, 1600), kernel: 'lanczos3' })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

export interface ProcessOptions {
  schoolId: string;
  documentId: string;
  /** Skip classification and force a template (user override). */
  forceType?: string;
  /** Allow the LLM repair pass. */
  useAI?: boolean;
  onProgress?: (stage: string, pct: number) => void;
}

export async function processDocument(
  file: { buffer: Buffer; mimeType: string; fileName: string },
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const started = Date.now();
  const timings: StageTiming[] = [];
  const insights: Insight[] = [];

  const time = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const result = await fn();
    timings.push({ stage, ms: Date.now() - t0 });
    return result;
  };

  // ── 1. Ingest ──
  opts.onProgress?.('Reading document', 5);
  const ingestProgress: IngestProgress = (stage, pageIndex, total) => {
    opts.onProgress?.(`${stage} (page ${pageIndex + 1}/${total})`, 5 + ((pageIndex + 1) / total) * 50);
  };
  const pages = await time('ingest', () => ingest(file, ingestProgress));

  const sources = new Set(pages.map((p) => p.source));
  timings[timings.length - 1].note = sources.has('TEXT_LAYER')
    ? sources.size > 1
      ? 'mixed: text layer + OCR'
      : 'text layer (no OCR needed)'
    : 'OCR';

  // Persist previews so the reviewer can show the page beside the fields.
  await time('previews', async () => {
    await Promise.all(
      pages.map(async (p) => {
        p.previewPath = await savePagePreview(opts.documentId, p.index, p.previewJpeg);
      }),
    );
  });

  // ── 2. Classify ──
  opts.onProgress?.('Identifying document type', 60);
  const classification = await time('classify', async () => classify(pages));

  const type = opts.forceType ?? classification.type;
  const typeConfidence = opts.forceType ? 1 : classification.confidence;
  const template = templateFor(type);

  if (!opts.forceType) {
    if (classification.confidence < 0.45) {
      insights.push({
        kind: 'QUALITY',
        severity: 'WARNING',
        message:
          classification.confidence <= 0
            ? 'Could not identify the document type from its contents. Fields were read using the default template — set the type manually for better results.'
            : `Document type is uncertain (${Math.round(classification.confidence * 100)}%). Best guess: ${template.label}. Check the type before committing.`,
        detail: classification.ranked,
      });
    }
    timings[timings.length - 1].note = `${template.label} @ ${Math.round(classification.confidence * 100)}%`;
  }

  // ── 3. Extract ──
  opts.onProgress?.('Extracting fields', 68);
  const previewByIndex = new Map(pages.map((p) => [p.index, p.previewJpeg]));
  const pageByIndex = new Map(pages.map((p) => [p.index, p]));
  let fields = await time('extract', () =>
    extractFields(template, pages, {
      signaturePresent: async (pageIndex, region) => {
        const img = previewByIndex.get(pageIndex);
        if (!img) return false;
        const { present } = await inkInRegion(img, region);
        return present;
      },
      reread: async (pageIndex, region) => {
        const page = pageByIndex.get(pageIndex);
        if (!page?.workBuffer) return null;
        const crop = await cropForReread(page.workBuffer, page.width, page.height, region);
        if (!crop) return null;
        const result = await recogniseLine(crop);
        return result.words.length ? { text: result.text, conf: result.confidence } : null;
      },
    }),
  );

  // ── 4. Cross-field consistency ──
  opts.onProgress?.('Checking consistency', 80);
  const cross = await time('cross-validate', async () => crossValidate(fields, type));
  insights.push(...cross.insights);

  // A contradicted field is no longer trustworthy even if it read perfectly —
  // re-score it and push it to a human.
  for (const f of fields) {
    if (cross.flagKeys.has(f.key) && f.value.trim()) {
      f.confidence = Math.min(f.confidence, 0.7);
      f.status = statusFor(f.confidence, f.valid, f.value, f.required);
    }
  }

  // ── 5. AI repair (optional, grounded) ──
  if (opts.useAI) {
    opts.onProgress?.('AI repair pass', 85);
    const refined = await time('ai-refine', () => aiRefine(template, fields, pages));
    fields = refined.fields;
    insights.push(...refined.insights);
  }

  // ── 6. Record intelligence ──
  opts.onProgress?.('Checking for duplicates', 92);
  const duplicates = await time('duplicates', () => findDuplicates(opts.schoolId, template, fields));
  insights.push(...duplicates);
  insights.push(...missingFieldInsights(fields));
  insights.push(...qualityInsights(pages));

  // A duplicate is a decision a human must make; never auto-accept into it.
  if (duplicates.some((d) => d.severity === 'CRITICAL')) {
    for (const f of fields) {
      if (f.key === 'admissionNo' || f.key === 'employeeId' || f.key === 'email') {
        f.status = f.value.trim() ? 'REVIEW' : f.status;
      }
    }
  }

  const overallConfidence = documentConfidence(fields);
  const processingMs = Date.now() - started;
  opts.onProgress?.('Done', 100);

  return {
    type,
    typeConfidence,
    pages,
    fields,
    insights,
    overallConfidence,
    rawText: pages.map((p) => p.text).join('\n\n'),
    timings,
    processingMs,
  };
}

export { TEMPLATES, TEMPLATE_CHOICES, templateFor } from './templates.js';
export { shutdownOcr } from './ocr.js';
export { AUTO_ACCEPT } from './confidence.js';
export type { ProcessResult, ExtractedValue, Insight } from './types.js';

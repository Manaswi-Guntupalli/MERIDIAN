// Lumen routes — upload, review, commit, export.
//
// Processing is asynchronous by design: OCR on a scanned page takes seconds,
// and holding an HTTP request open for a 12-file batch would time out exactly
// when the feature is being used hardest. Uploads return 202 immediately;
// progress streams over the school's socket room; the review UI updates live.
//
// Access is deliberately admin-tier only. These documents carry children's
// home addresses, medical details and guardians' phone numbers — the widest
// audience that data needs is the front office, so that is the widest audience
// it gets. Previews and originals are served through these authenticated
// routes for the same reason: nothing here sits behind a static URL.

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { emitToSchool } from '../lib/socket.js';
import { env } from '../config/env.js';
import { STAFF_ADMIN } from '../utils/constants.js';
import { processDocument, TEMPLATE_CHOICES, templateFor } from '../services/lumen/index.js';
import { commitDocument } from '../services/lumen/commit.js';
import { toCSV, toJSONExport, toXLSX, type ExportableDoc } from '../services/lumen/export.js';
import { saveOriginal, readOriginal, readPagePreview, purgeDocument, sniffFile } from '../services/lumen/storage.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 12 },
});

// ────────────────────────  background queue  ────────────────────────
//
// A tiny in-process queue, deliberately not a job framework: SQLite is the
// datastore and one OCR pool is the bottleneck, so "run two at a time, in
// order" is the whole requirement. Documents survive restarts as QUEUED rows;
// anything caught mid-flight by a crash is marked FAILED with an honest
// message rather than left showing a spinner forever.

interface Job {
  documentId: string;
  schoolId: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  forceType?: string;
}

const queue: Job[] = [];
let active = 0;
const CONCURRENCY = 2;

async function runJob(job: Job): Promise<void> {
  const { documentId, schoolId } = job;
  const progress = (stage: string, pct: number) =>
    emitToSchool(schoolId, 'lumen:progress', { documentId, stage, pct: Math.round(pct) });

  try {
    await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING' } });
    progress('Starting', 2);

    const result = await processDocument(
      { buffer: job.buffer, mimeType: job.mimeType, fileName: job.fileName },
      { schoolId, documentId, forceType: job.forceType, useAI: env.aiEnabled, onProgress: progress },
    );

    const needsReview = result.fields.some((f) => f.status === 'REVIEW' || f.status === 'MISSING');
    const status = needsReview ? 'REVIEW' : 'VERIFIED';

    await prisma.$transaction([
      prisma.extractedField.deleteMany({ where: { documentId } }),
      prisma.documentPage.deleteMany({ where: { documentId } }),
      prisma.documentInsight.deleteMany({ where: { documentId } }),
      prisma.extractedField.createMany({
        data: result.fields.map((f) => ({
          documentId,
          key: f.key,
          label: f.label,
          value: f.value,
          rawValue: f.rawValue || null,
          confidence: f.confidence,
          ocrConfidence: f.ocrConfidence,
          page: f.page,
          cropX: f.crop.x,
          cropY: f.crop.y,
          cropW: f.crop.w,
          cropH: f.crop.h,
          status: f.status,
          source: f.source,
          valid: f.valid,
          validationMessage: f.validationMessage ?? null,
          corrected: f.corrected,
          required: f.required,
        })),
      }),
      prisma.documentPage.createMany({
        data: result.pages.map((p) => ({
          documentId,
          index: p.index,
          width: p.width,
          height: p.height,
          source: p.source,
          rotation: p.rotation,
          skewDeg: p.skewDeg,
          ocrConfidence: p.ocrConfidence,
          quality: JSON.stringify(p.quality),
        })),
      }),
      prisma.documentInsight.createMany({
        data: result.insights.map((i) => ({
          documentId,
          kind: i.kind,
          severity: i.severity,
          message: i.message,
          detailString: i.detail ? JSON.stringify(i.detail) : null,
        })),
      }),
      prisma.document.update({
        where: { id: documentId },
        data: {
          status,
          type: result.type,
          typeConfidence: result.typeConfidence,
          overallConfidence: result.overallConfidence,
          pageCount: result.pages.length,
          processingMs: result.processingMs,
          rawText: result.rawText.slice(0, 40000),
          pipelineString: JSON.stringify({ timings: result.timings }),
          errorMessage: null,
        },
      }),
    ]);

    await logAI({
      schoolId,
      engine: 'LUMEN',
      action: 'Document extraction',
      reason:
        `${templateFor(result.type).label}: ${result.fields.filter((f) => f.value).length}/${result.fields.length} fields read, ` +
        `${Math.round(result.overallConfidence * 100)}% confidence, ` +
        `${result.pages.every((p) => p.source === 'TEXT_LAYER') ? 'digital text layer' : 'OCR pipeline'}, ${result.processingMs}ms`,
      confidence: result.overallConfidence,
      input: { fileName: job.fileName, pages: result.pages.length },
      output: { type: result.type, needsReview, insights: result.insights.length },
    });
    await recordEvent({
      schoolId,
      type: 'DOCUMENT_PROCESSED',
      aggregate: 'Document',
      aggregateId: documentId,
      payload: { documentId, type: result.type, overallConfidence: result.overallConfidence },
    });
    await prisma.documentActivity.create({
      data: {
        documentId,
        kind: 'PROCESSED',
        detailString: JSON.stringify({
          type: result.type,
          typeLabel: templateFor(result.type).label,
          confidence: result.overallConfidence,
          ms: result.processingMs,
          pages: result.pages.length,
          engine: result.pages.every((p) => p.source === 'TEXT_LAYER') ? 'digital text layer' : 'OCR pipeline',
          fieldsRead: result.fields.filter((f) => f.value).length,
          fieldsTotal: result.fields.length,
        }),
      },
    }).catch(() => {});

    emitToSchool(schoolId, 'lumen:done', { documentId, status, overallConfidence: result.overallConfidence });
  } catch (err) {
    const message = (err as Error).message || 'Processing failed';
    console.error(`[lumen] ${documentId} failed:`, err);
    await prisma.document
      .update({ where: { id: documentId }, data: { status: 'FAILED', errorMessage: message } })
      .catch(() => {});
    await prisma.documentActivity
      .create({ data: { documentId, kind: 'FAILED', detailString: JSON.stringify({ message }) } })
      .catch(() => {});
    emitToSchool(schoolId, 'lumen:done', { documentId, status: 'FAILED', error: message });
  }
}

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active++;
    void runJob(job).finally(() => {
      active--;
      pump();
    });
  }
}

// Crash recovery: a document stuck in QUEUED/PROCESSING after a restart will
// never finish (its buffer lived in the dead process's memory). Say so.
void prisma.document
  .updateMany({
    where: { status: { in: ['QUEUED', 'PROCESSING'] } },
    data: { status: 'FAILED', errorMessage: 'Interrupted by a server restart — please upload this file again.' },
  })
  .then((r) => {
    if (r.count) console.log(`[lumen] marked ${r.count} interrupted document(s) as failed after restart`);
  })
  .catch(() => {});

// ─────────────────────────────  reads  ─────────────────────────────

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const docs = await prisma.document.findMany({
      where: { schoolId: req.user!.schoolId },
      include: { fields: { select: { status: true } }, insights: { select: { severity: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        type: d.type,
        typeLabel: templateFor(d.type).label,
        fileName: d.fileName,
        status: d.status,
        overallConfidence: d.overallConfidence,
        typeConfidence: d.typeConfidence,
        pageCount: d.pageCount,
        processingMs: d.processingMs,
        createdAt: d.createdAt,
        committedKind: d.committedKind,
        fieldCount: d.fields.length,
        needsReview: d.fields.filter((f) => f.status === 'REVIEW' || f.status === 'MISSING').length,
        criticalInsights: d.insights.filter((i) => i.severity === 'CRITICAL').length,
        errorMessage: d.errorMessage,
      })),
    });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [total, byStatus, docs] = await Promise.all([
      prisma.document.count({ where: { schoolId } }),
      prisma.document.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
      prisma.document.findMany({
        where: { schoolId, status: { in: ['REVIEW', 'VERIFIED', 'COMMITTED'] } },
        select: { overallConfidence: true, processingMs: true, correctionCount: true, createdAt: true },
      }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const processed = docs.length;
    const avgConfidence = processed ? docs.reduce((a, d) => a + d.overallConfidence, 0) / processed : 0;
    const avgMs = processed ? Math.round(docs.reduce((a, d) => a + d.processingMs, 0) / processed) : 0;
    const corrections = docs.reduce((a, d) => a + d.correctionCount, 0);
    const fieldsConfirmed = await prisma.extractedField.count({
      where: { document: { schoolId }, status: 'CONFIRMED' },
    });
    // ~90 seconds saved per document versus hand-typing a form into the ERP —
    // a deliberate, stated assumption, not a measurement.
    const timeSavedMinutes = Math.round((processed * 90) / 60);
    res.json({
      stats: {
        total,
        queued: (counts.QUEUED ?? 0) + (counts.PROCESSING ?? 0),
        needsReview: counts.REVIEW ?? 0,
        verified: counts.VERIFIED ?? 0,
        committed: counts.COMMITTED ?? 0,
        failed: counts.FAILED ?? 0,
        successRate: total ? (total - (counts.FAILED ?? 0)) / total : 1,
        avgConfidence,
        avgMs,
        corrections: corrections + fieldsConfirmed,
        timeSavedMinutes,
      },
    });
  }),
);

router.get('/templates', (_req, res) => {
  res.json({ templates: TEMPLATE_CHOICES });
});

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      include: {
        fields: { orderBy: [{ page: 'asc' }, { confidence: 'asc' }] },
        pages: { orderBy: { index: 'asc' } },
        insights: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!doc) throw notFound('Document not found');
    res.json({
      document: {
        ...doc,
        typeLabel: templateFor(doc.type).label,
        commits: templateFor(doc.type).commits ?? null,
        pipeline: doc.pipelineString ? JSON.parse(doc.pipelineString) : null,
        pipelineString: undefined,
        rawText: undefined, // heavy; fetch via /:id/text if ever needed
        pages: doc.pages.map((p) => ({ ...p, quality: p.quality ? JSON.parse(p.quality) : null, wordsString: undefined })),
        insights: doc.insights.map((i) => ({ ...i, detail: i.detailString ? JSON.parse(i.detailString) : null, detailString: undefined })),
      },
    });
  }),
);

// Page preview JPEG — authenticated, same-school only.
router.get(
  '/:id/page/:index',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      select: { id: true },
    });
    if (!doc) throw notFound('Document not found');
    const jpeg = await readPagePreview(doc.id, Number(req.params.index));
    if (!jpeg) throw notFound('Page preview not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(jpeg);
  }),
);

router.get(
  '/:id/original',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      select: { id: true, fileName: true, mimeType: true },
    });
    if (!doc) throw notFound('Document not found');
    const original = await readOriginal(doc.id);
    if (!original) throw notFound('Original file not found');
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`);
    res.send(original.buffer);
  }),
);

// ─────────────────────────────  upload  ─────────────────────────────

// The document's full life story, oldest first — what the Processing History
// timeline renders. Kept out of the main detail payload so opening a document
// stays light; the UI fetches this only when the History tab is opened.
router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      select: { id: true },
    });
    if (!doc) throw notFound('Document not found');
    const entries = await prisma.documentActivity.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.json({
      history: entries.map((a) => ({
        id: a.id,
        kind: a.kind,
        actorName: a.actorName,
        detail: a.detailString ? JSON.parse(a.detailString) : null,
        createdAt: a.createdAt,
      })),
    });
  }),
);

router.post(
  '/upload',
  upload.array('files', 12),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw badRequest('No files were uploaded. Attach at least one PDF or image.');

    const forceType = typeof req.body.type === 'string' && req.body.type !== 'AUTO' ? req.body.type : undefined;
    const batchId = `batch_${Date.now().toString(36)}`;

    // Validate every file's actual bytes BEFORE anything is stored: extensions
    // and MIME types are claims, magic bytes are evidence. Rejecting the whole
    // batch on the first liar keeps "some of your files uploaded" ambiguity
    // out of the clerk's day — the error names the file, they fix it, retry.
    for (const file of files) sniffFile(file.buffer, file.originalname);

    const created = [];
    for (const file of files) {
      const doc = await prisma.document.create({
        data: {
          schoolId,
          type: forceType ?? 'ADMISSION', // provisional; the classifier decides
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          status: 'QUEUED',
          batchId,
          uploadedById: req.user!.sub,
        },
      });
      await saveOriginal(doc.id, file.originalname, file.buffer);
      await prisma.documentActivity.create({
        data: {
          documentId: doc.id,
          kind: 'UPLOADED',
          actorId: req.user!.sub,
          actorName: req.user!.name,
          detailString: JSON.stringify({ fileName: file.originalname, sizeBytes: file.size, forcedType: forceType ?? null }),
        },
      });
      queue.push({
        documentId: doc.id,
        schoolId,
        buffer: file.buffer,
        mimeType: file.mimetype,
        fileName: file.originalname,
        forceType,
      });
      created.push({ id: doc.id, fileName: doc.fileName, status: doc.status });
    }
    pump();

    // 202: accepted, working on it. Progress arrives over the socket.
    res.status(202).json({ batchId, documents: created });
  }),
);

// Re-run the pipeline from the stored original — used to override a wrong
// type guess, or to retry after a fix. Wipes and rebuilds the extraction.
const reprocessSchema = z.object({ type: z.string().optional() });
router.post(
  '/:id/reprocess',
  asyncHandler(async (req, res) => {
    const { type } = reprocessSchema.parse(req.body ?? {});
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
    });
    if (!doc) throw notFound('Document not found');
    if (doc.status === 'COMMITTED') throw badRequest('This document has been committed — undo the commit before reprocessing.');
    if (type && !TEMPLATE_CHOICES.some((t) => t.type === type)) throw badRequest(`Unknown document type "${type}".`);

    const original = await readOriginal(doc.id);
    if (!original) throw badRequest('The original file is no longer stored — please upload it again.');

    await prisma.document.update({ where: { id: doc.id }, data: { status: 'QUEUED', errorMessage: null } });
    await prisma.documentActivity.create({
      data: {
        documentId: doc.id,
        kind: 'REPROCESSED',
        actorId: req.user!.sub,
        actorName: req.user!.name,
        detailString: JSON.stringify({ forcedType: type ?? null }),
      },
    });
    queue.push({
      documentId: doc.id,
      schoolId: doc.schoolId,
      buffer: original.buffer,
      mimeType: doc.mimeType,
      fileName: doc.fileName,
      forceType: type,
    });
    pump();
    res.status(202).json({ ok: true });
  }),
);

// ─────────────────────────────  review  ─────────────────────────────

const confirmSchema = z.object({ value: z.string().max(500).optional() });
router.patch(
  '/field/:fieldId',
  asyncHandler(async (req, res) => {
    const parsed = confirmSchema.parse(req.body);
    const owned = await prisma.extractedField.findFirst({
      where: { id: req.params.fieldId, document: { schoolId: req.user!.schoolId } },
      include: { document: { select: { id: true, status: true } } },
    });
    if (!owned) throw notFound('Field not found in your school');
    if (owned.document.status === 'COMMITTED') {
      throw badRequest('This document has been committed — undo the commit before editing fields.');
    }

    const valueChanged = parsed.value !== undefined && parsed.value !== owned.value;
    const field = await prisma.extractedField.update({
      where: { id: owned.id },
      // A human said so: that is the definition of confidence 1. But keep the
      // machine's read in rawValue so the audit trail survives the correction.
      data: {
        status: 'CONFIRMED',
        valid: true,
        validationMessage: null,
        ...(valueChanged ? { value: parsed.value, confidence: 1, corrected: true } : { confidence: 1 }),
      },
    });
    if (valueChanged) {
      await prisma.document.update({
        where: { id: owned.document.id },
        data: { correctionCount: { increment: 1 } },
      });
    }
    // The timeline distinguishes "human fixed the value" from "human agreed
    // with the machine" — the correction count the history shows is the
    // former, and the distinction is exactly what an auditor asks about.
    await prisma.documentActivity.create({
      data: {
        documentId: owned.document.id,
        kind: valueChanged ? 'FIELD_CORRECTED' : 'FIELD_CONFIRMED',
        actorId: req.user!.sub,
        actorName: req.user!.name,
        detailString: JSON.stringify(
          valueChanged ? { label: owned.label, from: owned.value, to: parsed.value } : { label: owned.label, value: owned.value },
        ),
      },
    });

    const remaining = await prisma.extractedField.count({
      where: { documentId: field.documentId, status: { in: ['REVIEW', 'MISSING'] } },
    });
    if (remaining === 0 && owned.document.status !== 'VERIFIED') {
      await prisma.document.update({ where: { id: field.documentId }, data: { status: 'VERIFIED' } });
      await recordEvent({
        schoolId: req.user!.schoolId,
        type: 'DOCUMENT_VERIFIED',
        aggregate: 'Document',
        aggregateId: field.documentId,
        payload: { documentId: field.documentId },
        actorId: req.user!.sub,
        actorName: req.user!.name,
      });
      await prisma.documentActivity.create({
        data: { documentId: field.documentId, kind: 'VERIFIED', actorId: req.user!.sub, actorName: req.user!.name },
      });
    }
    res.json({ field, verified: remaining === 0 });
  }),
);

// ─────────────────────────────  commit  ─────────────────────────────

router.post(
  '/:id/commit',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    // The record, the status flip, the Trust event and the activity entry all
    // land inside commitDocument's single transaction — this route only
    // announces the outcome once it is durably true.
    const result = await commitDocument(req.params.id, schoolId, { id: req.user!.sub, name: req.user!.name });
    result.emitEvent();

    await logAI({
      schoolId,
      engine: 'LUMEN',
      action: 'Record committed',
      reason: `${result.summary}. ${result.notes.join(' ')}`.trim(),
      confidence: 1,
      input: { documentId: req.params.id },
      output: { kind: result.kind, id: result.id },
      actorId: req.user!.sub,
    });
    res.json({ committed: result });
  }),
);

// ─────────────────────────────  export  ─────────────────────────────

const exportSchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']),
  ids: z.array(z.string()).max(200).optional(),
});
router.post(
  '/export',
  asyncHandler(async (req, res) => {
    const { format, ids } = exportSchema.parse(req.body);
    const docs = await prisma.document.findMany({
      where: {
        schoolId: req.user!.schoolId,
        status: { in: ['REVIEW', 'VERIFIED', 'COMMITTED'] },
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      include: { fields: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!docs.length) throw badRequest('Nothing to export yet — process at least one document first.');

    const exportable: ExportableDoc[] = docs.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      type: templateFor(d.type).label,
      status: d.status,
      overallConfidence: d.overallConfidence,
      createdAt: d.createdAt,
      fields: d.fields.map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        confidence: f.confidence,
        status: f.status,
        corrected: f.corrected,
      })),
    }));

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="lumen-export-${stamp}.csv"`);
      res.send(toCSV(exportable));
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="lumen-export-${stamp}.json"`);
      res.send(toJSONExport(exportable));
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="lumen-export-${stamp}.xlsx"`);
      res.send(await toXLSX(exportable));
    }
  }),
);

// ─────────────────────────────  delete  ─────────────────────────────

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      select: { id: true, status: true, fileName: true },
    });
    if (!doc) throw notFound('Document not found');
    if (doc.status === 'COMMITTED') {
      throw badRequest('This document has been committed — undo the commit first so the record and its source stay consistent.');
    }
    await prisma.document.delete({ where: { id: doc.id } }); // cascades fields/pages/insights
    await purgeDocument(doc.id);
    res.json({ ok: true });
  }),
);

export default router;

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { extractDocument } from '../services/lumen.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const docs = await prisma.document.findMany({
      where: { schoolId: req.user!.schoolId },
      include: { fields: true },
      orderBy: { createdAt: 'desc' },
    });
    // Review queue sorted worst-first (lowest confidence).
    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        type: d.type,
        fileName: d.fileName,
        status: d.status,
        overallConfidence: d.overallConfidence,
        createdAt: d.createdAt,
        fieldCount: d.fields.length,
        needsReview: d.fields.filter((f) => f.status === 'REVIEW').length,
      })),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      include: { fields: { orderBy: { confidence: 'asc' } } },
    });
    if (!doc) throw notFound('Document not found');
    res.json({ document: doc });
  }),
);

// Upload + extract. Accepts a file, or just a `type` for a quick demo.
router.post(
  '/upload',
  authorize(...STAFF_ADMIN),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const type = (req.body.type as string) || 'ADMISSION';
    const fileName = req.file?.originalname || `${type.toLowerCase()}-scan.jpg`;

    const doc = await prisma.document.create({
      data: { schoolId, type, fileName, status: 'PROCESSING', uploadedById: req.user!.sub },
    });

    const { fields, overallConfidence } = extractDocument(type, doc.createdAt.getTime());
    await prisma.extractedField.createMany({
      data: fields.map((f) => ({
        documentId: doc.id,
        key: f.key,
        label: f.label,
        value: f.value,
        confidence: f.confidence,
        cropX: f.crop.x,
        cropY: f.crop.y,
        cropW: f.crop.w,
        cropH: f.crop.h,
        status: f.status,
      })),
    });
    const needsReview = fields.some((f) => f.status === 'REVIEW');
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { status: needsReview ? 'REVIEW' : 'VERIFIED', overallConfidence },
      include: { fields: { orderBy: { confidence: 'asc' } } },
    });

    await logAI({
      schoolId,
      engine: 'LUMEN',
      action: 'Document extraction',
      reason: `Layout-aware parse + schema mapping. ${fields.length} fields, ${Math.round(overallConfidence * 100)}% avg confidence`,
      confidence: overallConfidence,
      input: { type, fileName },
      output: { fields: fields.length, needsReview },
      actorId: req.user!.sub,
    });
    await recordEvent({
      schoolId,
      type: 'DOCUMENT_PROCESSED',
      aggregate: 'Document',
      aggregateId: doc.id,
      payload: { documentId: doc.id, type, overallConfidence },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });

    res.status(201).json({ document: updated });
  }),
);

// Confirm a reviewed field (human-in-the-loop).
const confirmSchema = z.object({ value: z.string().optional() });
router.patch(
  '/field/:fieldId',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = confirmSchema.parse(req.body);
    const field = await prisma.extractedField.update({
      where: { id: req.params.fieldId },
      data: { status: 'CONFIRMED', ...(parsed.value ? { value: parsed.value, confidence: 1 } : {}) },
    });
    // If all fields resolved, mark the doc verified.
    const remaining = await prisma.extractedField.count({ where: { documentId: field.documentId, status: 'REVIEW' } });
    if (remaining === 0) {
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
    }
    res.json({ field, verified: remaining === 0 });
  }),
);

export default router;

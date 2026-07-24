import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { auditLog } from '../services/trustLedger.js';
import { STAFF, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
// Any staff may view students; create/update/delete stay admin-only (per-route).
router.use(authorize(...STAFF));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { classId, q } = req.query as { classId?: string; q?: string };
    const students = await prisma.student.findMany({
      where: {
        schoolId,
        ...(classId ? { classId } : {}),
        ...(q ? { name: { contains: q } } : {}),
      },
      include: { class: true },
      orderBy: [{ class: { name: 'asc' } }, { rollNo: 'asc' }],
    });
    res.json({ students });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      include: {
        class: true,
        fees: true,
        parents: { include: { parent: { include: { user: true } } } },
        attendance: { orderBy: { date: 'desc' }, take: 30 },
      },
    });
    if (!student) throw notFound('Student not found');
    res.json({ student });
  }),
);

const createSchema = z.object({
  name: z.string().min(2),
  rollNo: z.number().int().positive(),
  admissionNo: z.string().min(1),
  classId: z.string().optional(),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
});

router.post(
  '/',
  authorize(...STAFF_ADMIN),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof createSchema>;
    const student = await prisma.student.create({ data: { schoolId, ...body } });
    await recordEvent({
      schoolId,
      type: 'STUDENT_CREATED',
      aggregate: 'Student',
      aggregateId: student.id,
      payload: { studentId: student.id, name: student.name },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    await auditLog({ schoolId, actorId: req.user!.sub, action: 'CREATE', entity: 'Student', entityId: student.id });
    res.status(201).json({ student });
  }),
);

const updateSchema = createSchema.partial().extend({ active: z.boolean().optional() });

router.patch(
  '/:id',
  authorize(...STAFF_ADMIN),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const existing = await prisma.student.findFirst({ where: { id: req.params.id, schoolId } });
    if (!existing) throw notFound('Student not found');
    const student = await prisma.student.update({ where: { id: existing.id }, data: req.body });
    await recordEvent({
      schoolId,
      type: 'STUDENT_UPDATED',
      aggregate: 'Student',
      aggregateId: student.id,
      payload: { before: existing, after: student },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.json({ student });
  }),
);

router.delete(
  '/:id',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const existing = await prisma.student.findFirst({ where: { id: req.params.id, schoolId } });
    if (!existing) throw notFound('Student not found');
    await prisma.attendance.deleteMany({ where: { studentId: existing.id } });
    await prisma.studentParent.deleteMany({ where: { studentId: existing.id } });
    await prisma.student.delete({ where: { id: existing.id } });
    await auditLog({ schoolId, actorId: req.user!.sub, action: 'DELETE', entity: 'Student', entityId: existing.id });
    res.json({ ok: true });
  }),
);

export default router;

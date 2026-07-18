import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { fromJson } from '../lib/json.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: req.user!.schoolId },
      include: { user: true, classesLed: true, _count: { select: { slots: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    res.json({
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.user.name,
        email: t.user.email,
        employeeId: t.employeeId,
        department: t.department,
        qualification: t.qualification,
        maxHours: t.maxHours,
        weeklyHours: t.weeklyHours,
        subjects: fromJson<string[]>(t.subjectsString, []),
        classesLed: t.classesLed.map((c) => c.name),
        load: Math.round((t.weeklyHours / t.maxHours) * 100),
        overloaded: t.weeklyHours >= t.maxHours - 1,
      })),
    });
  }),
);

// Mark a staff member absent for a date (drives cover / substitution flow).
const absenceSchema = z.object({ teacherId: z.string(), date: z.string(), reason: z.string().optional() });
router.post(
  '/absence',
  authorize(...STAFF_ADMIN),
  validateBody(absenceSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { teacherId, date, reason } = req.body as z.infer<typeof absenceSchema>;
    const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId }, include: { user: true } });
    if (!teacher) throw notFound('Teacher not found');
    // Idempotent: marking the same teacher absent twice must not error.
    const absence = await prisma.staffAbsence.upsert({
      where: { teacherId_date: { teacherId, date } },
      create: { teacherId, date, reason },
      update: { reason },
    });

    // Ask the Kairos substitute engine for a real suggestion (qualified,
    // free that period, within load limits) rather than just least-loaded.
    const { planSubstitutes } = await import('../services/kairos/index.js');
    const plan = await planSubstitutes(schoolId, teacherId, date);
    const first = plan.suggestions.find((s) => s.candidate)?.candidate ?? null;
    const suggestion = first
      ? await prisma.teacher.findUnique({ where: { id: first.teacherId }, include: { user: true } })
      : null;

    await recordEvent({
      schoolId,
      type: 'STAFF_ABSENCE',
      aggregate: 'Teacher',
      aggregateId: teacherId,
      payload: { absenceId: absence.id, teacher: teacher.user.name, date },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });

    res.status(201).json({
      absence,
      suggestion: suggestion
        ? { teacherId: suggestion.id, name: suggestion.user.name, load: suggestion.weeklyHours }
        : null,
    });
  }),
);

export default router;

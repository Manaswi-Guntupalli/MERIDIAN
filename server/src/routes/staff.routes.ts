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
    const absence = await prisma.staffAbsence.create({ data: { teacherId, date, reason } });

    // Suggest a substitute: least-loaded qualified teacher not already absent.
    const candidates = await prisma.teacher.findMany({
      where: { schoolId, id: { not: teacherId } },
      include: { user: true },
      orderBy: { weeklyHours: 'asc' },
    });
    const suggestion = candidates[0];

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

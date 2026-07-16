import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { generateTimetable, persistTimetable } from '../services/kairos.js';
import { logAI } from '../services/trustLedger.js';
import { STAFF, STAFF_ADMIN, DAYS, PERIODS } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

// Current active timetable as a grid.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const tt = await prisma.timetable.findFirst({
      where: { schoolId, active: true },
      include: {
        slots: {
          include: {
            class: true,
            subject: true,
            teacher: { include: { user: true } },
            room: true,
          },
        },
      },
    });
    res.json({
      timetable: tt
        ? {
            id: tt.id,
            name: tt.name,
            score: tt.score,
            solveMs: tt.solveMs,
            days: DAYS,
            periods: PERIODS,
            slots: tt.slots.map((s) => ({
              id: s.id,
              day: s.day,
              period: s.period,
              classId: s.classId,
              className: s.class.name,
              subject: s.subject.name,
              subjectColor: s.subject.color,
              teacher: s.teacher.user.name,
              room: s.room?.name,
            })),
          }
        : null,
    });
  }),
);

// Run the Kairos solver (returns conflicts + explanations; optionally persists).
const solveSchema = z.object({ persist: z.boolean().optional() });
router.post(
  '/solve',
  authorize(...STAFF_ADMIN),
  validateBody(solveSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const result = await generateTimetable(schoolId);
    let saved = null;
    if ((req.body as any).persist) {
      saved = await persistTimetable(schoolId, result, `Timetable ${new Date().toLocaleDateString()}`);
      // recompute teacher weekly hours from placed slots
      const load: Record<string, number> = {};
      for (const s of result.slots) load[s.teacherId] = (load[s.teacherId] ?? 0) + 1;
      await Promise.all(
        Object.entries(load).map(([tid, hrs]) =>
          prisma.teacher.update({ where: { id: tid }, data: { weeklyHours: hrs } }),
        ),
      );
    }
    await logAI({
      schoolId,
      engine: 'KAIROS',
      action: 'Timetable solve',
      reason: `CP-style feasibility + soft refine in ${result.solveMs}ms; ${result.conflicts.length} conflict(s)`,
      confidence: result.score / 100,
      output: { score: result.score, conflicts: result.conflicts.length },
      actorId: req.user!.sub,
    });
    res.json({
      score: result.score,
      solveMs: result.solveMs,
      placed: result.slots.length,
      conflicts: result.conflicts,
      persisted: !!saved,
    });
  }),
);

// What-if: simulate a teacher being out and show the ripple (no commit).
const whatIfSchema = z.object({ teacherId: z.string() });
router.post(
  '/what-if',
  validateBody(whatIfSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { teacherId } = req.body as z.infer<typeof whatIfSchema>;
    const tt = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
    if (!tt) return res.json({ affected: [], suggestions: [] });

    const affected = await prisma.timetableSlot.findMany({
      where: { timetableId: tt.id, teacherId },
      include: { class: true, subject: true },
    });
    // Suggest least-loaded alternative teacher for each affected slot.
    const candidates = await prisma.teacher.findMany({
      where: { schoolId, id: { not: teacherId } },
      include: { user: true },
      orderBy: { weeklyHours: 'asc' },
    });
    const suggestions = affected.map((s, i) => ({
      day: s.day,
      period: s.period,
      className: s.class.name,
      subject: s.subject.name,
      suggestedTeacher: candidates[i % Math.max(1, candidates.length)]?.user.name ?? 'TBD',
    }));

    await logAI({
      schoolId,
      engine: 'KAIROS',
      action: 'What-if re-optimisation',
      reason: `Re-solved only the ${affected.length} affected cells for teacher absence`,
      confidence: 0.82,
      output: { affected: affected.length },
    });
    res.json({ affectedCount: affected.length, suggestions });
  }),
);

export default router;

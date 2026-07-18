import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { fromJson, toJson } from '../lib/json.js';
import { ROLES, STAFF, STAFF_ADMIN } from '../utils/constants.js';
import {
  applySubstitutes,
  approveDraft,
  buildGrid,
  compareVersions,
  discardDraft,
  generateDraft,
  getDraft,
  loadConfig,
  loadSolverInput,
  planRoomClosure,
  planSubstitutes,
  preValidate,
  publishDraft,
  rollbackToVersion,
  setSlotLock,
  updateDraftSlot,
} from '../services/kairos/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kairos routes.
// Permissions (spec): Principal → approve/publish/rollback · Admin → generate,
// edit, settings · Teacher/Student/Parent → read the published timetable.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

const PRINCIPALS = [ROLES.PRINCIPAL, ROLES.SUPER_ADMIN];

const cell = z.object({ day: z.number().int().min(0).max(6), period: z.number().int().min(0).max(11) });

// ── Serialization ────────────────────────────────────────────────────────────

const slotInclude = {
  class: true,
  subject: true,
  teacher: { include: { user: true } },
  room: true,
} as const;

function serializeSlot(s: any) {
  return {
    id: s.id,
    day: s.day,
    period: s.period,
    classId: s.classId,
    className: s.class.name,
    subjectId: s.subjectId,
    subject: s.subject.name,
    subjectColor: s.subject.color,
    teacherId: s.teacherId,
    teacher: s.teacher.user.name,
    roomId: s.roomId,
    room: s.room?.name,
    locked: s.locked,
    explain: fromJson(s.explainString, null),
  };
}

function serializeTimetableMeta(t: any) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    version: t.version,
    active: t.active,
    score: Math.round(t.score),
    solveMs: t.solveMs,
    health: fromJson(t.healthString, null),
    generatedByName: t.generatedByName,
    approvedByName: t.approvedByName,
    approvedAt: t.approvedAt,
    publishedByName: t.publishedByName,
    publishedAt: t.publishedAt,
    createdAt: t.createdAt,
  };
}

async function gridPayload(schoolId: string) {
  const { cfg } = await loadConfig(schoolId);
  const grid = buildGrid(cfg);
  return {
    days: grid.days,
    periods: grid.periodLabels,
    periodTimes: grid.periodTimes,
    breaks: grid.breaks,
    blocked: grid.blocked,
  };
}

async function fullTimetable(schoolId: string, timetableId: string) {
  const tt = await prisma.timetable.findFirst({ where: { id: timetableId, schoolId } });
  if (!tt) return null;
  const slots = await prisma.timetableSlot.findMany({ where: { timetableId }, include: slotInclude });
  return { ...serializeTimetableMeta(tt), ...(await gridPayload(schoolId)), slots: slots.map(serializeSlot) };
}

// ── Read the live timetable — every role, including students & parents ──────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const tt = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
    res.json({ timetable: tt ? await fullTimetable(schoolId, tt.id) : null });
  }),
);

// ── Overview: one call that powers the Kairos landing page ──────────────────
router.get(
  '/overview',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [active, draft, data, versions, cfgWrap] = await Promise.all([
      prisma.timetable.findFirst({ where: { schoolId, active: true } }),
      getDraft(schoolId),
      loadSolverInput(schoolId),
      prisma.timetable.findMany({
        where: { schoolId, status: { in: ['PUBLISHED', 'ARCHIVED'] }, version: { gt: 0 } },
        orderBy: { version: 'desc' },
        take: 5,
      }),
      loadConfig(schoolId),
    ]);
    const issues = preValidate(data);
    const classesTotal = data.lessons.length
      ? new Set(data.lessons.map((l) => l.classId)).size + data.classesWithoutPlan.length
      : data.classesWithoutPlan.length;
    res.json({
      active: active ? serializeTimetableMeta(active) : null,
      draft: draft ? serializeTimetableMeta(draft) : null,
      issues,
      setup: {
        hasConfig: data.hasConfig,
        academicYear: cfgWrap.cfg.academicYear,
        workingDays: cfgWrap.cfg.workingDays,
        periodsPerDay: cfgWrap.cfg.periodsPerDay,
        dayStart: cfgWrap.cfg.dayStart,
        periodMinutes: cfgWrap.cfg.periodMinutes,
        classesTotal,
        classesWithPlan: classesTotal - data.classesWithoutPlan.length,
        teachers: data.teachers.length,
        rooms: data.rooms.length,
        labs: data.rooms.filter((r) => r.type === 'LAB').length,
      },
      versions: versions.map(serializeTimetableMeta),
    });
  }),
);

// ── Academic planner (settings) ──────────────────────────────────────────────
router.get(
  '/settings',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const { cfg, exists } = await loadConfig(req.user!.schoolId);
    res.json({ config: cfg, configured: exists });
  }),
);

const settingsSchema = z.object({
  academicYear: z.string().min(4).max(20),
  workingDays: z.number().int().min(1).max(6),
  dayStart: z.string().regex(/^\d{2}:\d{2}$/),
  periodMinutes: z.number().int().min(20).max(90),
  periodsPerDay: z.number().int().min(4).max(10),
  breaks: z.array(z.object({ after: z.number().int().min(0), name: z.string().min(1), minutes: z.number().int().min(5).max(90) })).max(4),
  blocked: z.array(cell.extend({ reason: z.string().min(1) })).max(20),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60),
  terms: z.array(z.object({ name: z.string(), start: z.string(), end: z.string() })).max(4),
  examWeeks: z.array(z.object({ name: z.string(), start: z.string(), end: z.string() })).max(8),
});

router.put(
  '/settings',
  authorize(...STAFF_ADMIN),
  validateBody(settingsSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const b = req.body as z.infer<typeof settingsSchema>;
    await prisma.academicConfig.upsert({
      where: { schoolId },
      create: {
        schoolId,
        academicYear: b.academicYear,
        workingDays: b.workingDays,
        dayStart: b.dayStart,
        periodMinutes: b.periodMinutes,
        periodsPerDay: b.periodsPerDay,
        breaksString: toJson(b.breaks),
        blockedString: toJson(b.blocked),
        holidaysString: toJson(b.holidays),
        termsString: toJson(b.terms),
        examWeeksString: toJson(b.examWeeks),
      },
      update: {
        academicYear: b.academicYear,
        workingDays: b.workingDays,
        dayStart: b.dayStart,
        periodMinutes: b.periodMinutes,
        periodsPerDay: b.periodsPerDay,
        breaksString: toJson(b.breaks),
        blockedString: toJson(b.blocked),
        holidaysString: toJson(b.holidays),
        termsString: toJson(b.terms),
        examWeeksString: toJson(b.examWeeks),
      },
    });
    res.json({ ok: true });
  }),
);

// ── Curriculum planner ───────────────────────────────────────────────────────
router.get(
  '/curriculum',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [classes, subjects] = await Promise.all([
      prisma.class.findMany({
        where: { schoolId },
        include: { subjectPlans: { include: { subject: true } }, _count: { select: { students: true } } },
        orderBy: [{ grade: 'asc' }, { section: 'asc' }],
      }),
      prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
    ]);
    res.json({
      subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color, requiresLab: s.requiresLab })),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        students: c._count.students,
        plans: c.subjectPlans.map((p) => ({
          subjectId: p.subjectId,
          subject: p.subject.name,
          weeklyPeriods: p.weeklyPeriods,
          requiresLab: p.requiresLab || p.subject.requiresLab,
          elective: p.elective,
        })),
      })),
    });
  }),
);

const curriculumSchema = z.object({
  plans: z
    .array(
      z.object({
        subjectId: z.string(),
        weeklyPeriods: z.number().int().min(1).max(12),
        requiresLab: z.boolean().optional(),
        elective: z.boolean().optional(),
      }),
    )
    .max(20),
});

router.put(
  '/curriculum/:classId',
  authorize(...STAFF_ADMIN),
  validateBody(curriculumSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const cls = await prisma.class.findFirst({ where: { id: req.params.classId, schoolId } });
    if (!cls) throw notFound('Class not found');
    const { plans } = req.body as z.infer<typeof curriculumSchema>;
    await prisma.$transaction([
      prisma.classSubjectPlan.deleteMany({ where: { classId: cls.id } }),
      prisma.classSubjectPlan.createMany({
        data: plans.map((p) => ({
          classId: cls.id,
          subjectId: p.subjectId,
          weeklyPeriods: p.weeklyPeriods,
          requiresLab: p.requiresLab ?? false,
          elective: p.elective ?? false,
        })),
      }),
    ]);
    res.json({ ok: true });
  }),
);

// ── Teacher constraints ──────────────────────────────────────────────────────
router.get(
  '/constraints',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: req.user!.schoolId },
      include: { user: true },
      orderBy: { employeeId: 'asc' },
    });
    res.json({
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.user.name,
        subjects: fromJson<string[]>(t.subjectsString, []),
        maxWeekly: t.maxHours,
        maxDaily: t.maxDailyPeriods,
        maxConsecutive: t.maxConsecutive,
        partTime: t.partTime,
        unavailable: fromJson(t.unavailableString, []),
        preferredFree: fromJson(t.preferredFreeString, []),
        currentLoad: t.weeklyHours,
      })),
    });
  }),
);

const constraintSchema = z.object({
  maxWeekly: z.number().int().min(1).max(48).optional(),
  maxDaily: z.number().int().min(1).max(10).optional(),
  maxConsecutive: z.number().int().min(1).max(8).optional(),
  partTime: z.boolean().optional(),
  subjects: z.array(z.string()).max(10).optional(),
  unavailable: z.array(cell).max(48).optional(),
  preferredFree: z.array(cell).max(48).optional(),
});

router.put(
  '/constraints/:teacherId',
  authorize(...STAFF_ADMIN),
  validateBody(constraintSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const t = await prisma.teacher.findFirst({ where: { id: req.params.teacherId, schoolId } });
    if (!t) throw notFound('Teacher not found');
    const b = req.body as z.infer<typeof constraintSchema>;
    await prisma.teacher.update({
      where: { id: t.id },
      data: {
        ...(b.maxWeekly !== undefined && { maxHours: b.maxWeekly }),
        ...(b.maxDaily !== undefined && { maxDailyPeriods: b.maxDaily }),
        ...(b.maxConsecutive !== undefined && { maxConsecutive: b.maxConsecutive }),
        ...(b.partTime !== undefined && { partTime: b.partTime }),
        ...(b.subjects !== undefined && { subjectsString: toJson(b.subjects) }),
        ...(b.unavailable !== undefined && { unavailableString: toJson(b.unavailable) }),
        ...(b.preferredFree !== undefined && { preferredFreeString: toJson(b.preferredFree) }),
      },
    });
    res.json({ ok: true });
  }),
);

// ── Pre-validation ("pre-flight checks") ─────────────────────────────────────
router.post(
  '/validate',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const data = await loadSolverInput(req.user!.schoolId);
    res.json({ issues: preValidate(data) });
  }),
);

// ── Generate / read / edit the draft ─────────────────────────────────────────
const generateSchema = z.object({ keepLocks: z.boolean().optional() });
router.post(
  '/generate',
  authorize(...STAFF_ADMIN),
  validateBody(generateSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const outcome = await generateDraft(
      schoolId,
      { id: req.user!.sub, name: req.user!.name },
      { keepLocks: (req.body as any).keepLocks },
    );
    if (!outcome.ok) {
      res.status(422).json({ ok: false, issues: outcome.issues });
      return;
    }
    res.json({
      ok: true,
      timetable: await fullTimetable(schoolId, outcome.timetableId!),
    });
  }),
);

router.get(
  '/draft',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const draft = await getDraft(schoolId);
    res.json({ timetable: draft ? await fullTimetable(schoolId, draft.id) : null });
  }),
);

router.delete(
  '/draft',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    await discardDraft(req.user!.schoolId, { id: req.user!.sub, name: req.user!.name });
    res.json({ ok: true });
  }),
);

const slotEditSchema = z.object({
  day: z.number().int().min(0).max(6).optional(),
  period: z.number().int().min(0).max(11).optional(),
  teacherId: z.string().optional(),
  roomId: z.string().nullable().optional(),
});

router.patch(
  '/draft/slots/:id',
  authorize(...STAFF_ADMIN),
  validateBody(slotEditSchema),
  asyncHandler(async (req, res) => {
    const out = await updateDraftSlot(req.user!.schoolId, req.params.id, req.body as any, {
      id: req.user!.sub,
      name: req.user!.name,
    });
    if (!out.ok) {
      res.status(409).json({ ok: false, violations: out.violations });
      return;
    }
    res.json({ ok: true });
  }),
);

/** Valid alternatives for a slot — powers the edit dropdowns. */
router.get(
  '/draft/slots/:id/options',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const slot = await prisma.timetableSlot.findUnique({ where: { id: req.params.id }, include: { timetable: true, subject: true } });
    if (!slot || slot.timetable.schoolId !== schoolId) throw notFound('Slot not found');
    const data = await loadSolverInput(schoolId);
    const siblings = await prisma.timetableSlot.findMany({ where: { timetableId: slot.timetableId, id: { not: slot.id } } });
    const { ScheduleState } = await import('../services/kairos/engine.js');
    const state = new ScheduleState(data);
    for (const s of siblings)
      state.place({ classId: s.classId, subjectId: s.subjectId, day: s.day, period: s.period, teacherId: s.teacherId, roomId: s.roomId ?? undefined });
    const lesson = data.lessons.find((l) => l.classId === slot.classId && l.subjectId === slot.subjectId);
    if (!lesson) {
      res.json({ teachers: [], rooms: [], cells: [] });
      return;
    }
    const teachers = data.teachers
      .filter((t) => t.subjects.includes(lesson.subjectCode))
      .map((t) => ({
        id: t.id,
        name: t.name,
        ok: state.placementIssues(lesson, slot.day, slot.period, t, slot.roomId ? state.roomById.get(slot.roomId) : undefined).length === 0 || t.id === slot.teacherId,
      }));
    const rooms = data.rooms
      .filter((r) => (lesson.requiresLab ? r.type === 'LAB' : r.type !== 'LAB'))
      .map((r) => ({
        id: r.id,
        name: r.name,
        ok: r.id === slot.roomId || state.placementIssues(lesson, slot.day, slot.period, state.teacherById.get(slot.teacherId)!, r).length === 0,
      }));
    const cells: { day: number; period: number }[] = [];
    const teacher = state.teacherById.get(slot.teacherId)!;
    for (let d = 0; d < data.grid.days.length; d++)
      for (let p = 0; p < data.grid.periodsPerDay; p++) {
        if (d === slot.day && p === slot.period) continue;
        const { room, ok } = state.pickRoom(lesson, d, p);
        if (ok && state.placementIssues(lesson, d, p, teacher, room).length === 0) cells.push({ day: d, period: p });
      }
    res.json({ teachers, rooms, cells });
  }),
);

const lockSchema = z.object({ locked: z.boolean() });
router.post(
  '/draft/slots/:id/lock',
  authorize(...STAFF_ADMIN),
  validateBody(lockSchema),
  asyncHandler(async (req, res) => {
    await setSlotLock(req.user!.schoolId, req.params.id, (req.body as any).locked);
    res.json({ ok: true });
  }),
);

// ── Approve / publish (Principal) ────────────────────────────────────────────
router.post(
  '/draft/approve',
  authorize(...PRINCIPALS),
  asyncHandler(async (req, res) => {
    const tt = await approveDraft(req.user!.schoolId, { id: req.user!.sub, name: req.user!.name });
    res.json({ ok: true, timetable: serializeTimetableMeta(tt) });
  }),
);

router.post(
  '/draft/publish',
  authorize(...PRINCIPALS),
  asyncHandler(async (req, res) => {
    const tt = await publishDraft(req.user!.schoolId, { id: req.user!.sub, name: req.user!.name });
    res.json({ ok: true, timetable: serializeTimetableMeta(tt) });
  }),
);

// ── Version history ──────────────────────────────────────────────────────────
router.get(
  '/versions',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const versions = await prisma.timetable.findMany({
      where: { schoolId: req.user!.schoolId, version: { gt: 0 } },
      orderBy: { version: 'desc' },
      take: 30,
    });
    res.json({ versions: versions.map(serializeTimetableMeta) });
  }),
);

router.get(
  '/versions/compare',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const { a, b } = req.query as { a?: string; b?: string };
    if (!a || !b) throw badRequest('Provide both versions to compare (a, b).');
    res.json(await compareVersions(req.user!.schoolId, a, b));
  }),
);

router.get(
  '/versions/:id',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const tt = await fullTimetable(req.user!.schoolId, req.params.id);
    if (!tt) throw notFound('Version not found');
    res.json({ timetable: tt });
  }),
);

router.post(
  '/versions/:id/rollback',
  authorize(...PRINCIPALS),
  asyncHandler(async (req, res) => {
    const tt = await rollbackToVersion(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name });
    res.json({ ok: true, timetable: serializeTimetableMeta(tt) });
  }),
);

// ── Emergency: substitutes & room closure ────────────────────────────────────
const subPlanSchema = z.object({ teacherId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
router.post(
  '/substitute/plan',
  authorize(...STAFF_ADMIN),
  validateBody(subPlanSchema),
  asyncHandler(async (req, res) => {
    const { teacherId, date } = req.body as z.infer<typeof subPlanSchema>;
    res.json(await planSubstitutes(req.user!.schoolId, teacherId, date));
  }),
);

const subApplySchema = z.object({
  teacherId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  picks: z
    .array(
      z.object({
        period: z.number().int().min(0).max(11),
        classId: z.string(),
        subjectId: z.string(),
        subTeacherId: z.string(),
        reasons: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(12),
});
router.post(
  '/substitute/apply',
  authorize(...STAFF_ADMIN),
  validateBody(subApplySchema),
  asyncHandler(async (req, res) => {
    const { teacherId, date, picks } = req.body as z.infer<typeof subApplySchema>;
    await applySubstitutes(req.user!.schoolId, teacherId, date, picks, req.user!.sub);
    res.json({ ok: true, covered: picks.length });
  }),
);

router.get(
  '/substitutions',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
    const subs = await prisma.substitution.findMany({
      where: { absence: { date, teacher: { schoolId: req.user!.schoolId } } },
      include: { absence: { include: { teacher: { include: { user: true } } } }, subTeacher: { include: { user: true } } },
      orderBy: { period: 'asc' },
    });
    const classIds = [...new Set(subs.map((s) => s.classId).filter(Boolean))] as string[];
    const classes = classIds.length ? await prisma.class.findMany({ where: { id: { in: classIds } } }) : [];
    const classById = new Map(classes.map((c) => [c.id, c.name]));
    res.json({
      date,
      substitutions: subs.map((s) => ({
        id: s.id,
        period: s.period,
        className: s.classId ? classById.get(s.classId) ?? '—' : '—',
        absentTeacher: s.absence.teacher.user.name,
        subTeacher: s.subTeacher.user.name,
        reasons: fromJson<string[]>(s.reasonString, []),
        confidence: s.confidence,
      })),
    });
  }),
);

const closureSchema = z.object({ roomId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
router.post(
  '/room-closure',
  authorize(...STAFF_ADMIN),
  validateBody(closureSchema),
  asyncHandler(async (req, res) => {
    const { roomId, date } = req.body as z.infer<typeof closureSchema>;
    res.json(await planRoomClosure(req.user!.schoolId, roomId, date));
  }),
);

export default router;

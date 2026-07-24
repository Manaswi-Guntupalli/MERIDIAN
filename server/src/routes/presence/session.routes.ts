import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler, badRequest, notFound } from '../../lib/errors.js';
import { STAFF, STAFF_ADMIN } from '../../utils/constants.js';
import { startSession, closeSession, loadActiveSession, qrPayload, expireIfDue } from '../../services/presence/session.js';
import { buildSessionSummary, renderSessionPdf, renderSessionExcel, reportFileName } from '../../services/presence/report.js';
import { markFace, markQr, markManual } from '../../services/presence/engine.js';
import { embedImage } from '../../services/face.js';
import { assertOwnClass } from '../../services/presence/authz.js';

const router = Router();
router.use(authenticate);

const isStaff = (role: string) => (STAFF as readonly string[]).includes(role);

/** Full session view: the class, its timer, and the live verification grid. */
async function sessionView(schoolId: string, sessionId: string, includeToken: boolean) {
  const s = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { code: true, name: true } },
      teacher: { include: { user: { select: { name: true } } } },
      verifications: { include: { student: { select: { id: true, name: true, rollNo: true } } }, orderBy: { student: { rollNo: 'asc' } } },
    },
  });
  if (!s) throw notFound('Attendance session not found');
  const counts = s.verifications.reduce(
    (acc, v) => {
      acc[v.state] = (acc[v.state] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return {
    id: s.id,
    status: s.status,
    className: s.class.name,
    classId: s.class.id,
    subject: s.subject?.name ?? null,
    teacherName: s.teacher.user.name,
    date: s.date,
    startTime: s.startTime,
    expiryTime: s.expiryTime,
    secondsLeft: Math.max(0, Math.round((s.expiryTime.getTime() - Date.now()) / 1000)),
    counts: {
      present: counts.PRESENT ?? 0,
      pending: (counts.PENDING ?? 0) + (counts.QR_VERIFIED ?? 0),
      proxy: counts.PROXY_ATTEMPT ?? 0,
      unverifiedQr: counts.UNVERIFIED_QR ?? 0,
      total: s.verifications.length,
    },
    // The QR encodes ONLY { sessionId, token } and only while active.
    qr: includeToken && s.status === 'ACTIVE' ? qrPayload(s) : null,
    students: s.verifications.map((v) => ({
      studentId: v.student.id,
      name: v.student.name,
      rollNo: v.student.rollNo,
      state: v.state,
      faceConfidence: v.faceConfidence,
      markedPresentAt: v.markedPresentAt,
      reason: v.reason,
    })),
  };
}

// ── Start / close ──
const startSchema = z.object({ classId: z.string(), subjectId: z.string().optional() });
router.post(
  '/start',
  authorize(...STAFF),
  validateBody(startSchema),
  asyncHandler(async (req, res) => {
    const { classId, subjectId } = req.body as z.infer<typeof startSchema>;
    // A teacher may only open attendance for a class they teach.
    if (req.user!.role === 'TEACHER') {
      const cls = await prisma.class.findFirst({ where: { id: classId, schoolId: req.user!.schoolId } });
      await assertOwnClass(req.user!, cls?.classTeacherId ?? null);
    }
    const teacher = await prisma.teacher.findFirst({ where: { schoolId: req.user!.schoolId, userId: req.user!.sub } });
    const session = await startSession({
      schoolId: req.user!.schoolId,
      classId,
      teacherId: teacher?.id ?? (await resolveAnyTeacher(req.user!.schoolId, classId)),
      subjectId,
      createdBy: req.user!.sub,
      actorName: req.user!.name,
    });
    res.status(201).json(await sessionView(req.user!.schoolId, session.id, true));
  }),
);

router.post(
  '/:id/close',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    await closeSession(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name });
    res.json(await sessionView(req.user!.schoolId, req.params.id, false));
  }),
);

// ── Read ──
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const { classId } = req.query as { classId?: string };
    const session = await prisma.attendanceSession.findFirst({
      where: { schoolId: req.user!.schoolId, status: 'ACTIVE', ...(classId ? { classId } : {}) },
      orderBy: { startTime: 'desc' },
    });
    if (!session) return res.json({ session: null });
    if ((await expireIfDue(session.id)) !== 'ACTIVE') return res.json({ session: null });
    // Students see the session but never the token (they scan the projected QR).
    res.json({ session: await sessionView(req.user!.schoolId, session.id, isStaff(req.user!.role)) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isStaff(req.user!.role)) throw badRequest('Only staff may view the live session grid.');
    await expireIfDue(req.params.id);
    res.json(await sessionView(req.user!.schoolId, req.params.id, true));
  }),
);

router.get(
  '/',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    const sessions = await prisma.attendanceSession.findMany({
      where: { schoolId: req.user!.schoolId },
      include: { class: { select: { name: true } }, _count: { select: { verifications: true } } },
      orderBy: { startTime: 'desc' },
      take: 30,
    });
    res.json({
      sessions: sessions.map((s) => ({ id: s.id, className: s.class.name, status: s.status, date: s.date, startTime: s.startTime, roster: s._count.verifications })),
    });
  }),
);

// ── Session summary + reports (read-only; reuses stored attendance data) ──
router.get(
  '/:id/summary',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    await expireIfDue(req.params.id); // finalise states if the window has passed
    res.json(await buildSessionSummary(req.user!.schoolId, req.params.id));
  }),
);

router.get(
  '/:id/report.pdf',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    await expireIfDue(req.params.id);
    const summary = await buildSessionSummary(req.user!.schoolId, req.params.id);
    const pdf = await renderSessionPdf(summary);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(summary)}.pdf"`);
    res.send(pdf);
  }),
);

router.get(
  '/:id/report.xlsx',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    await expireIfDue(req.params.id);
    const summary = await buildSessionSummary(req.user!.schoolId, req.params.id);
    const xlsx = await renderSessionExcel(summary);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(summary)}.xlsx"`);
    res.send(xlsx);
  }),
);

// ── Mark: kiosk face (staff) ──
const faceSchema = z.object({ image: z.string().min(32) });
router.post(
  '/:id/face',
  authorize(...STAFF),
  validateBody(faceSchema),
  asyncHandler(async (req, res) => {
    const embedded = await embedFromImage((req.body as z.infer<typeof faceSchema>).image);
    if (!embedded.found) return res.json({ state: 'ABSENT', reason: 'No face detected in the frame.' });
    const result = await markFace({ schoolId: req.user!.schoolId, sessionId: req.params.id, embedding: embedded.embedding!, detScore: embedded.detScore, actorId: req.user!.sub });
    res.json(result);
  }),
);

// ── Mark: QR scan (student's own device, or staff kiosk with a studentId) ──
const qrSchema = z.object({ token: z.string(), image: z.string().min(32).optional(), studentId: z.string().optional() });
router.post(
  '/:id/qr',
  validateBody(qrSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof qrSchema>;
    // A student scanning identifies as themselves; staff may pass a studentId.
    let studentId = body.studentId;
    if (req.user!.role === 'STUDENT') {
      const me = await prisma.student.findFirst({ where: { schoolId: req.user!.schoolId, userId: req.user!.sub } });
      if (!me) throw badRequest('No student record for this account.');
      studentId = me.id;
    }
    if (!studentId) throw badRequest('studentId is required.');

    let embedding: number[] | undefined;
    if (body.image) {
      const embedded = await embedFromImage(body.image);
      if (embedded.found) embedding = embedded.embedding;
    }
    const result = await markQr({ schoolId: req.user!.schoolId, sessionId: req.params.id, token: body.token, studentId, embedding, actorId: req.user!.sub });
    res.json(result);
  }),
);

// ── Mark: manual override (staff) ──
const manualSchema = z.object({ studentId: z.string() });
router.post(
  '/:id/manual',
  authorize(...STAFF),
  validateBody(manualSchema),
  asyncHandler(async (req, res) => {
    const result = await markManual({ schoolId: req.user!.schoolId, sessionId: req.params.id, studentId: (req.body as z.infer<typeof manualSchema>).studentId, actorId: req.user!.sub });
    res.json(result);
  }),
);

// ── helpers ──
async function embedFromImage(image: string) {
  try {
    return await embedImage(image);
  } catch (e) {
    throw badRequest(`Face service is unreachable — start it with "npm run faceservice". (${e instanceof Error ? e.message : 'error'})`);
  }
}

// A session needs a teacherId; for an admin opening attendance we fall back to
// the class's own class-teacher, then any teacher, rather than failing.
async function resolveAnyTeacher(schoolId: string, classId: string): Promise<string> {
  const cls = await prisma.class.findFirst({ where: { id: classId, schoolId }, select: { classTeacherId: true } });
  if (cls?.classTeacherId) return cls.classTeacherId;
  const any = await prisma.teacher.findFirst({ where: { schoolId }, select: { id: true } });
  if (!any) throw badRequest('This school has no teachers to own an attendance session.');
  return any.id;
}

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { notify } from '../services/notifications.js';
import { emitToSchool } from '../lib/socket.js';
import { matchFace, enrollFace, clearFace } from '../services/face.js';
import { STAFF, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Enroll a student/teacher's captured embeddings ──
const enrollSchema = z.object({
  subjectType: z.enum(['STUDENT', 'TEACHER']),
  subjectId: z.string(),
  embeddings: z
    .array(z.object({ vector: z.array(z.number()).length(128), label: z.string().optional(), quality: z.number().optional() }))
    .min(1),
});
router.post(
  '/enroll',
  authorize(...STAFF_ADMIN),
  validateBody(enrollSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof enrollSchema>;
    const subject =
      body.subjectType === 'STUDENT'
        ? await prisma.student.findFirst({ where: { id: body.subjectId, schoolId } })
        : await prisma.teacher.findFirst({ where: { id: body.subjectId, schoolId }, include: { user: true } });
    if (!subject) throw notFound('Subject not found');
    const name = body.subjectType === 'STUDENT' ? (subject as any).name : (subject as any).user.name;

    const result = await enrollFace({ schoolId, subjectType: body.subjectType, subjectId: body.subjectId, name, embeddings: body.embeddings });

    await logAI({
      schoolId,
      engine: 'PRESENCE',
      action: 'Face enrollment',
      reason: `${result.stored} on-device 128-D embeddings stored — no image kept`,
      confidence: 0.98,
      input: { subjectType: body.subjectType, name },
      output: { total: result.total },
      actorId: req.user!.sub,
    });
    await recordEvent({
      schoolId,
      type: 'FACE_ENROLLED',
      aggregate: body.subjectType,
      aggregateId: body.subjectId,
      payload: { name, embeddings: result.total },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.status(201).json({ ...result, name });
  }),
);

// ── Recognize a single query embedding (no attendance side-effect) ──
const recognizeSchema = z.object({ vector: z.array(z.number()).length(128) });
router.post(
  '/recognize',
  validateBody(recognizeSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const match = await matchFace(schoolId, (req.body as any).vector);
    res.json(match);
  }),
);

// ── Recognize + mark attendance (the live kiosk) ──
const attendanceSchema = z.object({
  vector: z.array(z.number()).length(128),
  liveness: z.boolean().default(true),
  cameraId: z.string().default('kiosk-1'),
});
router.post(
  '/attendance',
  validateBody(attendanceSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof attendanceSchema>;

    const match = await matchFace(schoolId, body.vector);

    // Liveness gate — reject presentation attacks (photos/video).
    if (!body.liveness) {
      await prisma.faceEvent.create({ data: { schoolId, kind: 'SPOOF', confidence: match.confidence, cameraId: body.cameraId } });
      return res.json({ status: 'SPOOF', confidence: match.confidence });
    }

    if (!match.matched || !match.subjectId) {
      await prisma.faceEvent.create({ data: { schoolId, kind: 'UNKNOWN', confidence: match.confidence, cameraId: body.cameraId } });
      emitToSchool(schoolId, 'face:unknown', { confidence: match.confidence });
      return res.json({ status: 'UNKNOWN', confidence: match.confidence });
    }

    // Teachers: recognise but don't create a student attendance record.
    if (match.subjectType === 'TEACHER') {
      return res.json({ status: 'RECOGNIZED', subjectType: 'TEACHER', name: match.name, confidence: match.confidence });
    }

    const student = await prisma.student.findFirst({ where: { id: match.subjectId, schoolId } });
    if (!student || !student.classId) throw badRequest('Recognised student has no class assigned');

    const date = todayStr();
    const existing = await prisma.attendance.findUnique({ where: { studentId_date: { studentId: student.id, date } } });
    if (existing && existing.status !== 'ABSENT') {
      return res.json({ status: 'ALREADY', name: student.name, rollNo: student.rollNo, confidence: match.confidence, at: existing.timestamp });
    }

    const record = await prisma.attendance.upsert({
      where: { studentId_date: { studentId: student.id, date } },
      create: { schoolId, studentId: student.id, classId: student.classId, date, status: 'PRESENT', source: 'CV', confidence: match.confidence },
      update: { status: 'PRESENT', source: 'CV', confidence: match.confidence },
    });

    await recordEvent({
      schoolId,
      type: 'ATTENDANCE_MARKED',
      aggregate: 'Attendance',
      aggregateId: record.id,
      payload: { attendanceId: record.id, studentId: student.id, status: 'PRESENT', source: 'CV' },
      actorName: `Face kiosk (${body.cameraId})`,
    });
    await logAI({
      schoolId,
      engine: 'PRESENCE',
      action: 'Face-embedding attendance match',
      reason: `Matched enrolled student at ${Math.round(match.confidence * 100)}% (liveness verified); raw frame discarded in-memory`,
      confidence: match.confidence,
      output: { student: student.name },
    });

    // Parent notification.
    const links = await prisma.studentParent.findMany({ where: { studentId: student.id }, include: { parent: true } });
    for (const l of links) {
      await notify({
        schoolId,
        userId: l.parent.userId,
        title: `${student.name} entered school`,
        body: `Marked present at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} via face recognition.`,
        severity: 'SUCCESS',
        category: 'ATTENDANCE',
      });
    }

    emitToSchool(schoolId, 'face:attendance', { name: student.name, rollNo: student.rollNo, confidence: match.confidence });
    res.json({ status: 'MARKED', name: student.name, rollNo: student.rollNo, confidence: match.confidence, at: record.timestamp });
  }),
);

// ── Enrollment status list (who has a face profile) ──
router.get(
  '/enrolled',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [students, teachers] = await Promise.all([
      prisma.student.findMany({ where: { schoolId }, include: { class: true }, orderBy: [{ class: { name: 'asc' } }, { rollNo: 'asc' }] }),
      prisma.teacher.findMany({ where: { schoolId }, include: { user: true } }),
    ]);
    res.json({
      students: students.map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, className: s.class?.name, enrolled: s.faceEnrolled, faceCount: s.faceCount })),
      teachers: teachers.map((t) => ({ id: t.id, name: t.user.name, department: t.department, enrolled: t.faceEnrolled, faceCount: t.faceCount })),
    });
  }),
);

// ── Gallery of enrolled vectors for on-device (edge) matching at the kiosk.
//    Vectors only — never images. Enables true multi-face recognition at frame
//    rate without a server round-trip per face. ──
router.get(
  '/gallery',
  asyncHandler(async (req, res) => {
    const rows = await prisma.faceEmbedding.findMany({
      where: { schoolId: req.user!.schoolId },
      select: { subjectType: true, subjectId: true, name: true, vectorString: true },
    });
    res.json({
      gallery: rows.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, name: r.name, vector: JSON.parse(r.vectorString) })),
    });
  }),
);

// ── FR dashboard status ──
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const date = todayStr();
    const [totalStudents, enrolledStudents, totalTeachers, enrolledTeachers, embeddings, cvToday, faceEventsToday] = await Promise.all([
      prisma.student.count({ where: { schoolId } }),
      prisma.student.count({ where: { schoolId, faceEnrolled: true } }),
      prisma.teacher.count({ where: { schoolId } }),
      prisma.teacher.count({ where: { schoolId, faceEnrolled: true } }),
      prisma.faceEmbedding.count({ where: { schoolId } }),
      prisma.attendance.count({ where: { schoolId, date, source: 'CV' } }),
      prisma.faceEvent.findMany({ where: { schoolId, createdAt: { gte: new Date(date + 'T00:00:00') } } }),
    ]);
    res.json({
      totalStudents,
      enrolledStudents,
      totalTeachers,
      enrolledTeachers,
      embeddings,
      coverage: totalStudents ? Math.round((enrolledStudents / totalStudents) * 100) : 0,
      recognizedToday: cvToday,
      unknownToday: faceEventsToday.filter((e) => e.kind === 'UNKNOWN').length,
      spoofToday: faceEventsToday.filter((e) => e.kind === 'SPOOF').length,
    });
  }),
);

router.get(
  '/unknown',
  asyncHandler(async (req, res) => {
    const events = await prisma.faceEvent.findMany({ where: { schoolId: req.user!.schoolId }, orderBy: { createdAt: 'desc' }, take: 30 });
    res.json({ events });
  }),
);

router.delete(
  '/:subjectType/:subjectId',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const { subjectType, subjectId } = req.params;
    if (subjectType !== 'STUDENT' && subjectType !== 'TEACHER') throw badRequest('Invalid subject type');
    await clearFace(req.user!.schoolId, subjectType, subjectId);
    res.json({ ok: true });
  }),
);

export default router;

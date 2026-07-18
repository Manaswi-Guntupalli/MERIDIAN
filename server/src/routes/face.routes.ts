import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { emitToSchool } from '../lib/socket.js';
import { matchFace, enrollFace, clearFace } from '../services/face.js';
import { processScan } from '../services/presence/engine.js';
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
      // subjectType/Id in the payload so the reverser can truly erase the
      // biometric templates on undo (also the parent opt-out path).
      payload: { name, embeddings: result.total, subjectType: body.subjectType, subjectId: body.subjectId },
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

    // Face recognition is just another source into the one Presence
    // pipeline — engine.processScan() handles duplicate/late/direction
    // policy, the Attendance upsert, the Trust Ledger entry and parent
    // notification exactly as it would for an RFID tap.
    const result = await processScan({ schoolId, source: 'CV', studentId: student.id, confidence: match.confidence });

    if (result.status === 'DUPLICATE') {
      return res.json({ status: 'ALREADY', name: student.name, rollNo: student.rollNo, confidence: match.confidence, at: result.timestamp });
    }
    if (result.status === 'REJECTED') {
      throw badRequest(result.reason ?? 'Attendance could not be recorded');
    }

    emitToSchool(schoolId, 'face:attendance', { name: student.name, rollNo: student.rollNo, confidence: match.confidence });
    res.json({ status: 'MARKED', name: student.name, rollNo: student.rollNo, confidence: match.confidence, at: result.timestamp, late: result.late });
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

/**
 * Batch recognition for the live kiosk.
 *
 * SECURITY: we deliberately do NOT ship the enrolled face gallery to the
 * browser. Children's biometric templates never leave the server; the kiosk
 * sends the descriptors it computed from its own camera frame and receives
 * only names + confidences back. Matching stays server-side and auditable.
 */
const batchSchema = z.object({ vectors: z.array(z.array(z.number()).length(128)).max(12) });
router.post(
  '/recognize-batch',
  validateBody(batchSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { vectors } = req.body as z.infer<typeof batchSchema>;
    const results = await Promise.all(vectors.map((v) => matchFace(schoolId, v)));
    res.json({
      results: results.map((m) => ({
        matched: m.matched,
        name: m.matched ? m.name : null,
        subjectId: m.matched ? m.subjectId : null,
        subjectType: m.matched ? m.subjectType : null,
        confidence: m.confidence,
      })),
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

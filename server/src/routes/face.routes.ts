import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { enrollFace, clearFace, embedImage, EMBED_MODEL } from '../services/face.js';
import { STAFF, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Enroll a student/teacher, consent-first ──
// The browser sends IMAGES (2-3 captured frames); the server embeds them via
// the Python face service and stores ONLY the vectors. No image is persisted.
const enrollSchema = z.object({
  subjectType: z.enum(['STUDENT', 'TEACHER']),
  subjectId: z.string(),
  images: z.array(z.string().min(32)).min(1).max(6),
  consent: z.literal(true, { errorMap: () => ({ message: 'Explicit consent is required to enroll a face.' }) }),
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

    // Embed each frame server-side; keep only frames that actually held a face.
    const embeddings: { vector: number[]; label: string; quality: number }[] = [];
    for (const image of body.images) {
      let embedded;
      try {
        embedded = await embedImage(image);
      } catch (e) {
        throw badRequest(`Face service is unreachable — start it with "npm run faceservice". (${e instanceof Error ? e.message : 'error'})`);
      }
      if (embedded.found && embedded.embedding) embeddings.push({ vector: embedded.embedding, label: 'front', quality: embedded.detScore ?? 0 });
    }
    if (!embeddings.length) throw badRequest('No face was detected in any of the captured frames. Move into good light and try again.');

    const result = await enrollFace({ schoolId, subjectType: body.subjectType, subjectId: body.subjectId, name, embeddings, consentBy: req.user!.sub });

    await logAI({
      schoolId,
      engine: 'PRESENCE',
      action: 'Face enrollment',
      reason: `${result.stored} ${EMBED_MODEL} embeddings stored from ${body.images.length} frame(s) — images processed in memory, never kept`,
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
      payload: { name, embeddings: result.total, subjectType: body.subjectType, subjectId: body.subjectId },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.status(201).json({ ...result, name });
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

// ── Face dashboard status ──
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const date = todayStr();
    const [totalStudents, enrolledStudents, totalTeachers, enrolledTeachers, embeddings, faceToday, faceEventsToday] = await Promise.all([
      prisma.student.count({ where: { schoolId } }),
      prisma.student.count({ where: { schoolId, faceEnrolled: true } }),
      prisma.teacher.count({ where: { schoolId } }),
      prisma.teacher.count({ where: { schoolId, faceEnrolled: true } }),
      prisma.faceEmbedding.count({ where: { schoolId } }),
      prisma.attendance.count({ where: { schoolId, date, source: 'FACE' } }),
      prisma.faceEvent.findMany({ where: { schoolId, createdAt: { gte: new Date(date + 'T00:00:00') } } }),
    ]);
    res.json({
      totalStudents,
      enrolledStudents,
      totalTeachers,
      enrolledTeachers,
      embeddings,
      model: EMBED_MODEL,
      coverage: totalStudents ? Math.round((enrolledStudents / totalStudents) * 100) : 0,
      recognizedToday: faceToday,
      unknownToday: faceEventsToday.filter((e) => e.kind === 'UNKNOWN').length,
      proxyToday: faceEventsToday.filter((e) => e.kind === 'PROXY').length,
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

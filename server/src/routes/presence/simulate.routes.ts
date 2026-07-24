import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { STAFF_ADMIN } from '../../utils/constants.js';
import { startSession, closeSession, expireIfDue } from '../../services/presence/session.js';
import { markFace, markQr } from '../../services/presence/engine.js';
import { enrollFace, EMBED_DIM } from '../../services/face.js';

// The Attendance Simulator drives the REAL engine — markFace / markQr, the
// verification state machine, proxy detection, events, audit and Trust Ledger.
// The ONLY simulated element is the camera pixel: without a webcam, a "capture"
// is a stored synthetic template plus small gaussian noise (what a genuine
// re-capture of the same face produces). Every scenario is honest about that.
const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

/** A deterministic-ish synthetic unit vector seeded from a subject id. */
function seededUnitVector(seed: string, dim = EMBED_DIM): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const v: number[] = [];
  for (let i = 0; i < dim; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    v.push(((h >>> 0) / 0xffffffff) * 2 - 1);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** The same face re-captured: tiny noise → cosine ≈ 0.98 vs the template. */
function recapture(vec: number[], sigma = 0.03): number[] {
  const v = vec.map((x) => x + (Math.random() * 2 - 1) * sigma);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Ensure the student has a synthetic demo template so the real matcher works. */
async function ensureDemoFace(schoolId: string, studentId: string): Promise<number[]> {
  const existing = await prisma.faceEmbedding.findFirst({ where: { schoolId, subjectType: 'STUDENT', subjectId: studentId } });
  if (existing) return JSON.parse(existing.vectorString);
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw badRequest('Student not found');
  const vec = seededUnitVector(studentId);
  await enrollFace({ schoolId, subjectType: 'STUDENT', subjectId: studentId, name: student.name, embeddings: [{ vector: vec, label: 'demo-synthetic', quality: 0 }] });
  return vec;
}

async function rosterStudent(sessionId: string, index = 0) {
  const v = await prisma.attendanceVerification.findMany({ where: { sessionId }, include: { student: true }, orderBy: { student: { rollNo: 'asc' } }, take: 5 });
  if (!v.length) throw badRequest('This session has no students on its register.');
  return v[Math.min(index, v.length - 1)].student;
}

// Start a demo session for a class (or reuse the class's active one).
const startSchema = z.object({ classId: z.string() });
router.post(
  '/session',
  validateBody(startSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const existing = await prisma.attendanceSession.findFirst({ where: { schoolId, classId: req.body.classId, status: 'ACTIVE' } });
    if (existing && (await expireIfDue(existing.id)) === 'ACTIVE') return res.json({ sessionId: existing.id, reused: true });
    const s = await startSession({ schoolId, classId: req.body.classId, teacherId: await anyTeacher(schoolId), createdBy: req.user!.sub, actorName: req.user!.name });
    res.status(201).json({ sessionId: s.id, reused: false });
  }),
);

const scenarioSchema = z.object({ sessionId: z.string() });

// 1 · Correct face → PRESENT
router.post('/correct-face', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  const student = await rosterStudent(req.body.sessionId, 0);
  const template = await ensureDemoFace(schoolId, student.id);
  res.json(await markFace({ schoolId, sessionId: req.body.sessionId, embedding: recapture(template), actorId: req.user!.sub }));
}));

// 2 · Unknown face → no confident match, ABSENT (a face nobody enrolled)
router.post('/unknown-face', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  res.json(await markFace({ schoolId, sessionId: req.body.sessionId, embedding: seededUnitVector(`unknown-${Date.now()}`), actorId: req.user!.sub }));
}));

// 3 · No face detected → the frame carried no face
router.post('/no-face', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  res.json({ state: 'ABSENT', reason: 'No face detected in the frame (empty capture).', sessionId: req.body.sessionId });
}));

// 4 · QR only → QR_VERIFIED, pending the face (becomes UNVERIFIED_QR at expiry)
router.post('/qr-only', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  const session = await prisma.attendanceSession.findFirst({ where: { id: req.body.sessionId, schoolId } });
  if (!session) throw badRequest('Session not found');
  const student = await rosterStudent(req.body.sessionId, 1);
  res.json(await markQr({ schoolId, sessionId: session.id, token: session.sessionToken, studentId: student.id, actorId: req.user!.sub }));
}));

// 5 · QR + matching face → PRESENT (both factors)
router.post('/qr-face', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  const session = await prisma.attendanceSession.findFirst({ where: { id: req.body.sessionId, schoolId } });
  if (!session) throw badRequest('Session not found');
  const student = await rosterStudent(req.body.sessionId, 2);
  const template = await ensureDemoFace(schoolId, student.id);
  res.json(await markQr({ schoolId, sessionId: session.id, token: session.sessionToken, studentId: student.id, embedding: recapture(template), actorId: req.user!.sub }));
}));

// 6 · Proxy attempt → QR claims A, face is B → PROXY_ATTEMPT + alert
router.post('/proxy', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  const session = await prisma.attendanceSession.findFirst({ where: { id: req.body.sessionId, schoolId } });
  if (!session) throw badRequest('Session not found');
  const claim = await rosterStudent(req.body.sessionId, 3);
  const impostor = await rosterStudent(req.body.sessionId, 4);
  await ensureDemoFace(schoolId, claim.id); // the claimed student must be enrolled to verify against
  const impostorFace = await ensureDemoFace(schoolId, impostor.id);
  res.json(await markQr({ schoolId, sessionId: session.id, token: session.sessionToken, studentId: claim.id, embedding: recapture(impostorFace), actorId: req.user!.sub }));
}));

// 7 · Expired session → marking is refused (anti-replay boundary)
router.post('/expired', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user!.schoolId;
  await prisma.attendanceSession.update({ where: { id: req.body.sessionId }, data: { expiryTime: new Date(Date.now() - 1000) } });
  await expireIfDue(req.body.sessionId);
  const student = await rosterStudent(req.body.sessionId, 0);
  try {
    const template = await ensureDemoFace(schoolId, student.id);
    const result = await markFace({ schoolId, sessionId: req.body.sessionId, embedding: recapture(template), actorId: req.user!.sub });
    res.json(result);
  } catch (e) {
    res.json({ state: 'REJECTED', reason: e instanceof Error ? e.message : 'Session expired', sessionId: req.body.sessionId });
  }
}));

// 8 · Camera offline → the face service is unreachable (honest degradation)
router.post('/camera-offline', validateBody(scenarioSchema), asyncHandler(async (_req, res) => {
  res.json({ state: 'REJECTED', reason: 'Camera / face service is offline — no attendance can be captured until it is restored.', sessionId: _req.body.sessionId });
}));

// Close the demo session.
router.post('/close', validateBody(scenarioSchema), asyncHandler(async (req, res) => {
  await closeSession(req.user!.schoolId, req.body.sessionId, { id: req.user!.sub, name: req.user!.name });
  res.json({ ok: true });
}));

async function anyTeacher(schoolId: string): Promise<string> {
  const t = await prisma.teacher.findFirst({ where: { schoolId }, select: { id: true } });
  if (!t) throw badRequest('No teachers to own a session');
  return t.id;
}

export default router;

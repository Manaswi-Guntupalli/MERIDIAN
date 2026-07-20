import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticateReaderOrStaff, authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler, badRequest, notFound } from '../../lib/errors.js';
import { STAFF_ADMIN } from '../../utils/constants.js';
import { processScan } from '../../services/presence/engine.js';
import { issueCard } from '../../services/presence/cards.js';
import { assertOwnClass } from '../../services/presence/authz.js';
import { assertNotLocked } from '../../services/emergency.js';
import { auditLog } from '../../services/trustLedger.js';

const router = Router();

// ── The one ingest boundary. A real reader is a gateway/firmware script
// that POSTs here with `x-reader-key`; the Simulator UI and manual
// corrections POST the same shape with a staff JWT instead. ──
const scanSchema = z.object({
  source: z.enum(['RFID', 'MANUAL']),
  cardUid: z.string().optional(),
  studentId: z.string().optional(),
  readerId: z.string().optional(),
  direction: z.enum(['ENTRY', 'EXIT']).optional(),
  notes: z.string().optional(),
});

router.post(
  '/scan',
  authenticateReaderOrStaff,
  validateBody(scanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof scanSchema>;

    if (req.reader) {
      if (body.source === 'MANUAL') throw badRequest('Devices cannot submit MANUAL attendance');
      const result = await processScan({
        schoolId: req.reader.schoolId,
        source: body.source,
        cardUid: body.cardUid,
        readerId: req.reader.id, // always the authenticated reader's own id — never trust the body for this
        direction: body.direction,
        notes: body.notes,
      });
      return res.json(result);
    }

    // Staff path: MANUAL correction only (RFID from a browser tab would
    // have no device key and must not be accepted as if it were hardware).
    if (body.source !== 'MANUAL') throw badRequest('RFID scans require a reader device key');
    if (!body.studentId) throw badRequest('studentId is required for a manual mark');

    const schoolId = req.user!.schoolId;
    // Manual attendance editing is frozen during an active emergency; the
    // physical reader path above keeps sensing (it is not "editing").
    await assertNotLocked(schoolId, 'Attendance');
    const student = await prisma.student.findFirst({ where: { id: body.studentId, schoolId }, include: { class: true } });
    if (!student) throw notFound('Student not found in your school');

    await assertOwnClass(req.user!, student.class?.classTeacherId);

    const result = await processScan({
      schoolId,
      source: 'MANUAL',
      studentId: body.studentId,
      direction: body.direction,
      notes: body.notes,
      createdBy: req.user!.sub,
    });
    res.json(result);
  }),
);

// ── Fusion ingest: RFID tap + live face descriptor in one request ──
// The anti-proxy loop. The tap claims an identity; the 128-D descriptor the
// gate camera computed must confirm it (1:1 verify against the cardholder's
// enrolled templates). Mismatch → PROXY rejection + security alert.
// An un-enrolled cardholder is "cannot verify", not "failed to verify":
// by default that degrades honestly to a plain RFID scan, but a gate running
// in strict mode (the kiosk's Gate mode) REJECTS it — there, attendance
// requires BOTH the card and a verified face, no exceptions.
const fusionSchema = z.object({
  readerId: z.string().optional(),
  cardUid: z.string(),
  vector: z.array(z.number()).length(128),
  direction: z.enum(['ENTRY', 'EXIT']).optional(),
  strict: z.boolean().optional(),
});
router.post(
  '/scan/fusion',
  authenticateReaderOrStaff,
  validateBody(fusionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof fusionSchema>;
    const schoolId = req.reader ? req.reader.schoolId : req.user!.schoolId;
    const readerId = req.reader ? req.reader.id : body.readerId; // devices can never spoof another reader
    if (!readerId) throw badRequest('readerId is required');

    const { verifyFaceAgainst, matchFace } = await import('../../services/face.js');
    const card = await prisma.rFIDCard.findFirst({ where: { schoolId, uid: body.cardUid } });

    if (card) {
      const verify = await verifyFaceAgainst(schoolId, 'STUDENT', card.studentId, body.vector);
      if (verify.samples === 0 && !body.strict) {
        // Default (device path): process as RFID and say so.
        const result = await processScan({
          schoolId, source: 'RFID', readerId, cardUid: body.cardUid, direction: body.direction,
          createdBy: req.user?.sub, notes: 'Fusion requested; no face enrolled — processed as RFID',
        });
        return res.json({ ...result, fusion: { verified: null, reason: 'cardholder has no enrolled face' } });
      }
      const who = await matchFace(schoolId, body.vector);
      const result = await processScan({
        schoolId,
        source: 'FUSION',
        readerId,
        cardUid: body.cardUid,
        direction: body.direction,
        createdBy: req.user?.sub,
        confidence: verify.similarity,
        fusion: {
          similarity: verify.similarity,
          threshold: verify.threshold,
          samples: verify.samples,
          required: body.strict ?? false,
          matchedSubjectId: who.matched ? who.subjectId : null,
          matchedName: who.matched ? who.name : null,
        },
      });
      return res.json({
        ...result,
        fusion: { verified: result.status === 'VERIFIED' || result.status === 'LATE', similarity: verify.similarity, threshold: verify.threshold },
      });
    }

    // Unknown card — the engine's normal UNKNOWN path (security review) applies.
    const result = await processScan({ schoolId, source: 'RFID', readerId, cardUid: body.cardUid, createdBy: req.user?.sub, notes: 'Fusion scan — unknown card' });
    res.json(result);
  }),
);

// ── Unknown-card review queue ──
router.get(
  '/unknown',
  authenticate,
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const events = await prisma.attendanceEvent.findMany({
      where: { schoolId: req.user!.schoolId, verificationStatus: 'UNKNOWN' },
      include: { reader: { select: { name: true, location: true } } },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
    res.json({ events });
  }),
);

const resolveSchema = z.object({ studentId: z.string().optional(), uid: z.string().optional(), dismiss: z.boolean().optional() });
router.post(
  '/unknown/:eventId/resolve',
  authenticate,
  authorize(...STAFF_ADMIN),
  validateBody(resolveSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const event = await prisma.attendanceEvent.findFirst({ where: { id: req.params.eventId, schoolId, verificationStatus: 'UNKNOWN' } });
    if (!event) throw notFound('Unknown-card event not found');
    const body = req.body as z.infer<typeof resolveSchema>;

    if (body.dismiss) {
      await prisma.attendanceEvent.update({ where: { id: event.id }, data: { notes: `${event.notes ?? ''} (dismissed)`.trim() } });
      await auditLog({ schoolId, actorId: req.user!.sub, action: 'UNKNOWN_CARD_DISMISSED', entity: 'AttendanceEvent', entityId: event.id });
      return res.json({ ok: true });
    }

    if (body.studentId && event.notes) {
      // Register the UID that triggered this event to the chosen student, so
      // future scans of the same physical card resolve normally.
      const student = await prisma.student.findFirst({ where: { id: body.studentId, schoolId } });
      if (!student) throw notFound('Student not found in your school');
      const uid = body.uid ?? event.notes;
      const card = await issueCard({ schoolId, studentId: student.id, uid }, { id: req.user!.sub, name: req.user!.name });
      await prisma.attendanceEvent.update({ where: { id: event.id }, data: { studentId: student.id, cardId: card.id, notes: `${event.notes} (resolved → ${student.name})` } });
      await auditLog({ schoolId, actorId: req.user!.sub, action: 'UNKNOWN_CARD_RESOLVED', entity: 'AttendanceEvent', entityId: event.id, meta: { studentId: student.id, uid } });
      return res.json({ ok: true, card });
    }

    throw badRequest('Provide studentId to register the card, or dismiss:true to close it');
  }),
);

export default router;

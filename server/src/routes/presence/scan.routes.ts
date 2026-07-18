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
import { auditLog } from '../../services/trustLedger.js';

const router = Router();

// ── The one ingest boundary. A real reader is a gateway/firmware script
// that POSTs here with `x-reader-key`; the Simulator UI and manual
// corrections POST the same shape with a staff JWT instead. ──
const scanSchema = z.object({
  source: z.enum(['RFID', 'QR', 'MANUAL']),
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

    // Staff path: MANUAL correction only (RFID/QR from a browser tab would
    // have no device key and must not be accepted as if it were hardware).
    if (body.source !== 'MANUAL') throw badRequest('RFID/QR scans require a reader device key');
    if (!body.studentId) throw badRequest('studentId is required for a manual mark');

    const schoolId = req.user!.schoolId;
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

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { listEvents, undoEvent } from '../services/eventStore.js';
import { serializeAILog } from '../services/trustLedger.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

// Event timeline (Audit Timeline + Time Machine source).
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const { until, limit } = req.query as { until?: string; limit?: string };
    const events = await listEvents(req.user!.schoolId, {
      until,
      limit: limit ? Number(limit) : 150,
    });
    res.json({ events });
  }),
);

// Undo a reversible event (one-tap undo).
router.post(
  '/events/:id/undo',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const result = await undoEvent(req.user!.schoolId, req.params.id, {
      id: req.user!.sub,
      name: req.user!.name,
    });
    res.json(result);
  }),
);

/**
 * Point-in-time ACTIVITY REPLAY.
 *
 * Honest scope: this folds the append-only event log up to `at` and reports
 * what had happened by then (excluding reverted events). It is NOT a full
 * state replay of every table — we don't claim to rebuild the whole school,
 * because materialised views aren't yet event-derived. Naming it accurately
 * matters more than the marketing line.
 */
router.get(
  '/activity-replay',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const at = (req.query.at as string) || new Date().toISOString();
    const cutoff = new Date(at);

    const events = await prisma.event.findMany({
      where: { schoolId, createdAt: { lte: cutoff } },
      orderBy: { createdAt: 'asc' },
    });

    // Fold events into a point-in-time snapshot.
    let studentsCreated = 0;
    let attendanceMarks = 0;
    let feePayments = 0;
    let docsProcessed = 0;
    const emergencies: string[] = [];
    for (const e of events) {
      if (e.reverted) continue;
      switch (e.type) {
        case 'STUDENT_CREATED':
          studentsCreated++;
          break;
        case 'ATTENDANCE_MARKED':
          attendanceMarks++;
          break;
        case 'FEE_PAYMENT_RECORDED':
          feePayments++;
          break;
        case 'DOCUMENT_PROCESSED':
          docsProcessed++;
          break;
        case 'EMERGENCY_TRIGGERED':
          emergencies.push(e.type);
          break;
      }
    }
    res.json({
      at: cutoff.toISOString(),
      eventCount: events.length,
      snapshot: { studentsCreated, attendanceMarks, feePayments, docsProcessed, emergencies: emergencies.length },
    });
  }),
);

// AI Trust Ledger.
router.get(
  '/ai-logs',
  asyncHandler(async (req, res) => {
    const logs = await prisma.aILog.findMany({
      where: { schoolId: req.user!.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ logs: logs.map(serializeAILog) });
  }),
);

export default router;

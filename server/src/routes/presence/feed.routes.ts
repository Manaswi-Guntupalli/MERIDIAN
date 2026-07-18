import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, forbidden, notFound } from '../../lib/errors.js';
import { STAFF } from '../../utils/constants.js';

const router = Router();
router.use(authenticate);

// Live/operational feed — filterable by date, student, reader, status.
// Staff-only: this is the operational view, not a parent/student surface.
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    if (!STAFF.includes(req.user!.role as (typeof STAFF)[number])) throw forbidden();
    const schoolId = req.user!.schoolId;
    const { date, studentId, readerId, status, direction, limit } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { schoolId };
    if (date) where.timestamp = { gte: new Date(`${date}T00:00:00`), lt: new Date(`${date}T23:59:59.999`) };
    if (studentId) where.studentId = studentId;
    if (readerId) where.readerId = readerId;
    if (status) where.verificationStatus = status;
    if (direction) where.direction = direction;

    const events = await prisma.attendanceEvent.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, rollNo: true, class: { select: { name: true } } } },
        reader: { select: { id: true, name: true, location: true } },
        card: { select: { uid: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });
    res.json({ events });
  }),
);

// Student timeline — entries/exits/late/manual overrides, plus the Trust
// Core's own event/audit trail for full corrections history.
router.get(
  '/history/:studentId',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { studentId } = req.params;
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
    if (!student) throw notFound('Student not found in your school');

    await assertHistoryAccess(req.user!, student);

    const [events, auditEvents] = await Promise.all([
      prisma.attendanceEvent.findMany({
        where: { schoolId, studentId },
        include: { reader: { select: { name: true, location: true } }, card: { select: { uid: true } } },
        orderBy: { timestamp: 'desc' },
        take: 200,
      }),
      prisma.event.findMany({ where: { schoolId, aggregate: 'AttendanceEvent' }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ]);

    // Cross-reference the Trust Core event log for corrections/undo markers
    // on this student's rows only.
    const eventIds = new Set(events.map((e) => e.id));
    const trail = auditEvents.filter((e) => eventIds.has(e.aggregateId));

    res.json({ student: { id: student.id, name: student.name, rollNo: student.rollNo }, events, trail });
  }),
);

async function assertHistoryAccess(user: { sub: string; role: string; schoolId: string }, student: { id: string; userId: string | null }) {
  if (STAFF.includes(user.role as (typeof STAFF)[number])) return;
  if (user.role === 'STUDENT') {
    if (student.userId === user.sub) return;
    throw forbidden('Students may only view their own attendance history');
  }
  if (user.role === 'PARENT') {
    const parent = await prisma.parent.findUnique({ where: { userId: user.sub } });
    if (parent) {
      const link = await prisma.studentParent.findUnique({ where: { studentId_parentId: { studentId: student.id, parentId: parent.id } } });
      if (link) return;
    }
    throw forbidden('Parents may only view their own children\'s attendance history');
  }
  throw forbidden();
}

export default router;

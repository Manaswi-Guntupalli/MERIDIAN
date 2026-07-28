import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { assertOwnClass } from '../services/presence/authz.js';
import { assertNotLocked } from '../services/emergency.js';
import { ATTENDANCE_STATUS, STAFF } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

const todayStr = () => new Date().toISOString().slice(0, 10);

// Roster + today's attendance for a class.
router.get(
  '/class/:classId',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const date = (req.query.date as string) || todayStr();
    const students = await prisma.student.findMany({
      where: { schoolId, classId: req.params.classId },
      orderBy: { rollNo: 'asc' },
    });
    const records = await prisma.attendance.findMany({
      where: { schoolId, classId: req.params.classId, date },
    });
    const map = new Map(records.map((r) => [r.studentId, r]));
    res.json({
      date,
      roster: students.map((s) => ({
        studentId: s.id,
        name: s.name,
        rollNo: s.rollNo,
        faceEnrolled: s.faceEnrolled,
        status: map.get(s.id)?.status ?? 'UNMARKED',
        source: map.get(s.id)?.source ?? null,
        attendanceId: map.get(s.id)?.id ?? null,
      })),
    });
  }),
);

const markSchema = z.object({
  studentId: z.string(),
  classId: z.string(),
  status: z.enum(ATTENDANCE_STATUS as unknown as [string, ...string[]]),
  date: z.string().optional(),
});

// This is a thin wrapper over Presence: a live PRESENT/LATE mark for today
// is exactly a manual attendance EVENT and goes through the same
// engine.processScan() every other source uses. ABSENT/LEAVE — and any
// backdated correction — aren't a physical detection of anyone, so they
// stay a direct administrative write to the same Attendance table (no
// AttendanceEvent to speak of; Presence is still the only thing that ever
// touches Attendance).
router.post(
  '/mark',
  validateBody(markSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    await assertNotLocked(schoolId, 'Attendance');
    const body = req.body as z.infer<typeof markSchema>;
    const date = body.date || todayStr();

    const student = await prisma.student.findFirst({ where: { id: body.studentId, schoolId }, include: { class: true } });
    if (!student) throw notFound('Student not found in your school');
    if (student.classId !== body.classId) throw badRequest('Student is not enrolled in that class');
    await assertOwnClass(req.user!, student.class?.classTeacherId);

    // Manual daily marking is a direct administrative write to the materialized
    // Attendance table (no live face/QR session involved), recorded as a
    // reversible ATTENDANCE_MARKED event. A live PRESENT/LATE mark also writes
    // an AttendanceEvent so it shows in the Presence feed alongside face/QR marks.
    const existing = await prisma.attendance.findUnique({ where: { studentId_date: { studentId: body.studentId, date } } });
    // recordEvent defers the socket broadcast when it runs inside a
    // transaction, handing back an emit() to fire once the write has actually
    // committed. Dropping it (as this handler used to) meant marking a student
    // updated the database but told nobody — no live refresh on the principal's
    // dashboard, and no update on the parent's phone.
    const { record, broadcast } = await prisma.$transaction(async (tx) => {
      const r = await tx.attendance.upsert({
        where: { studentId_date: { studentId: body.studentId, date } },
        create: { schoolId, studentId: body.studentId, classId: body.classId, date, status: body.status, source: 'MANUAL', markedById: req.user!.sub },
        update: { status: body.status, source: 'MANUAL' },
      });
      if ((body.status === 'PRESENT' || body.status === 'LATE') && date === todayStr()) {
        await tx.attendanceEvent.create({
          data: { schoolId, studentId: body.studentId, source: 'MANUAL', direction: 'ENTRY', verificationStatus: body.status === 'LATE' ? 'LATE' : 'VERIFIED', late: body.status === 'LATE', createdBy: req.user!.sub, notes: 'Manual daily mark' },
        });
      }
      const recorded = await recordEvent(
        {
          schoolId,
          type: 'ATTENDANCE_MARKED',
          aggregate: 'Attendance',
          aggregateId: r.id,
          payload: { attendanceId: r.id, studentId: body.studentId, status: body.status, previousStatus: existing?.status ?? null, previousSource: existing?.source ?? null, source: 'MANUAL' },
          actorId: req.user!.sub,
          actorName: req.user!.name,
        },
        tx,
      );
      return { record: r, broadcast: recorded.emit };
    });
    broadcast();

    res.json({ record });
  }),
);

// Bulk mark a whole class (drives the ⌘K / voice "Mark 8A present" command).
const bulkSchema = z.object({
  classId: z.string(),
  status: z.enum(ATTENDANCE_STATUS as unknown as [string, ...string[]]),
  date: z.string().optional(),
});
router.post(
  '/bulk',
  validateBody(bulkSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    await assertNotLocked(schoolId, 'Attendance');
    const { classId, status } = req.body as z.infer<typeof bulkSchema>;
    const date = (req.body as any).date || todayStr();
    const owned = await prisma.class.findFirst({ where: { id: classId, schoolId } });
    if (!owned) throw notFound('Class not found in your school');
    await assertOwnClass(req.user!, owned.classTeacherId);

    const students = await prisma.student.findMany({ where: { schoolId, classId, active: true } });
    for (const s of students) {
      await prisma.attendance.upsert({
        where: { studentId_date: { studentId: s.id, date } },
        create: { schoolId, studentId: s.id, classId, date, status, source: 'MANUAL', markedById: req.user!.sub },
        update: { status, source: 'MANUAL' },
      });
    }

    await recordEvent({
      schoolId,
      type: 'ATTENDANCE_BULK',
      aggregate: 'Class',
      aggregateId: classId,
      payload: { classId, status, count: students.length, className: owned.name },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.json({ marked: students.length, className: owned.name, status });
  }),
);

// Attendance trend (last 14 days) for charts.
router.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [all, totalStudents] = await Promise.all([
      prisma.attendance.findMany({ where: { schoolId }, orderBy: { date: 'asc' } }),
      prisma.student.count({ where: { schoolId } }),
    ]);
    const byDate: Record<string, { present: number; total: number }> = {};
    for (const a of all) {
      byDate[a.date] ??= { present: 0, total: 0 };
      byDate[a.date].total++;
      if (a.status === 'PRESENT' || a.status === 'LATE') byDate[a.date].present++;
    }
    // A day mid-roll-call (only a class or two marked) is NOT a school-wide
    // data point — plotting it would read as a cliff to 0%. We still return it,
    // flagged `partial`, so the UI can show it honestly rather than drop it.
    const series = Object.entries(byDate)
      .map(([date, v]) => ({
        date,
        rate: Math.round((v.present / v.total) * 100),
        marked: v.total,
        coverage: totalStudents ? Math.round((v.total / totalStudents) * 100) : 0,
        partial: totalStudents ? v.total / totalStudents < 0.5 : false,
      }))
      .slice(-14);
    res.json({ series, totalStudents });
  }),
);

export default router;

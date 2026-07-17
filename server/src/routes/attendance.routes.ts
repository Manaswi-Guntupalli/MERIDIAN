import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import { emitToSchool } from '../lib/socket.js';
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
        rfidTag: s.rfidTag,
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
  source: z.enum(['MANUAL', 'RFID', 'CV']).optional(),
  confidence: z.number().optional(),
});

router.post(
  '/mark',
  validateBody(markSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof markSchema>;
    const date = body.date || todayStr();

    // Ownership: never trust client-supplied IDs — both the student and the
    // class must belong to the caller's school, and the student must be in
    // that class. Prevents cross-tenant/cross-class attendance writes.
    const student = await prisma.student.findFirst({ where: { id: body.studentId, schoolId } });
    if (!student) throw notFound('Student not found in your school');
    const cls = await prisma.class.findFirst({ where: { id: body.classId, schoolId } });
    if (!cls) throw notFound('Class not found in your school');
    if (student.classId !== cls.id) throw badRequest('Student is not enrolled in that class');

    const existing = await prisma.attendance.findUnique({ where: { studentId_date: { studentId: body.studentId, date } } });
    const record = await prisma.attendance.upsert({
      where: { studentId_date: { studentId: body.studentId, date } },
      create: {
        schoolId,
        studentId: body.studentId,
        classId: body.classId,
        date,
        status: body.status,
        source: body.source ?? 'MANUAL',
        confidence: body.confidence,
        markedById: req.user!.sub,
      },
      update: { status: body.status, source: body.source ?? 'MANUAL', confidence: body.confidence },
    });

    await recordEvent({
      schoolId,
      type: 'ATTENDANCE_MARKED',
      aggregate: 'Attendance',
      aggregateId: record.id,
      payload: {
        attendanceId: record.id,
        studentId: body.studentId,
        status: body.status,
        previousStatus: existing?.status ?? null,
        previousSource: existing?.source ?? null,
        source: body.source ?? 'MANUAL',
      },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });

    if (body.source === 'CV') {
      await logAI({
        schoolId,
        engine: 'PRESENCE',
        action: 'Face-embedding attendance match',
        reason: 'On-device MobileFaceNet embedding matched enrolled student; no raw image stored',
        confidence: body.confidence ?? 0.95,
        input: { studentId: body.studentId },
        output: { status: body.status },
      });
    }
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
    const { classId, status } = req.body as z.infer<typeof bulkSchema>;
    const date = (req.body as any).date || todayStr();
    // Ownership: the class must belong to the caller's school.
    const owned = await prisma.class.findFirst({ where: { id: classId, schoolId } });
    if (!owned) throw notFound('Class not found in your school');
    const students = await prisma.student.findMany({ where: { schoolId, classId } });
    for (const s of students) {
      await prisma.attendance.upsert({
        where: { studentId_date: { studentId: s.id, date } },
        create: { schoolId, studentId: s.id, classId, date, status, source: 'MANUAL', markedById: req.user!.sub },
        update: { status, source: 'MANUAL' },
      });
    }
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    await recordEvent({
      schoolId,
      type: 'ATTENDANCE_BULK',
      aggregate: 'Class',
      aggregateId: classId,
      payload: { classId, status, count: students.length, className: cls?.name },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.json({ marked: students.length, className: cls?.name, status });
  }),
);

// Presence kiosk — resolve an RFID tap or CV embedding to a student and mark present.
const kioskSchema = z.object({
  rfidTag: z.string().optional(),
  studentId: z.string().optional(),
  mode: z.enum(['RFID', 'CV']),
  confidence: z.number().optional(),
});
router.post(
  '/kiosk',
  validateBody(kioskSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof kioskSchema>;
    const student = body.rfidTag
      ? await prisma.student.findFirst({ where: { schoolId, rfidTag: body.rfidTag } })
      : await prisma.student.findFirst({ where: { schoolId, id: body.studentId } });
    if (!student || !student.classId) throw badRequest('No enrolled student for that tap');

    const date = todayStr();
    const record = await prisma.attendance.upsert({
      where: { studentId_date: { studentId: student.id, date } },
      create: {
        schoolId,
        studentId: student.id,
        classId: student.classId,
        date,
        status: 'PRESENT',
        source: body.mode,
        confidence: body.confidence,
      },
      update: { status: 'PRESENT', source: body.mode, confidence: body.confidence },
    });

    await recordEvent({
      schoolId,
      type: 'ATTENDANCE_MARKED',
      aggregate: 'Attendance',
      aggregateId: record.id,
      payload: { attendanceId: record.id, studentId: student.id, status: 'PRESENT', source: body.mode },
      actorName: `Presence kiosk (${body.mode})`,
    });
    await logAI({
      schoolId,
      engine: 'PRESENCE',
      action: `${body.mode} attendance capture`,
      reason:
        body.mode === 'CV'
          ? 'Edge face embedding matched — raw frame discarded in-memory, zero biometric image stored'
          : 'RFID tag resolved to enrolled student',
      confidence: body.confidence ?? (body.mode === 'CV' ? 0.94 : 1),
      output: { student: student.name, status: 'PRESENT' },
    });

    emitToSchool(schoolId, 'presence:tap', { student: student.name, rollNo: student.rollNo, mode: body.mode });
    res.json({ student: { id: student.id, name: student.name, rollNo: student.rollNo }, record });
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

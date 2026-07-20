import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { getDashboardIntelligence } from '../services/intelligence.js';
import { ROLES, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);

const today = () => new Date().toISOString().slice(0, 10);

// A day only speaks for the school once enough of the school is actually
// marked. Below this, the sample is "in progress", not a health signal.
const REPRESENTATIVE_COVERAGE = 0.5;

/**
 * The most recent day whose attendance covers enough of the school to be
 * representative.
 *
 * Why this exists: marking a single class (say 8A absent) creates records for
 * ~17% of students. Treating present/marked as school-wide attendance then
 * reports 0% and craters Operational Health — a partial sample masquerading as
 * the whole school. Headline health uses a representative day; today's live
 * progress is reported separately (see `todayAttendance`) so nothing is hidden.
 */
async function representativeDate(schoolId: string, totalStudents: number): Promise<string> {
  const t = today();
  const recent = await prisma.attendance.groupBy({
    by: ['date'],
    where: { schoolId },
    _count: { _all: true },
    orderBy: { date: 'desc' },
    take: 20,
  });
  const enough = (n: number) => totalStudents > 0 && n / totalStudents >= REPRESENTATIVE_COVERAGE;
  const rep = recent.find((r) => enough(r._count._all));
  return rep?.date ?? recent[0]?.date ?? t;
}

/** Live, real-time picture of today — however partial it currently is. */
async function todayAttendance(schoolId: string, totalStudents: number) {
  const rows = await prisma.attendance.findMany({ where: { schoolId, date: today() } });
  const present = rows.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
  const coverage = totalStudents ? Math.round((rows.length / totalStudents) * 100) : 0;
  return {
    date: today(),
    marked: rows.length,
    present,
    absent: rows.length - present,
    rate: rows.length ? Math.round((present / rows.length) * 100) : 0,
    coverage,
    inProgress: coverage < REPRESENTATIVE_COVERAGE * 100,
  };
}

// Teacher dashboard — the classes they lead, today's schedule, their reach.
router.get(
  '/teacher',
  authorize(ROLES.TEACHER, ...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const teacher = await prisma.teacher.findFirst({ where: { schoolId, userId: req.user!.sub }, include: { user: true } });
    if (!teacher) {
      res.json({ teacher: null, classesLed: [], todaySlots: [], studentsReached: 0, weeklyHours: 0, maxHours: 0 });
      return;
    }
    const now = new Date();
    const jsDay = now.getDay();
    const day = jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1;

    const [classesLed, slots] = await Promise.all([
      prisma.class.findMany({ where: { schoolId, classTeacherId: teacher.id }, include: { _count: { select: { students: true } }, room: true } }),
      prisma.timetableSlot.findMany({
        where: { timetable: { schoolId, active: true }, teacherId: teacher.id },
        include: { class: true, subject: true, room: true },
        orderBy: [{ day: 'asc' }, { period: 'asc' }],
      }),
    ]);
    const todaySlots = slots.filter((s) => s.day === day);
    const classIds = [...new Set(slots.map((s) => s.classId))];
    const studentsReached = classIds.length
      ? await prisma.student.count({ where: { schoolId, classId: { in: classIds } } })
      : 0;

    res.json({
      teacher: { name: teacher.user.name, department: teacher.department, employeeId: teacher.employeeId },
      weeklyHours: teacher.weeklyHours,
      maxHours: teacher.maxHours,
      classesLed: classesLed.map((c) => ({ id: c.id, name: c.name, students: c._count.students, room: c.room?.name })),
      studentsReached,
      todaySlots: todaySlots.map((s) => ({ period: s.period, className: s.class.name, classId: s.classId, subject: s.subject.name, color: s.subject.color, room: s.room?.name })),
    });
  }),
);

// Personal snapshot for a signed-in STUDENT or PARENT (self-service dashboards).
router.get(
  '/me',
  authorize(ROLES.STUDENT, ROLES.PARENT),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const role = req.user!.role;

    // Resolve the set of students this user should see.
    let students: { id: string; name: string; rollNo: number; classId: string | null; class?: any }[] = [];
    if (role === 'STUDENT') {
      const me = await prisma.student.findFirst({
        where: { schoolId, userId: req.user!.sub },
        include: { class: { include: { classTeacher: { include: { user: true } }, room: true } } },
      });
      if (me) students = [me as any];
    } else if (role === 'PARENT') {
      const parent = await prisma.parent.findFirst({ where: { schoolId, userId: req.user!.sub } });
      if (parent) {
        const links = await prisma.studentParent.findMany({
          where: { parentId: parent.id },
          include: { student: { include: { class: { include: { classTeacher: { include: { user: true } }, room: true } } } } },
        });
        students = links.map((l) => l.student) as any;
      }
    }

    const now = new Date();
    const jsDay = now.getDay();
    const day = jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1;

    const cards = await Promise.all(
      students.map(async (s) => {
        const [attendance, fees, slots] = await Promise.all([
          prisma.attendance.findMany({ where: { studentId: s.id }, orderBy: { date: 'desc' }, take: 30 }),
          prisma.fee.findMany({ where: { studentId: s.id } }),
          s.classId
            ? prisma.timetableSlot.findMany({
                where: { timetable: { schoolId, active: true }, classId: s.classId, day },
                include: { subject: true, teacher: { include: { user: true } }, room: true },
                orderBy: { period: 'asc' },
              })
            : Promise.resolve([]),
        ]);
        const present = attendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
        const rate = attendance.length ? Math.round((present / attendance.length) * 100) : 0;
        const dues = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
        const todayRec = attendance.find((a) => a.date === today());
        return {
          id: s.id,
          name: s.name,
          rollNo: s.rollNo,
          className: (s as any).class?.name ?? null,
          classTeacher: (s as any).class?.classTeacher?.user?.name ?? null,
          room: (s as any).class?.room?.name ?? null,
          attendanceRate: rate,
          todayStatus: todayRec?.status ?? 'UNMARKED',
          attendanceHistory: attendance.map((a) => ({ date: a.date, status: a.status })),
          outstanding: Math.round(dues),
          fees: fees.map((f) => ({ id: f.id, title: f.title, due: f.amount - f.paid, amount: f.amount, status: f.status, dueDate: f.dueDate })),
          timetableToday: slots.map((sl) => ({
            period: sl.period,
            subject: sl.subject.name,
            color: sl.subject.color,
            teacher: sl.teacher.user.name,
            room: sl.room?.name ?? null,
          })),
        };
      }),
    );

    res.json({ role, day, cards });
  }),
);

// Aggregated metrics for the admin/principal dashboard.
router.get(
  '/stats',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const students = await prisma.student.count({ where: { schoolId } });
    const t = await representativeDate(schoolId, students);
    const [teacherList, classes, repAtt, live, fees, docsReview, activeEmergency, absencesToday, eventCount, aiCount] =
      await Promise.all([
        prisma.teacher.findMany({ where: { schoolId } }),
        prisma.class.count({ where: { schoolId } }),
        prisma.attendance.findMany({ where: { schoolId, date: t } }),
        todayAttendance(schoolId, students),
        prisma.fee.findMany({ where: { schoolId } }),
        prisma.document.count({ where: { schoolId, status: 'REVIEW' } }),
        prisma.emergencyIncident.findFirst({ where: { schoolId, status: 'ACTIVE' } }),
        prisma.staffAbsence.findMany({ where: { date: today(), teacher: { schoolId } }, include: { substitutions: true } }),
        prisma.event.count({ where: { schoolId } }),
        prisma.aILog.count({ where: { schoolId } }),
      ]);

    const teachers = teacherList.length;
    const present = repAtt.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    const attendanceRate = repAtt.length ? Math.round((present / repAtt.length) * 100) : 0;
    const outstanding = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
    const overdueCount = fees.filter((f) => f.status !== 'PAID').length;

    // ── Sub-scores that make up Operational Health (all from live data) ──
    const billed = fees.reduce((a, f) => a + f.amount, 0);
    const collected = fees.reduce((a, f) => a + f.paid, 0);
    const financeScore = billed ? Math.round((collected / billed) * 100) : 100;
    const overloaded = teacherList.filter((tt) => tt.weeklyHours >= tt.maxHours - 1).length;
    const peopleScore = teachers ? Math.round(100 - (overloaded / teachers) * 100) : 100;
    const uncovered = absencesToday.filter((a) => a.substitutions.length === 0).length;
    const operationsScore = Math.max(0, 100 - docsReview * 6 - uncovered * 12);
    const attendanceScore = attendanceRate;

    const health = Math.round(attendanceScore * 0.35 + financeScore * 0.25 + peopleScore * 0.2 + operationsScore * 0.2);

    // Admin time saved: each automated action (event + AI action) replaces ~8 min
    // of manual entry/coordination. Grounded in the append-only ledger counts.
    const automatedActions = eventCount + aiCount;
    const timeSavedHours = Math.round((automatedActions * 8) / 60);

    res.json({
      students,
      teachers,
      classes,
      attendanceRate, // representative-day rate — powers Health
      attendanceDate: t,
      present,
      totalMarked: repAtt.length,
      today: live, // live, real-time progress for today (may be partial)
      outstanding: Math.round(outstanding),
      overdueCount,
      docsInReview: docsReview,
      health,
      healthBreakdown: {
        attendance: attendanceScore,
        finance: financeScore,
        people: peopleScore,
        operations: operationsScore,
      },
      feeCollectionRate: financeScore,
      automatedActions,
      timeSavedHours,
      uncoveredToday: uncovered,
      emergencyActive: !!activeEmergency,
    });
  }),
);

// Operations intelligence — proxied verbatim from the Python engine.
// The old /command-center and /insights routes (hardcoded confidences,
// invented causes) were removed in favour of this: Node adds auth and a
// short cache, and computes NOTHING. If the engine is down the client gets
// an explicit offline state — never locally invented numbers.
router.get(
  '/intelligence',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    // ?fresh=1 bypasses the 30s cache — the dashboard's "Recompute" button,
    // so an admin who just changed data can see the effect immediately.
    const result = await getDashboardIntelligence(req.user!.schoolId, { fresh: req.query.fresh === '1' });
    res.json(result);
  }),
);

export default router;

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { DAYS, STAFF } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

// Digital Twin — a live snapshot of every building/room: which class is in,
// whether the teacher is present, live occupancy and attendance.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const jsDay = now.getDay(); // 0=Sun..6=Sat
    const day = jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1; // map to Mon=0..Fri=4
    // Derive current period from the hour (school day ~ 8am, 45-min periods).
    const period = Math.max(0, Math.min(7, Math.floor((now.getHours() - 8))));

    const [buildings, activeTT, absences, activeEmergency] = await Promise.all([
      prisma.building.findMany({ where: { schoolId }, include: { rooms: { include: { classes: true } } } }),
      prisma.timetable.findFirst({ where: { schoolId, active: true } }),
      prisma.staffAbsence.findMany({ where: { date, teacher: { schoolId } } }),
      prisma.emergencyIncident.findFirst({ where: { schoolId, status: 'ACTIVE' } }),
    ]);
    const absentTeacherIds = new Set(absences.map((a) => a.teacherId));

    const slots = activeTT
      ? await prisma.timetableSlot.findMany({
          where: { timetableId: activeTT.id, day, period },
          include: { class: true, subject: true, teacher: { include: { user: true } }, room: true },
        })
      : [];
    const slotByRoom = new Map(slots.filter((s) => s.roomId).map((s) => [s.roomId!, s]));
    const slotByClass = new Map(slots.map((s) => [s.classId, s]));

    // Today's attendance per class for occupancy %.
    const att = await prisma.attendance.findMany({ where: { schoolId, date } });
    const attByClass: Record<string, { present: number; total: number }> = {};
    for (const a of att) {
      attByClass[a.classId] ??= { present: 0, total: 0 };
      attByClass[a.classId].total++;
      if (a.status === 'PRESENT' || a.status === 'LATE') attByClass[a.classId].present++;
    }

    const buildingsOut = buildings.map((b) => ({
      id: b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      floors: b.floors,
      rooms: b.rooms.map((r) => {
        const slot = slotByRoom.get(r.id) ?? (r.classes[0] ? slotByClass.get(r.classes[0].id) : undefined);
        const cls = slot?.class ?? r.classes[0];
        const a = cls ? attByClass[cls.id] : undefined;
        const teacherPresent = slot ? !absentTeacherIds.has(slot.teacherId) : false;
        const attendancePct = a && a.total ? Math.round((a.present / a.total) * 100) : null;
        return {
          id: r.id,
          name: r.name,
          type: r.type,
          className: cls?.name ?? null,
          subject: slot?.subject.name ?? null,
          teacher: slot?.teacher.user.name ?? null,
          teacherPresent,
          occupied: !!slot,
          attendancePct,
          power: 'normal',
        };
      }),
    }));

    res.json({
      day: DAYS[day],
      period: period + 1,
      emergency: activeEmergency ? activeEmergency.kind : null,
      buildings: buildingsOut,
    });
  }),
);

export default router;

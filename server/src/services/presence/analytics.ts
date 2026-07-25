import { prisma } from '../../lib/prisma.js';

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Daily trend from the materialized Attendance table — the same source of truth
// every other engine (Dashboard/Twin/Foresight) reads.
export async function attendanceTrend(schoolId: string, days: number) {
  const since = daysAgo(days - 1);
  const [rows, totalStudents] = await Promise.all([
    prisma.attendance.findMany({ where: { schoolId, timestamp: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.student.count({ where: { schoolId, active: true } }),
  ]);
  const byDate: Record<string, { present: number; late: number; absent: number; total: number }> = {};
  for (const a of rows) {
    byDate[a.date] ??= { present: 0, late: 0, absent: 0, total: 0 };
    byDate[a.date].total++;
    if (a.status === 'PRESENT') byDate[a.date].present++;
    else if (a.status === 'LATE') byDate[a.date].late++;
    else if (a.status === 'ABSENT') byDate[a.date].absent++;
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      present: v.present,
      late: v.late,
      absent: v.absent,
      marked: v.total,
      rate: v.total ? Math.round(((v.present + v.late) / v.total) * 100) : 0,
      coverage: totalStudents ? Math.round((v.total / totalStudents) * 100) : 0,
    }));
}

export async function todaySummary(schoolId: string) {
  const date = dateStr(new Date());
  const [attendance, totalStudents, activeSessions, proxyToday] = await Promise.all([
    prisma.attendance.findMany({ where: { schoolId, date } }),
    prisma.student.count({ where: { schoolId, active: true } }),
    prisma.attendanceSession.count({ where: { schoolId, status: 'ACTIVE' } }),
    prisma.attendanceEvent.count({ where: { schoolId, verificationStatus: 'PROXY', timestamp: { gte: new Date(`${date}T00:00:00`) } } }),
  ]);
  const present = attendance.filter((a) => a.status === 'PRESENT').length;
  const late = attendance.filter((a) => a.status === 'LATE').length;
  // Absent means someone marked them absent. Not-yet-marked is its own state:
  // deriving both from `totalStudents - marked` reported every unmarked student
  // twice, so before roll-call the four states summed to double the school.
  const absent = attendance.filter((a) => a.status === 'ABSENT').length;
  const marked = attendance.length;
  return {
    date,
    totalStudents,
    present,
    late,
    absent,
    unmarked: Math.max(0, totalStudents - marked),
    activeSessions,
    proxyAttempts: proxyToday,
  };
}

// Live occupancy from today's PRESENT/LATE marks (session attendance has no
// exit concept — a mark means "in class today").
export async function campusOccupancy(schoolId: string) {
  const date = dateStr(new Date());
  const present = await prisma.attendance.count({ where: { schoolId, date, status: { in: ['PRESENT', 'LATE'] } } });
  return { onCampus: present, entries: present, exits: 0 };
}

export async function lateStudents(schoolId: string, days = 14, limit = 20) {
  const since = daysAgo(days - 1);
  const events = await prisma.attendanceEvent.findMany({
    where: { schoolId, late: true, timestamp: { gte: since } },
    include: { student: { select: { id: true, name: true, rollNo: true, class: { select: { name: true } } } } },
  });
  const byStudent = new Map<string, { studentId: string; name: string; rollNo: number; className?: string; count: number; totalMinutes: number }>();
  for (const e of events) {
    if (!e.student) continue;
    const row = byStudent.get(e.student.id) ?? { studentId: e.student.id, name: e.student.name, rollNo: e.student.rollNo, className: e.student.class?.name, count: 0, totalMinutes: 0 };
    row.count++;
    row.totalMinutes += e.lateMinutes ?? 0;
    byStudent.set(e.student.id, row);
  }
  return [...byStudent.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function frequentAbsences(schoolId: string, days = 30, limit = 20) {
  const since = dateStr(daysAgo(days - 1));
  const rows = await prisma.attendance.findMany({
    where: { schoolId, status: 'ABSENT', date: { gte: since } },
    include: { student: { select: { id: true, name: true, rollNo: true, class: { select: { name: true } } } } },
  });
  const byStudent = new Map<string, { studentId: string; name: string; rollNo: number; className?: string; count: number }>();
  for (const a of rows) {
    const row = byStudent.get(a.studentId) ?? { studentId: a.studentId, name: a.student.name, rollNo: a.student.rollNo, className: a.student.class?.name, count: 0 };
    row.count++;
    byStudent.set(a.studentId, row);
  }
  return [...byStudent.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function peakEntryTime(schoolId: string, days = 14) {
  const since = daysAgo(days - 1);
  const events = await prisma.attendanceEvent.findMany({
    where: { schoolId, verificationStatus: { in: ['VERIFIED', 'LATE'] }, timestamp: { gte: since } },
    select: { timestamp: true },
  });
  const byHour = new Array(24).fill(0);
  for (const e of events) byHour[e.timestamp.getHours()]++;
  const histogram = byHour.map((count, hour) => ({ hour, count }));
  const peak = histogram.reduce((max, h) => (h.count > max.count ? h : max), histogram[0]);
  return { histogram, peakHour: peak.hour, peakCount: peak.count };
}

// Method breakdown — how attendance is actually being captured (face vs QR vs
// manual) plus the proxy-attempt count. Replaces the old per-reader usage.
export async function methodBreakdown(schoolId: string, days = 14) {
  const since = daysAgo(days - 1);
  const events = await prisma.attendanceEvent.findMany({ where: { schoolId, timestamp: { gte: since } }, select: { source: true, verificationStatus: true } });
  const marked = events.filter((e) => e.verificationStatus === 'VERIFIED' || e.verificationStatus === 'LATE');
  const bySource = { FACE: 0, QR: 0, MANUAL: 0 } as Record<string, number>;
  for (const e of marked) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  return {
    face: bySource.FACE,
    qr: bySource.QR,
    manual: bySource.MANUAL,
    proxyAttempts: events.filter((e) => e.verificationStatus === 'PROXY').length,
    unverifiedQr: events.filter((e) => e.verificationStatus === 'UNVERIFIED_QR').length,
  };
}

import { prisma } from '../../lib/prisma.js';

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Daily/weekly/monthly trend from the materialized Attendance table — the
// same source-of-truth every other engine (Dashboard/Twin/Foresight) reads.
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
  const [attendance, totalStudents, readers, unknownToday] = await Promise.all([
    prisma.attendance.findMany({ where: { schoolId, date } }),
    prisma.student.count({ where: { schoolId, active: true } }),
    prisma.rFIDReader.findMany({ where: { schoolId } }),
    prisma.attendanceEvent.count({ where: { schoolId, verificationStatus: 'UNKNOWN', timestamp: { gte: new Date(`${date}T00:00:00`) } } }),
  ]);
  const present = attendance.filter((a) => a.status === 'PRESENT').length;
  const late = attendance.filter((a) => a.status === 'LATE').length;
  const marked = attendance.length;
  return {
    date,
    totalStudents,
    present,
    late,
    absent: Math.max(0, totalStudents - marked),
    unmarked: Math.max(0, totalStudents - marked),
    readersOnline: readers.filter((r) => r.online).length,
    readersOffline: readers.filter((r) => !r.online).length,
    unknownCards: unknownToday,
  };
}

// Naive occupancy: verified/late ENTRY+REENTRY minus EXIT events today.
export async function campusOccupancy(schoolId: string) {
  const date = dateStr(new Date());
  const events = await prisma.attendanceEvent.findMany({
    where: { schoolId, verificationStatus: { in: ['VERIFIED', 'LATE'] }, timestamp: { gte: new Date(`${date}T00:00:00`) } },
    select: { direction: true },
  });
  const entries = events.filter((e) => e.direction === 'ENTRY' || e.direction === 'REENTRY').length;
  const exits = events.filter((e) => e.direction === 'EXIT').length;
  return { onCampus: Math.max(0, entries - exits), entries, exits };
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
    where: { schoolId, direction: { in: ['ENTRY', 'REENTRY'] }, verificationStatus: { in: ['VERIFIED', 'LATE'] }, timestamp: { gte: since } },
    select: { timestamp: true },
  });
  const byHour = new Array(24).fill(0);
  for (const e of events) byHour[e.timestamp.getHours()]++;
  const histogram = byHour.map((count, hour) => ({ hour, count }));
  const peak = histogram.reduce((max, h) => (h.count > max.count ? h : max), histogram[0]);
  return { histogram, peakHour: peak.hour, peakCount: peak.count };
}

export async function readerUsage(schoolId: string, days = 14) {
  const since = daysAgo(days - 1);
  const [readers, events] = await Promise.all([
    prisma.rFIDReader.findMany({ where: { schoolId } }),
    prisma.attendanceEvent.findMany({ where: { schoolId, readerId: { not: null }, timestamp: { gte: since } }, select: { readerId: true, verificationStatus: true } }),
  ]);
  const byReader = new Map<string, { readerId: string; name: string; location: string; total: number; verified: number; duplicate: number; unknown: number; rejected: number }>();
  for (const r of readers) byReader.set(r.id, { readerId: r.id, name: r.name, location: r.location, total: 0, verified: 0, duplicate: 0, unknown: 0, rejected: 0 });
  for (const e of events) {
    if (!e.readerId) continue;
    const row = byReader.get(e.readerId);
    if (!row) continue;
    row.total++;
    if (e.verificationStatus === 'VERIFIED' || e.verificationStatus === 'LATE') row.verified++;
    else if (e.verificationStatus === 'DUPLICATE') row.duplicate++;
    else if (e.verificationStatus === 'UNKNOWN') row.unknown++;
    else if (e.verificationStatus === 'REJECTED') row.rejected++;
  }
  return [...byReader.values()].sort((a, b) => b.total - a.total);
}

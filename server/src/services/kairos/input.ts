import { prisma } from '../../lib/prisma.js';
import { fromJson } from '../../lib/json.js';
import type { BreakDef, CellRef, GridShape, LoadedData, LessonDemand } from './types.js';

const DAY_POOL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Minutes since midnight → "HH:MM". */
function hhmm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface AcademicConfigShape {
  academicYear: string;
  terms: { name: string; start: string; end: string }[];
  workingDays: number;
  dayStart: string;
  periodMinutes: number;
  periodsPerDay: number;
  breaks: BreakDef[];
  blocked: (CellRef & { reason: string })[];
  holidays: string[];
  examWeeks: { name: string; start: string; end: string }[];
}

export const DEFAULT_CONFIG: AcademicConfigShape = {
  academicYear: '2026-27',
  terms: [],
  workingDays: 5,
  dayStart: '08:00',
  periodMinutes: 45,
  periodsPerDay: 8,
  breaks: [
    { after: 1, name: 'Short break', minutes: 10 },
    { after: 4, name: 'Lunch', minutes: 40 },
  ],
  blocked: [{ day: 0, period: 0, reason: 'Assembly' }],
  holidays: [],
  examWeeks: [],
};

export async function loadConfig(schoolId: string): Promise<{ cfg: AcademicConfigShape; exists: boolean }> {
  const row = await prisma.academicConfig.findUnique({ where: { schoolId } });
  if (!row) return { cfg: DEFAULT_CONFIG, exists: false };
  return {
    exists: true,
    cfg: {
      academicYear: row.academicYear,
      terms: fromJson(row.termsString, [] as AcademicConfigShape['terms']),
      workingDays: Math.min(6, Math.max(1, row.workingDays)),
      dayStart: row.dayStart,
      periodMinutes: row.periodMinutes,
      periodsPerDay: Math.min(10, Math.max(4, row.periodsPerDay)),
      breaks: fromJson(row.breaksString, DEFAULT_CONFIG.breaks),
      blocked: fromJson(row.blockedString, DEFAULT_CONFIG.blocked),
      holidays: fromJson(row.holidaysString, [] as string[]),
      examWeeks: fromJson(row.examWeeksString, [] as AcademicConfigShape['examWeeks']),
    },
  };
}

/** Expand a config into the concrete grid the solver + UI both consume. */
export function buildGrid(cfg: AcademicConfigShape): GridShape {
  const [h, m] = cfg.dayStart.split(':').map(Number);
  let cursor = (h || 8) * 60 + (m || 0);
  const periodTimes: { start: string; end: string }[] = [];
  for (let p = 0; p < cfg.periodsPerDay; p++) {
    const start = cursor;
    cursor += cfg.periodMinutes;
    periodTimes.push({ start: hhmm(start), end: hhmm(cursor) });
    const brk = cfg.breaks.find((b) => b.after === p);
    if (brk) cursor += brk.minutes;
  }
  return {
    days: DAY_POOL.slice(0, cfg.workingDays),
    periodsPerDay: cfg.periodsPerDay,
    periodLabels: Array.from({ length: cfg.periodsPerDay }, (_, i) => `P${i + 1}`),
    periodTimes,
    breaks: cfg.breaks.filter((b) => b.after < cfg.periodsPerDay),
    blocked: cfg.blocked.filter((b) => b.day < cfg.workingDays && b.period < cfg.periodsPerDay),
  };
}

/**
 * Load everything the engine needs for one school. Pure data out — the
 * solver never touches the database.
 */
export async function loadSolverInput(schoolId: string): Promise<LoadedData> {
  const [{ cfg, exists }, classes, teachers, rooms] = await Promise.all([
    loadConfig(schoolId),
    prisma.class.findMany({
      where: { schoolId },
      include: {
        room: true,
        subjectPlans: { include: { subject: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
    prisma.teacher.findMany({ where: { schoolId }, include: { user: true } }),
    prisma.room.findMany({ where: { building: { schoolId } } }),
  ]);

  const lessons: LessonDemand[] = [];
  const classesWithoutPlan: { id: string; name: string }[] = [];

  for (const c of classes) {
    if (c.subjectPlans.length === 0) {
      classesWithoutPlan.push({ id: c.id, name: c.name });
      continue;
    }
    for (const plan of c.subjectPlans) {
      if (plan.weeklyPeriods <= 0) continue;
      lessons.push({
        classId: c.id,
        className: c.name,
        classSize: c._count.students,
        homeRoomId: c.roomId ?? undefined,
        subjectId: plan.subjectId,
        subjectCode: plan.subject.code,
        subjectName: plan.subject.name,
        color: plan.subject.color,
        cognitiveLoad: plan.subject.cognitiveLoad,
        requiresLab: plan.requiresLab || plan.subject.requiresLab,
        elective: plan.elective,
        weeklyPeriods: plan.weeklyPeriods,
      });
    }
  }

  return {
    schoolId,
    grid: buildGrid(cfg),
    lessons,
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.user.name,
      subjects: fromJson<string[]>(t.subjectsString, []),
      maxWeekly: t.maxHours,
      maxDaily: t.maxDailyPeriods,
      maxConsecutive: t.maxConsecutive,
      partTime: t.partTime,
      unavailable: fromJson<CellRef[]>(t.unavailableString, []),
      preferredFree: fromJson<CellRef[]>(t.preferredFreeString, []),
    })),
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      unavailable: fromJson<CellRef[]>(r.unavailableString, []),
    })),
    classesWithoutPlan,
    hasConfig: exists,
  };
}

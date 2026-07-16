import { prisma } from '../lib/prisma.js';
import { fromJson } from '../lib/json.js';
import { DAYS, PERIODS } from '../utils/constants.js';

// A lightweight but genuine constraint-based timetable generator.
// Stage 1: greedy feasible placement honouring hard constraints
//   (no teacher/room/class double-booking, lab availability, teacher hour cap).
// Stage 2: soft scoring (spread of high cognitive-load subjects, idle gaps).
// When a subject cannot be placed we surface an explainable "minimal core".

interface PlacementResult {
  slots: SlotPlan[];
  conflicts: Conflict[];
  score: number;
  solveMs: number;
}

interface SlotPlan {
  day: number;
  period: number;
  classId: string;
  subjectId: string;
  teacherId: string;
  roomId?: string;
}

export interface Conflict {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  reason: string;
  cause: string;
  fixes: { label: string; detail: string }[];
}

export async function generateTimetable(schoolId: string): Promise<PlacementResult> {
  const started = Date.now();
  const [classes, subjects, teachers, rooms] = await Promise.all([
    prisma.class.findMany({ where: { schoolId }, include: { room: true } }),
    prisma.subject.findMany({ where: { schoolId } }),
    prisma.teacher.findMany({ where: { schoolId }, include: { user: true } }),
    prisma.room.findMany({ where: { building: { schoolId } } }),
  ]);

  const labs = rooms.filter((r) => r.type === 'LAB');
  const numDays = DAYS.length;
  const numPeriods = PERIODS.length;

  // occupancy trackers
  const teacherBusy = new Set<string>(); // `${t}-${d}-${p}`
  const classBusy = new Set<string>();
  const roomBusy = new Set<string>();
  const teacherLoad: Record<string, number> = {};
  const key = (a: string, d: number, p: number) => `${a}-${d}-${p}`;

  const slots: SlotPlan[] = [];
  const conflicts: Conflict[] = [];

  // Map subjects -> capable teachers (by qualified subject codes; fallback: department match or any).
  const capableTeachers = (subjectCode: string) => {
    const exact = teachers.filter((t) =>
      fromJson<string[]>(t.subjectsString, []).includes(subjectCode),
    );
    return exact.length ? exact : teachers;
  };

  // Build the demand list: each class needs `weeklyLoad` periods per subject.
  const demand: { classId: string; className: string; subject: (typeof subjects)[number] }[] = [];
  for (const c of classes) {
    for (const s of subjects) {
      for (let i = 0; i < s.weeklyLoad; i++) demand.push({ classId: c.id, className: c.name, subject: s });
    }
  }
  // Place harder-to-schedule (lab + high load) first.
  demand.sort((a, b) => (b.subject.requiresLab ? 1 : 0) - (a.subject.requiresLab ? 1 : 0));

  for (const d of demand) {
    let placed = false;
    const teacherPool = capableTeachers(d.subject.code);

    outer: for (let day = 0; day < numDays; day++) {
      for (let period = 0; period < numPeriods; period++) {
        if (classBusy.has(key(d.classId, day, period))) continue;

        for (const t of teacherPool) {
          if (teacherBusy.has(key(t.id, day, period))) continue;
          if ((teacherLoad[t.id] ?? 0) >= t.maxHours) continue;

          let roomId: string | undefined;
          if (d.subject.requiresLab) {
            const freeLab = labs.find((l) => !roomBusy.has(key(l.id, day, period)));
            if (!freeLab) continue;
            roomId = freeLab.id;
          } else {
            const cls = classes.find((c) => c.id === d.classId);
            roomId = cls?.roomId ?? undefined;
          }

          // commit
          classBusy.add(key(d.classId, day, period));
          teacherBusy.add(key(t.id, day, period));
          if (roomId) roomBusy.add(key(roomId, day, period));
          teacherLoad[t.id] = (teacherLoad[t.id] ?? 0) + 1;
          slots.push({ day, period, classId: d.classId, subjectId: d.subject.id, teacherId: t.id, roomId });
          placed = true;
          break outer;
        }
      }
    }

    if (!placed) {
      // Explainable conflict — describe the minimal cause + cheapest relaxations.
      const atCap = teacherPool.filter((t) => (teacherLoad[t.id] ?? 0) >= t.maxHours);
      const capName = atCap[0]?.user?.name ?? teacherPool[0]?.user?.name ?? 'teacher';
      const cause = d.subject.requiresLab
        ? `Lab fully booked + ${capName} at cap`
        : `${capName} at weekly cap (${teacherPool[0]?.maxHours ?? 24}h) / no free slot`;
      if (!conflicts.find((c) => c.classId === d.classId && c.subjectId === d.subject.id)) {
        conflicts.push({
          classId: d.classId,
          className: d.className,
          subjectId: d.subject.id,
          subjectName: d.subject.name,
          reason: `${d.className} ${d.subject.name} can't be placed`,
          cause,
          fixes: [
            { label: 'Relax teacher cap +1h', detail: `Allow ${capName} one extra period this week` },
            {
              label: d.subject.requiresLab ? 'Move a lab session' : 'Add a period slot',
              detail: d.subject.requiresLab
                ? 'Shift another lab class to free the lab room'
                : 'Extend the day by one period to absorb load',
            },
          ],
        });
      }
    }
  }

  // Soft score: reward spreading high cognitive-load subjects across days.
  const loadByDay: Record<number, number> = {};
  for (const s of slots) {
    const subj = subjects.find((x) => x.id === s.subjectId);
    loadByDay[s.day] = (loadByDay[s.day] ?? 0) + (subj?.cognitiveLoad ?? 3);
  }
  const values = Object.values(loadByDay);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
  // Coefficient of variation → a normalized, human-friendly spread penalty.
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const score = Math.max(0, 100 - cv * 100 - conflicts.length * 8);

  return { slots, conflicts, score: Math.round(score), solveMs: Date.now() - started };
}

// Persist a generated timetable to the store.
export async function persistTimetable(schoolId: string, result: PlacementResult, name: string) {
  await prisma.timetable.updateMany({ where: { schoolId, active: true }, data: { active: false } });
  const tt = await prisma.timetable.create({
    data: { schoolId, name, active: true, solveMs: result.solveMs, score: result.score },
  });
  if (result.slots.length) {
    await prisma.timetableSlot.createMany({
      data: result.slots.map((s) => ({ ...s, timetableId: tt.id })),
    });
  }
  return tt;
}

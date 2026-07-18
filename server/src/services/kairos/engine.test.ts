import { describe, expect, it } from 'vitest';
import { solve, verifySolution } from './engine.js';
import type { Assignment, GridShape, SolverInput } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pure engine tests — no database. Every hard constraint is asserted the hard
// way: by independently re-checking the produced schedule.
// ─────────────────────────────────────────────────────────────────────────────

function grid(days = 5, periods = 8): GridShape {
  return {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].slice(0, days),
    periodsPerDay: periods,
    periodLabels: Array.from({ length: periods }, (_, i) => `P${i + 1}`),
    periodTimes: Array.from({ length: periods }, (_, i) => ({ start: `0${8 + i}:00`, end: `0${8 + i}:45` })),
    breaks: [],
    blocked: [{ day: 0, period: 0, reason: 'Assembly' }],
  };
}

function baseInput(): SolverInput {
  return {
    schoolId: 'test',
    grid: grid(),
    rooms: [
      { id: 'R1', name: 'R1', type: 'CLASSROOM', capacity: 40, unavailable: [] },
      { id: 'R2', name: 'R2', type: 'CLASSROOM', capacity: 40, unavailable: [] },
      { id: 'LAB1', name: 'Lab 1', type: 'LAB', capacity: 30, unavailable: [] },
    ],
    teachers: [
      { id: 'tm', name: 'Ms. Math', subjects: ['MATH'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
      { id: 'ts', name: 'Mr. Sci', subjects: ['SCI'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
      { id: 'te', name: 'Ms. Eng', subjects: ['ENG'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
      { id: 'tx', name: 'Mr. Multi', subjects: ['MATH', 'ENG'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
    ],
    lessons: [
      { classId: 'A', className: '9A', classSize: 30, homeRoomId: 'R1', subjectId: 'sM', subjectCode: 'MATH', subjectName: 'Maths', color: '#000', cognitiveLoad: 5, requiresLab: false, elective: false, weeklyPeriods: 6 },
      { classId: 'A', className: '9A', classSize: 30, homeRoomId: 'R1', subjectId: 'sS', subjectCode: 'SCI', subjectName: 'Science', color: '#000', cognitiveLoad: 5, requiresLab: true, elective: false, weeklyPeriods: 4 },
      { classId: 'A', className: '9A', classSize: 30, homeRoomId: 'R1', subjectId: 'sE', subjectCode: 'ENG', subjectName: 'English', color: '#000', cognitiveLoad: 3, requiresLab: false, elective: false, weeklyPeriods: 5 },
      { classId: 'B', className: '9B', classSize: 30, homeRoomId: 'R2', subjectId: 'sM', subjectCode: 'MATH', subjectName: 'Maths', color: '#000', cognitiveLoad: 5, requiresLab: false, elective: false, weeklyPeriods: 6 },
      { classId: 'B', className: '9B', classSize: 30, homeRoomId: 'R2', subjectId: 'sS', subjectCode: 'SCI', subjectName: 'Science', color: '#000', cognitiveLoad: 5, requiresLab: true, elective: false, weeklyPeriods: 4 },
      { classId: 'B', className: '9B', classSize: 30, homeRoomId: 'R2', subjectId: 'sE', subjectCode: 'ENG', subjectName: 'English', color: '#000', cognitiveLoad: 3, requiresLab: false, elective: false, weeklyPeriods: 5 },
    ],
  };
}

/** Independent hard-constraint audit (mirrors the DB audit script). */
function audit(input: SolverInput, assignments: Assignment[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]));
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const lessonBy = new Map(input.lessons.map((l) => [`${l.classId}|${l.subjectId}`, l]));
  const blocked = new Set(input.grid.blocked.map((b) => `${b.day}|${b.period}`));

  for (const a of assignments) {
    for (const k of [`C|${a.classId}|${a.day}|${a.period}`, `T|${a.teacherId}|${a.day}|${a.period}`, ...(a.roomId ? [`R|${a.roomId}|${a.day}|${a.period}`] : [])]) {
      if (seen.has(k)) problems.push(`double-booking ${k}`);
      seen.add(k);
    }
    const lesson = lessonBy.get(`${a.classId}|${a.subjectId}`)!;
    const t = teacherById.get(a.teacherId)!;
    if (!t.subjects.includes(lesson.subjectCode)) problems.push(`unqualified ${t.name} for ${lesson.subjectCode}`);
    if (blocked.has(`${a.day}|${a.period}`)) problems.push('blocked cell used');
    if (t.unavailable.some((u) => u.day === a.day && u.period === a.period)) problems.push(`${t.name} scheduled while unavailable`);
    if (lesson.requiresLab && roomById.get(a.roomId ?? '')?.type !== 'LAB') problems.push('lab lesson without lab');
  }
  for (const t of input.teachers) {
    const mine = assignments.filter((a) => a.teacherId === t.id);
    if (mine.length > t.maxWeekly) problems.push(`${t.name} weekly ${mine.length} > ${t.maxWeekly}`);
    for (let d = 0; d < input.grid.days.length; d++) {
      const daily = mine.filter((a) => a.day === d).map((a) => a.period).sort((x, y) => x - y);
      if (daily.length > t.maxDaily) problems.push(`${t.name} daily ${daily.length} > ${t.maxDaily}`);
      let run = daily.length ? 1 : 0;
      for (let i = 1; i < daily.length; i++) {
        run = daily[i] === daily[i - 1] + 1 ? run + 1 : 1;
        if (run > t.maxConsecutive) problems.push(`${t.name} consecutive run > ${t.maxConsecutive}`);
      }
    }
  }
  return problems;
}

describe('Kairos engine — hard constraints', () => {
  it('places the full demand with zero hard-constraint violations', () => {
    const input = baseInput();
    const res = solve(input, { timeBudgetMs: 1500, seed: 7 });
    expect(res.stats.total).toBe(30);
    expect(res.unplaced).toHaveLength(0);
    expect(res.assignments).toHaveLength(30);
    expect(audit(input, res.assignments)).toEqual([]);
    expect(verifySolution(input, res.assignments)).toEqual([]);
    expect(res.score).toBeGreaterThan(70);
  });

  it('never assigns an unqualified teacher, even when that means unplaced lessons', () => {
    const input = baseInput();
    // Nobody teaches SCI any more.
    input.teachers = input.teachers.filter((t) => t.id !== 'ts');
    const res = solve(input, { timeBudgetMs: 800, seed: 3 });
    expect(audit(input, res.assignments)).toEqual([]);
    const sci = res.unplaced.filter((u) => u.subjectName === 'Science');
    expect(sci.length).toBe(2); // one entry per class
    expect(sci.reduce((a, u) => a + u.count, 0)).toBe(8); // 4 periods each
    for (const u of sci) expect(u.cause).toMatch(/No teacher is qualified/i);
  });

  it('respects the weekly cap and explains the shortfall', () => {
    const input = baseInput();
    // English teacher capped below demand (10 needed), Multi removed from ENG.
    input.teachers = input.teachers.map((t) =>
      t.id === 'te' ? { ...t, maxWeekly: 6 } : t.id === 'tx' ? { ...t, subjects: ['MATH'] } : t,
    );
    const res = solve(input, { timeBudgetMs: 800, seed: 5 });
    expect(audit(input, res.assignments)).toEqual([]);
    const engPlaced = res.assignments.filter((a) => a.subjectId === 'sE');
    expect(engPlaced.length).toBeLessThanOrEqual(6);
    const eng = res.unplaced.find((u) => u.subjectName === 'English');
    expect(eng).toBeDefined();
    expect(eng!.cause).toMatch(/weekly limit/i);
  });

  it('honours teacher unavailability (part-timer off Friday)', () => {
    const input = baseInput();
    input.teachers = input.teachers.map((t) =>
      t.id === 'tm' ? { ...t, unavailable: Array.from({ length: 8 }, (_, p) => ({ day: 4, period: p })) } : t,
    );
    const res = solve(input, { timeBudgetMs: 1200, seed: 11 });
    expect(audit(input, res.assignments)).toEqual([]);
    expect(res.assignments.filter((a) => a.teacherId === 'tm' && a.day === 4)).toHaveLength(0);
  });

  it('keeps locked slots exactly where they are', () => {
    const input = baseInput();
    const locked: Assignment[] = [
      { classId: 'A', subjectId: 'sM', day: 2, period: 3, teacherId: 'tm', roomId: 'R1', locked: true },
      { classId: 'B', subjectId: 'sE', day: 1, period: 1, teacherId: 'te', roomId: 'R2', locked: true },
    ];
    const res = solve(input, { locked, timeBudgetMs: 1200, seed: 13 });
    expect(audit(input, res.assignments)).toEqual([]);
    for (const l of locked) {
      const kept = res.assignments.find(
        (a) => a.classId === l.classId && a.day === l.day && a.period === l.period && a.teacherId === l.teacherId && a.locked,
      );
      expect(kept, `locked ${l.classId} ${l.day}/${l.period}`).toBeDefined();
    }
  });

  it('puts lab subjects in labs and reports lab starvation honestly', () => {
    const input = baseInput();
    // Single lab, and it is almost never available.
    input.rooms = input.rooms.map((r) =>
      r.id === 'LAB1'
        ? { ...r, unavailable: Array.from({ length: 5 * 8 }, (_, i) => ({ day: Math.floor(i / 8), period: i % 8 })).filter((_, i) => i % 8 !== 7) }
        : r,
    );
    const res = solve(input, { timeBudgetMs: 800, seed: 17 });
    expect(audit(input, res.assignments)).toEqual([]);
    // Only 5 lab cells exist (P8 each day) for 8 lab lessons.
    const sciPlaced = res.assignments.filter((a) => a.subjectId === 'sS');
    expect(sciPlaced.length).toBeLessThanOrEqual(5);
    expect(res.unplaced.some((u) => u.subjectName === 'Science')).toBe(true);
  });

  it('attaches a plain-English explanation to every placement', () => {
    const input = baseInput();
    const res = solve(input, { timeBudgetMs: 1000, seed: 19 });
    for (const a of res.assignments) {
      expect(a.explain?.reasons.length).toBeGreaterThanOrEqual(3);
      expect(a.explain!.confidence).toBeGreaterThanOrEqual(0.7);
      expect(a.explain!.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('verifySolution catches corrupted schedules', () => {
    const input = baseInput();
    const res = solve(input, { timeBudgetMs: 800, seed: 23 });
    const bad = [...res.assignments];
    // Force a teacher double-booking.
    bad[0] = { ...bad[0], day: bad[1].day, period: bad[1].period, teacherId: bad[1].teacherId };
    expect(verifySolution(input, bad).length).toBeGreaterThan(0);
  });
});

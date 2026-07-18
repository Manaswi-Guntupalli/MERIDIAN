import type {
  Assignment,
  LessonDemand,
  RoomInfo,
  SolveResult,
  SolverInput,
  TeacherInfo,
  UnplacedLesson,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kairos engine — constraint optimization for school timetables.
//
// Approach (all pure, no I/O):
//   1. Expand curriculum into lesson units and order them hardest-first
//      (labs, scarce teachers, big loads) — the classic most-constrained-
//      variable heuristic.
//   2. Constructive pass: place each unit at its cheapest feasible
//      (day, period, teacher, room) under ALL hard constraints.
//   3. Repair pass: units that found no home try single-level displacement —
//      evict a blocking lesson if the evictee can relocate somewhere legal.
//   4. Random restarts keep the best of several attempts.
//   5. Local search: hill-climb on the weighted soft-cost (spread, teacher
//      gaps, preferences, heavy-subject placement) within the time budget.
//
// Hard constraints are NEVER violated — a unit that can't be placed legally
// is reported as unplaced with a plain-English cause, not squeezed in.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SAME_SUBJECT_PER_DAY = 2;

/** Deterministic PRNG so tests are reproducible and restarts differ. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One schedulable period of one class-subject. */
interface Unit {
  lesson: LessonDemand;
  index: number; // 0..weeklyPeriods-1
}

const ck = (a: string, d: number, p: number) => `${a}|${d}|${p}`;
const dk = (a: string, d: number) => `${a}|${d}`;

export class ScheduleState {
  readonly input: SolverInput;
  readonly blocked: Set<string>;
  readonly labs: RoomInfo[];
  readonly classrooms: RoomInfo[];
  readonly teacherByCode = new Map<string, TeacherInfo[]>();
  readonly teacherById = new Map<string, TeacherInfo>();
  readonly roomById = new Map<string, RoomInfo>();
  readonly teacherUnavailable = new Set<string>();
  readonly roomUnavailable = new Set<string>();
  readonly teacherPreferredFree = new Set<string>();

  classBusy = new Set<string>();
  teacherBusy = new Set<string>();
  roomBusy = new Set<string>();
  teacherWeekly = new Map<string, number>();
  teacherDailyCount = new Map<string, number>();
  teacherPeriods = new Map<string, Set<number>>(); // teacher|day → periods
  classSubjectDay = new Map<string, number>(); // class|subject|day → count
  assignments: Assignment[] = [];

  constructor(input: SolverInput) {
    this.input = input;
    this.blocked = new Set(input.grid.blocked.map((b) => `${b.day}|${b.period}`));
    this.labs = input.rooms.filter((r) => r.type === 'LAB');
    this.classrooms = input.rooms.filter((r) => r.type === 'CLASSROOM');
    for (const t of input.teachers) {
      this.teacherById.set(t.id, t);
      for (const code of t.subjects) {
        const arr = this.teacherByCode.get(code) ?? [];
        arr.push(t);
        this.teacherByCode.set(code, arr);
      }
      for (const u of t.unavailable) this.teacherUnavailable.add(ck(t.id, u.day, u.period));
      for (const u of t.preferredFree) this.teacherPreferredFree.add(ck(t.id, u.day, u.period));
    }
    for (const r of input.rooms) {
      this.roomById.set(r.id, r);
      for (const u of r.unavailable) this.roomUnavailable.add(ck(r.id, u.day, u.period));
    }
  }

  qualified(code: string): TeacherInfo[] {
    return this.teacherByCode.get(code) ?? [];
  }

  /** Longest back-to-back run the teacher would have after adding `period`. */
  runLength(teacherId: string, day: number, period: number): number {
    const set = this.teacherPeriods.get(dk(teacherId, day));
    let run = 1;
    for (let p = period - 1; set?.has(p); p--) run++;
    for (let p = period + 1; set?.has(p); p++) run++;
    return run;
  }

  /**
   * Every hard-constraint violation for placing (unit, day, period, teacher,
   * room), in plain English. Empty array ⇒ the placement is legal.
   */
  placementIssues(
    lesson: LessonDemand,
    day: number,
    period: number,
    teacher: TeacherInfo,
    room: RoomInfo | undefined,
  ): string[] {
    const issues: string[] = [];
    const { grid } = this.input;
    if (day < 0 || day >= grid.days.length || period < 0 || period >= grid.periodsPerDay)
      issues.push('Outside the school week');
    if (this.blocked.has(`${day}|${period}`)) issues.push('That period is blocked (assembly/exam)');
    if (this.classBusy.has(ck(lesson.classId, day, period)))
      issues.push(`${lesson.className} already has a lesson then`);
    if (!teacher.subjects.includes(lesson.subjectCode))
      issues.push(`${teacher.name} is not qualified for ${lesson.subjectName}`);
    if (this.teacherBusy.has(ck(teacher.id, day, period)))
      issues.push(`${teacher.name} is already teaching then`);
    if (this.teacherUnavailable.has(ck(teacher.id, day, period)))
      issues.push(`${teacher.name} is unavailable then`);
    if ((this.teacherWeekly.get(teacher.id) ?? 0) >= teacher.maxWeekly)
      issues.push(`${teacher.name} is at their weekly limit (${teacher.maxWeekly})`);
    if ((this.teacherDailyCount.get(dk(teacher.id, day)) ?? 0) >= teacher.maxDaily)
      issues.push(`${teacher.name} is at their daily limit (${teacher.maxDaily})`);
    if (this.runLength(teacher.id, day, period) > teacher.maxConsecutive)
      issues.push(`Would give ${teacher.name} more than ${teacher.maxConsecutive} classes in a row`);
    if ((this.classSubjectDay.get(`${lesson.classId}|${lesson.subjectId}|${day}`) ?? 0) >= MAX_SAME_SUBJECT_PER_DAY)
      issues.push(`${lesson.className} already has ${lesson.subjectName} twice that day`);
    if (lesson.requiresLab && (!room || room.type !== 'LAB'))
      issues.push(`${lesson.subjectName} needs a laboratory`);
    if (room) {
      if (this.roomBusy.has(ck(room.id, day, period))) issues.push(`${room.name} is occupied then`);
      if (this.roomUnavailable.has(ck(room.id, day, period))) issues.push(`${room.name} is unavailable then`);
      if (room.capacity < lesson.classSize)
        issues.push(`${room.name} seats ${room.capacity} but ${lesson.className} has ${lesson.classSize}`);
    }
    return issues;
  }

  canPlace(lesson: LessonDemand, day: number, period: number, t: TeacherInfo, room?: RoomInfo): boolean {
    if (this.blocked.has(`${day}|${period}`)) return false;
    if (this.classBusy.has(ck(lesson.classId, day, period))) return false;
    if (!t.subjects.includes(lesson.subjectCode)) return false;
    if (this.teacherBusy.has(ck(t.id, day, period))) return false;
    if (this.teacherUnavailable.has(ck(t.id, day, period))) return false;
    if ((this.teacherWeekly.get(t.id) ?? 0) >= t.maxWeekly) return false;
    if ((this.teacherDailyCount.get(dk(t.id, day)) ?? 0) >= t.maxDaily) return false;
    if (this.runLength(t.id, day, period) > t.maxConsecutive) return false;
    if ((this.classSubjectDay.get(`${lesson.classId}|${lesson.subjectId}|${day}`) ?? 0) >= MAX_SAME_SUBJECT_PER_DAY)
      return false;
    if (lesson.requiresLab && (!room || room.type !== 'LAB')) return false;
    if (room) {
      if (this.roomBusy.has(ck(room.id, day, period))) return false;
      if (this.roomUnavailable.has(ck(room.id, day, period))) return false;
      if (room.capacity < lesson.classSize) return false;
    }
    return true;
  }

  /** Best legal room for a lesson at a cell, or undefined when none is needed/possible. */
  pickRoom(lesson: LessonDemand, day: number, period: number): { room?: RoomInfo; ok: boolean } {
    const free = (r: RoomInfo) =>
      !this.roomBusy.has(ck(r.id, day, period)) &&
      !this.roomUnavailable.has(ck(r.id, day, period)) &&
      r.capacity >= lesson.classSize;
    if (lesson.requiresLab) {
      const lab = this.labs.find(free);
      return lab ? { room: lab, ok: true } : { ok: false };
    }
    const home = lesson.homeRoomId ? this.roomById.get(lesson.homeRoomId) : undefined;
    if (home && free(home)) return { room: home, ok: true };
    const alt = this.classrooms.find(free);
    // Non-lab lessons may run without a mapped room (playground, hall…).
    return { room: alt, ok: true };
  }

  place(a: Assignment): void {
    this.classBusy.add(ck(a.classId, a.day, a.period));
    this.teacherBusy.add(ck(a.teacherId, a.day, a.period));
    if (a.roomId) this.roomBusy.add(ck(a.roomId, a.day, a.period));
    this.teacherWeekly.set(a.teacherId, (this.teacherWeekly.get(a.teacherId) ?? 0) + 1);
    this.teacherDailyCount.set(dk(a.teacherId, a.day), (this.teacherDailyCount.get(dk(a.teacherId, a.day)) ?? 0) + 1);
    let set = this.teacherPeriods.get(dk(a.teacherId, a.day));
    if (!set) this.teacherPeriods.set(dk(a.teacherId, a.day), (set = new Set()));
    set.add(a.period);
    const csd = `${a.classId}|${a.subjectId}|${a.day}`;
    this.classSubjectDay.set(csd, (this.classSubjectDay.get(csd) ?? 0) + 1);
    this.assignments.push(a);
  }

  remove(a: Assignment): void {
    this.classBusy.delete(ck(a.classId, a.day, a.period));
    this.teacherBusy.delete(ck(a.teacherId, a.day, a.period));
    if (a.roomId) this.roomBusy.delete(ck(a.roomId, a.day, a.period));
    this.teacherWeekly.set(a.teacherId, (this.teacherWeekly.get(a.teacherId) ?? 1) - 1);
    this.teacherDailyCount.set(dk(a.teacherId, a.day), (this.teacherDailyCount.get(dk(a.teacherId, a.day)) ?? 1) - 1);
    this.teacherPeriods.get(dk(a.teacherId, a.day))?.delete(a.period);
    const csd = `${a.classId}|${a.subjectId}|${a.day}`;
    this.classSubjectDay.set(csd, (this.classSubjectDay.get(csd) ?? 1) - 1);
    const i = this.assignments.indexOf(a);
    if (i >= 0) this.assignments.splice(i, 1);
  }

  /** Weighted soft-cost of placing lesson at cell with teacher/room, given current state. */
  softCost(lesson: LessonDemand, day: number, period: number, t: TeacherInfo, room?: RoomInfo): number {
    let cost = 0;
    const sameDay = this.classSubjectDay.get(`${lesson.classId}|${lesson.subjectId}|${day}`) ?? 0;
    if (sameDay >= 1) cost += lesson.requiresLab ? 2 : 6; // doubles ok-ish for labs
    if (this.teacherPreferredFree.has(ck(t.id, day, period))) cost += 4;
    if (lesson.cognitiveLoad >= 4 && period >= this.input.grid.periodsPerDay - 2) cost += 3;
    // Teacher gap: an isolated period far from the rest of their day.
    const set = this.teacherPeriods.get(dk(t.id, day));
    if (set && set.size > 0) {
      let nearest = Infinity;
      for (const p of set) nearest = Math.min(nearest, Math.abs(p - period));
      if (nearest > 1) cost += 2;
    }
    // Prefer spreading load onto lighter teachers.
    cost += ((this.teacherWeekly.get(t.id) ?? 0) / Math.max(1, t.maxWeekly)) * 2;
    if (!lesson.requiresLab && room && lesson.homeRoomId && room.id !== lesson.homeRoomId) cost += 1;
    return cost;
  }

  totalSoftCost(): number {
    // Recompute from scratch: cheap enough (≤ a few hundred assignments) and
    // immune to drift from incremental updates.
    let total = 0;
    for (const a of this.assignments) {
      const lesson = this.lessonOf(a);
      const t = this.teacherById.get(a.teacherId)!;
      if (!lesson || !t) continue;
      const sameDay = (this.classSubjectDay.get(`${a.classId}|${a.subjectId}|${a.day}`) ?? 1) - 1;
      if (sameDay >= 1) total += lesson.requiresLab ? 2 : 6;
      if (this.teacherPreferredFree.has(ck(t.id, a.day, a.period))) total += 4;
      if (lesson.cognitiveLoad >= 4 && a.period >= this.input.grid.periodsPerDay - 2) total += 3;
      if (!lesson.requiresLab && a.roomId && lesson.homeRoomId && a.roomId !== lesson.homeRoomId) total += 1;
    }
    // Teacher gaps, computed per teacher-day.
    for (const [key, set] of this.teacherPeriods) {
      if (set.size < 2) continue;
      const ps = [...set].sort((x, y) => x - y);
      for (let i = 1; i < ps.length; i++) total += Math.max(0, ps[i] - ps[i - 1] - 1) * 2;
      void key;
    }
    return total;
  }

  private lessonIndex?: Map<string, LessonDemand>;
  lessonOf(a: Assignment): LessonDemand | undefined {
    if (!this.lessonIndex) {
      this.lessonIndex = new Map();
      for (const l of this.input.lessons) this.lessonIndex.set(`${l.classId}|${l.subjectId}`, l);
    }
    return this.lessonIndex.get(`${a.classId}|${a.subjectId}`);
  }
}

interface Candidate {
  day: number;
  period: number;
  teacher: TeacherInfo;
  room?: RoomInfo;
  cost: number;
}

function candidatesFor(state: ScheduleState, lesson: LessonDemand, rnd: () => number, cap = Infinity): Candidate[] {
  const out: Candidate[] = [];
  const { grid } = state.input;
  for (let day = 0; day < grid.days.length; day++) {
    if ((state.classSubjectDay.get(`${lesson.classId}|${lesson.subjectId}|${day}`) ?? 0) >= MAX_SAME_SUBJECT_PER_DAY)
      continue;
    for (let period = 0; period < grid.periodsPerDay; period++) {
      if (state.blocked.has(`${day}|${period}`)) continue;
      if (state.classBusy.has(ck(lesson.classId, day, period))) continue;
      const { room, ok } = state.pickRoom(lesson, day, period);
      if (!ok) continue;
      for (const t of state.qualified(lesson.subjectCode)) {
        if (!state.canPlace(lesson, day, period, t, room)) continue;
        out.push({ day, period, teacher: t, room, cost: state.softCost(lesson, day, period, t, room) + rnd() * 0.35 });
        if (out.length >= cap) return out.sort((a, b) => a.cost - b.cost);
      }
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

/** Diagnose in plain English why a lesson found no legal slot. */
function diagnose(state: ScheduleState, lesson: LessonDemand, count: number): UnplacedLesson {
  const qual = state.qualified(lesson.subjectCode);
  const fixes: { label: string; detail: string }[] = [];
  let cause: string;
  if (qual.length === 0) {
    cause = `No teacher is qualified to teach ${lesson.subjectName}`;
    fixes.push({ label: 'Add a qualification', detail: `Mark an existing teacher as qualified for ${lesson.subjectName} in Staff` });
  } else {
    const atCap = qual.filter((t) => (state.teacherWeekly.get(t.id) ?? 0) >= t.maxWeekly);
    if (atCap.length === qual.length) {
      cause = `All ${qual.length} qualified teacher(s) — ${qual.map((t) => t.name).join(', ')} — are at their weekly limit`;
      fixes.push({ label: 'Raise a weekly cap', detail: `Allow ${atCap[0].name} one more period per week` });
      fixes.push({ label: 'Share the load', detail: `Qualify another teacher for ${lesson.subjectName}` });
    } else if (lesson.requiresLab) {
      cause = `No laboratory is free when ${lesson.className} and a qualified teacher are both available`;
      fixes.push({ label: 'Free a lab period', detail: 'Move another lab lesson, or add lab availability' });
    } else {
      cause = `${lesson.className}'s free periods never overlap with a qualified teacher's free periods`;
      fixes.push({ label: 'Relax availability', detail: `Review unavailable periods for ${qual.map((t) => t.name).join(', ')}` });
    }
  }
  return {
    classId: lesson.classId,
    className: lesson.className,
    subjectId: lesson.subjectId,
    subjectName: lesson.subjectName,
    count,
    cause,
    fixes,
  };
}

function buildExplanations(state: ScheduleState): void {
  for (const a of state.assignments) {
    const lesson = state.lessonOf(a);
    const t = state.teacherById.get(a.teacherId);
    if (!lesson || !t) continue;
    const room = a.roomId ? state.roomById.get(a.roomId) : undefined;
    const qual = state.qualified(lesson.subjectCode);

    // Who else could take this exact cell right now?
    let altTeachers = 0;
    for (const other of qual) {
      if (other.id === t.id) continue;
      if (
        !state.teacherBusy.has(ck(other.id, a.day, a.period)) &&
        !state.teacherUnavailable.has(ck(other.id, a.day, a.period)) &&
        (state.teacherWeekly.get(other.id) ?? 0) < other.maxWeekly
      )
        altTeachers++;
    }
    let altRooms = 0;
    if (lesson.requiresLab) {
      for (const lab of state.labs)
        if (lab.id !== a.roomId && !state.roomBusy.has(ck(lab.id, a.day, a.period))) altRooms++;
    }

    const myLoad = state.teacherWeekly.get(t.id) ?? 0;
    const lightest = qual.every((o) => o.id === t.id || (state.teacherWeekly.get(o.id) ?? 0) >= myLoad);
    const reasons = [
      `${t.name} is qualified to teach ${lesson.subjectName}`,
      `Load ${myLoad}/${t.maxWeekly} periods this week${lightest && qual.length > 1 ? ' — lowest among qualified staff' : ''}`,
      `Free on ${state.input.grid.days[a.day]} ${state.input.grid.periodLabels[a.period]}`,
    ];
    if (room) reasons.push(lesson.requiresLab ? `${room.name} laboratory available` : `${room.name} available`);
    reasons.push('No conflicts with any class, teacher or room');

    let confidence = 0.98;
    const sameDay = (state.classSubjectDay.get(`${a.classId}|${a.subjectId}|${a.day}`) ?? 1) - 1;
    if (sameDay >= 1) confidence -= 0.05;
    if (state.teacherPreferredFree.has(ck(t.id, a.day, a.period))) confidence -= 0.04;
    if (lesson.cognitiveLoad >= 4 && a.period >= state.input.grid.periodsPerDay - 2) confidence -= 0.03;
    confidence -= (myLoad / Math.max(1, t.maxWeekly)) * 0.05;

    a.explain = {
      reasons,
      alternatives: { teachers: altTeachers, rooms: altRooms },
      confidence: Math.max(0.7, Math.round(confidence * 100) / 100),
    };
  }
}

/**
 * Independent re-verification of a finished solution against every hard
 * constraint, from a clean state. Returns plain-English problems (empty ⇒
 * provably conflict-free). Used as a final gate before a draft is saved —
 * a solver bug can never silently reach the database.
 */
export function verifySolution(input: SolverInput, assignments: Assignment[]): string[] {
  const state = new ScheduleState(input);
  const problems: string[] = [];
  for (const a of assignments) {
    const lesson = state.lessonOf(a);
    const teacher = state.teacherById.get(a.teacherId);
    const room = a.roomId ? state.roomById.get(a.roomId) : undefined;
    if (!lesson || !teacher) {
      problems.push('Assignment references an unknown lesson or teacher');
      continue;
    }
    const issues = state.placementIssues(lesson, a.day, a.period, teacher, room);
    if (issues.length) {
      problems.push(`${lesson.className} ${lesson.subjectName} (${input.grid.days[a.day]} P${a.period + 1}): ${issues[0]}`);
      continue; // don't corrupt the verification state with an illegal placement
    }
    state.place({ ...a });
  }
  return problems;
}

export interface SolveOptions {
  /** Assignments to keep exactly where they are (locks + manual edits). */
  locked?: Assignment[];
  timeBudgetMs?: number;
  seed?: number;
  restarts?: number;
}

export function solve(input: SolverInput, opts: SolveOptions = {}): SolveResult {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 2500;
  const restarts = opts.restarts ?? 4;
  const baseSeed = opts.seed ?? 1;

  // Expand demand into units, honouring locked pre-placements.
  const lockedByLesson = new Map<string, Assignment[]>();
  for (const l of opts.locked ?? []) {
    const key = `${l.classId}|${l.subjectId}`;
    (lockedByLesson.get(key) ?? lockedByLesson.set(key, []).get(key)!).push(l);
  }

  let best: { state: ScheduleState; unplacedUnits: Unit[]; soft: number; lockWarnings: string[] } | null = null;
  let attempts = 0;

  for (let r = 0; r < restarts; r++) {
    if (r > 0 && Date.now() - started > budget * 0.6) break;
    attempts++;
    const rnd = mulberry32(baseSeed + r * 7919);
    const state = new ScheduleState(input);
    const lockWarnings: string[] = [];

    // 0 ── Locked slots first. Never silently violated: a lock that is no
    //      longer legal is dropped and reported.
    const consumed = new Map<string, number>();
    for (const [key, locks] of lockedByLesson) {
      const lesson = input.lessons.find((l) => `${l.classId}|${l.subjectId}` === key);
      for (const lock of locks) {
        const t = state.teacherById.get(lock.teacherId);
        const room = lock.roomId ? state.roomById.get(lock.roomId) : undefined;
        if (lesson && t && state.canPlace(lesson, lock.day, lock.period, t, room)) {
          state.place({ ...lock, locked: true });
          consumed.set(key, (consumed.get(key) ?? 0) + 1);
        } else if (lesson && t) {
          const why = state.placementIssues(lesson, lock.day, lock.period, t, room);
          lockWarnings.push(
            `Locked ${lesson.subjectName} for ${lesson.className} (${input.grid.days[lock.day]} ${input.grid.periodLabels[lock.period]}) was released: ${why[0] ?? 'no longer valid'}`,
          );
        }
      }
    }

    // 1 ── Build remaining units, hardest first.
    const units: Unit[] = [];
    for (const lesson of input.lessons) {
      const already = consumed.get(`${lesson.classId}|${lesson.subjectId}`) ?? 0;
      for (let i = already; i < lesson.weeklyPeriods; i++) units.push({ lesson, index: i });
    }
    units.sort((a, b) => {
      const qa = state.qualified(a.lesson.subjectCode).length || 0.5;
      const qb = state.qualified(b.lesson.subjectCode).length || 0.5;
      const ha = (a.lesson.requiresLab ? 100 : 0) + a.lesson.weeklyPeriods * 2 - qa * 3;
      const hb = (b.lesson.requiresLab ? 100 : 0) + b.lesson.weeklyPeriods * 2 - qb * 3;
      return hb - ha || (rnd() < 0.5 ? -1 : 1);
    });

    // 2 ── Constructive pass.
    const failed: Unit[] = [];
    for (const unit of units) {
      const cands = candidatesFor(state, unit.lesson, rnd, 64);
      if (cands.length === 0) {
        failed.push(unit);
        continue;
      }
      const c = cands[0];
      state.place({
        classId: unit.lesson.classId,
        subjectId: unit.lesson.subjectId,
        day: c.day,
        period: c.period,
        teacherId: c.teacher.id,
        roomId: c.room?.id,
      });
    }

    // 3 ── Repair pass: single-level displacement for the stragglers.
    const stillFailed: Unit[] = [];
    for (const unit of failed) {
      let placed = false;
      const { lesson } = unit;
      const { grid } = state.input;
      outer: for (let day = 0; day < grid.days.length && !placed; day++) {
        if ((state.classSubjectDay.get(`${lesson.classId}|${lesson.subjectId}|${day}`) ?? 0) >= MAX_SAME_SUBJECT_PER_DAY)
          continue;
        for (let period = 0; period < grid.periodsPerDay; period++) {
          if (state.blocked.has(`${day}|${period}`)) continue;
          if (state.classBusy.has(ck(lesson.classId, day, period))) continue;
          // Find a blocker occupying a qualified teacher (or the lab) here.
          const blockers = state.assignments.filter(
            (a) =>
              !a.locked &&
              a.day === day &&
              a.period === period &&
              (state.qualified(lesson.subjectCode).some((t) => t.id === a.teacherId) ||
                (lesson.requiresLab && a.roomId && state.roomById.get(a.roomId)?.type === 'LAB')),
          );
          for (const blocker of blockers) {
            const blockerLesson = state.lessonOf(blocker);
            if (!blockerLesson) continue;
            state.remove(blocker);
            const nowOk = candidatesFor(state, lesson, rnd, 1);
            if (nowOk.length > 0) {
              const c = nowOk[0];
              const placedUnit = {
                classId: lesson.classId, subjectId: lesson.subjectId, day: c.day, period: c.period,
                teacherId: c.teacher.id, roomId: c.room?.id,
              };
              state.place(placedUnit);
              // Relocate the evictee — validated against the state that now
              // includes the new unit, so no constraint can slip through.
              const rl = candidatesFor(state, blockerLesson, rnd, 1)[0];
              if (rl) {
                state.place({ classId: blockerLesson.classId, subjectId: blockerLesson.subjectId, day: rl.day, period: rl.period, teacherId: rl.teacher.id, roomId: rl.room?.id });
                placed = true;
                break outer;
              }
              state.remove(placedUnit); // evictee has nowhere to go — undo all
            }
            state.place(blocker);
          }
        }
      }
      if (!placed) stillFailed.push(unit);
    }

    const soft = state.totalSoftCost();
    if (
      !best ||
      state.assignments.length > best.state.assignments.length ||
      (state.assignments.length === best.state.assignments.length && soft < best.soft)
    ) {
      best = { state, unplacedUnits: stillFailed, soft, lockWarnings };
    }
    if (best.unplacedUnits.length === 0 && r >= 1) break; // full placement twice-over is plenty
  }

  const state = best!.state;

  // 4 ── Local search: improve soft cost with relocation moves.
  const rnd = mulberry32(baseSeed * 31 + 17);
  let currentSoft = best!.soft;
  let moves = 0;
  while (Date.now() - started < budget && moves < 4000) {
    moves++;
    const movable = state.assignments.filter((a) => !a.locked);
    if (!movable.length) break;
    const a = movable[Math.floor(rnd() * movable.length)];
    const lesson = state.lessonOf(a);
    if (!lesson) continue;
    state.remove(a);
    const cands = candidatesFor(state, lesson, rnd, 32);
    const before = a;
    let bestCand: Candidate | null = null;
    for (const c of cands.slice(0, 8)) {
      if (c.day === before.day && c.period === before.period && c.teacher.id === before.teacherId) continue;
      if (!bestCand || c.cost < bestCand.cost) bestCand = c;
    }
    if (bestCand) {
      state.place({ classId: lesson.classId, subjectId: lesson.subjectId, day: bestCand.day, period: bestCand.period, teacherId: bestCand.teacher.id, roomId: bestCand.room?.id });
      const after = state.totalSoftCost();
      if (after < currentSoft) {
        currentSoft = after;
        continue; // keep the improvement
      }
      // revert
      const placedNow = state.assignments[state.assignments.length - 1];
      state.remove(placedNow);
    }
    state.place(before);
  }

  buildExplanations(state);

  // ── Aggregate unplaced units per class-subject with a diagnosis.
  const unplacedMap = new Map<string, { lesson: LessonDemand; count: number }>();
  for (const u of best!.unplacedUnits) {
    const key = `${u.lesson.classId}|${u.lesson.subjectId}`;
    const e = unplacedMap.get(key) ?? { lesson: u.lesson, count: 0 };
    e.count++;
    unplacedMap.set(key, e);
  }
  const unplaced: UnplacedLesson[] = [...unplacedMap.values()].map((e) => diagnose(state, e.lesson, e.count));

  // ── Warnings + recommendations in admin language.
  const warnings: string[] = [...best!.lockWarnings];
  for (const t of input.teachers) {
    const weekly = state.teacherWeekly.get(t.id) ?? 0;
    if (weekly >= t.maxWeekly) warnings.push(`${t.name} is scheduled at their weekly maximum (${weekly} periods)`);
    for (let d = 0; d < input.grid.days.length; d++) {
      const daily = state.teacherDailyCount.get(dk(t.id, d)) ?? 0;
      if (daily >= t.maxDaily) warnings.push(`${t.name} has a full ${input.grid.days[d]} (${daily} periods)`);
    }
    let prefHits = 0;
    for (const pf of t.preferredFree) if (state.teacherBusy.has(ck(t.id, pf.day, pf.period))) prefHits++;
    if (prefHits) warnings.push(`${t.name}'s preferred free period could not be kept ${prefHits}×`);
  }
  const recommendations: string[] = [];
  for (const u of unplaced) for (const f of u.fixes) recommendations.push(`${f.label} — ${f.detail}`);
  if (!recommendations.length && warnings.length)
    recommendations.push('Timetable is complete; review warnings if staff comfort matters more than compactness.');

  // ── Health score.
  const totalUnits = input.lessons.reduce((a, l) => a + l.weeklyPeriods, 0);
  const placedUnits = state.assignments.length;
  const placement = totalUnits ? Math.round((placedUnits / totalUnits) * 100) : 100;
  const avgSoft = placedUnits ? currentSoft / placedUnits : 0;
  const balance = Math.max(0, Math.round(100 - avgSoft * 30));
  let prefViol = 0;
  for (const t of input.teachers)
    for (const pf of t.preferredFree) if (state.teacherBusy.has(ck(t.id, pf.day, pf.period))) prefViol++;
  const preferences = Math.max(0, 100 - prefViol * 10);
  const score = Math.max(
    0,
    Math.min(100, Math.round(placement * 0.6 + balance * 0.25 + preferences * 0.15 - unplaced.length * 4)),
  );

  return {
    assignments: state.assignments,
    unplaced,
    score,
    breakdown: { placement, balance, preferences },
    warnings: [...new Set(warnings)].slice(0, 12),
    recommendations: [...new Set(recommendations)].slice(0, 8),
    solveMs: Date.now() - started,
    stats: { placed: placedUnits, total: totalUnits, restarts: attempts },
  };
}

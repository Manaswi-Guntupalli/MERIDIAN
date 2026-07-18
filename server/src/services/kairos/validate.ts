import type { Issue, LoadedData } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-validation: catch impossible timetables BEFORE solving, and say why in
// the administrator's language. A BLOCKER stops generation; a WARNING lets it
// proceed but is surfaced in the review screen.
// ─────────────────────────────────────────────────────────────────────────────

export function preValidate(data: LoadedData): Issue[] {
  const issues: Issue[] = [];
  const { grid, lessons, teachers, rooms } = data;

  const usableCells = grid.days.length * grid.periodsPerDay - grid.blocked.length;

  if (!data.hasConfig) {
    issues.push({
      severity: 'WARNING',
      code: 'NO_CONFIG',
      title: 'School timings not configured',
      detail: `Using defaults: ${grid.days.length}-day week, ${grid.periodsPerDay} periods a day starting 08:00.`,
      fix: 'Open Setup to set your own working days, timings and breaks.',
    });
  }

  // 1 ── Every class needs a curriculum.
  for (const c of data.classesWithoutPlan) {
    issues.push({
      severity: 'BLOCKER',
      code: 'NO_CURRICULUM',
      title: `${c.name} has no curriculum`,
      detail: `${c.name} has no subjects planned, so Kairos cannot schedule it.`,
      fix: `Open Setup → Curriculum and add subjects for ${c.name}.`,
    });
  }

  // 2 ── Per-class demand must fit the week.
  const byClass = new Map<string, { name: string; total: number }>();
  for (const l of lessons) {
    const e = byClass.get(l.classId) ?? { name: l.className, total: 0 };
    e.total += l.weeklyPeriods;
    byClass.set(l.classId, e);
  }
  for (const [, e] of byClass) {
    if (e.total > usableCells) {
      issues.push({
        severity: 'BLOCKER',
        code: 'CLASS_OVERFULL',
        title: `${e.name} needs more periods than the week has`,
        detail: `${e.name}'s curriculum asks for ${e.total} periods, but the week only has ${usableCells} teaching slots.`,
        fix: 'Reduce weekly periods for some subjects, or add periods to the day.',
      });
    } else if (e.total < usableCells - 6) {
      issues.push({
        severity: 'WARNING',
        code: 'CLASS_UNDERFULL',
        title: `${e.name} has ${usableCells - e.total} free periods a week`,
        detail: `Only ${e.total} of ${usableCells} teaching slots are planned for ${e.name}.`,
        fix: 'Fine if intentional — otherwise add subjects or raise weekly periods.',
      });
    }
  }

  // 3 ── Every subject needs at least one qualified teacher.
  const qualifiedFor = (code: string) => teachers.filter((t) => t.subjects.includes(code));
  const seenSubjectClass = new Set<string>();
  for (const l of lessons) {
    const key = `${l.classId}:${l.subjectId}`;
    if (seenSubjectClass.has(key)) continue;
    seenSubjectClass.add(key);
    const qual = qualifiedFor(l.subjectCode);
    if (qual.length === 0) {
      issues.push({
        severity: 'BLOCKER',
        code: 'NO_QUALIFIED_TEACHER',
        title: `No teacher is qualified for ${l.subjectName}`,
        detail: `${l.className} needs ${l.subjectName} ${l.weeklyPeriods}×/week, but no teacher lists it as a qualification.`,
        fix: `Add ${l.subjectName} to a teacher's qualifications in Staff, or hire for it.`,
      });
    }
  }

  // 4 ── Total demand vs. total staff capacity.
  const totalDemand = lessons.reduce((a, l) => a + l.weeklyPeriods, 0);
  const totalCapacity = teachers.reduce((a, t) => a + Math.min(t.maxWeekly, usableCells), 0);
  if (totalDemand > totalCapacity) {
    issues.push({
      severity: 'BLOCKER',
      code: 'STAFF_CAPACITY',
      title: 'Not enough teaching capacity',
      detail: `The curriculum needs ${totalDemand} periods a week; your staff can cover at most ${totalCapacity}.`,
      fix: 'Raise weekly caps, add staff, or trim the curriculum.',
    });
  }

  // 5 ── Per-subject-pool capacity: teachers who share those subjects must be
  //      able to absorb the combined demand of everything ONLY they can teach.
  for (const t of teachers) {
    const soleSubjects = t.subjects.filter((code) => qualifiedFor(code).length === 1);
    if (!soleSubjects.length) continue;
    const soleDemand = lessons
      .filter((l) => soleSubjects.includes(l.subjectCode))
      .reduce((a, l) => a + l.weeklyPeriods, 0);
    const available = Math.min(
      t.maxWeekly,
      grid.days.length * Math.min(t.maxDaily, grid.periodsPerDay) - t.unavailable.length,
    );
    if (soleDemand > available) {
      const names = [...new Set(lessons.filter((l) => soleSubjects.includes(l.subjectCode)).map((l) => l.subjectName))];
      issues.push({
        severity: 'BLOCKER',
        code: 'TEACHER_OVERLOAD',
        title: `${t.name} cannot cover ${names.join(', ')} alone`,
        detail: `${t.name} is the only teacher for ${names.join(', ')} — ${soleDemand} periods a week, but they can take at most ${available}.`,
        fix: `Qualify a second teacher for ${names[0]}, or reduce its weekly periods.`,
      });
    }
  }

  // 6 ── Lab supply.
  const labs = rooms.filter((r) => r.type === 'LAB');
  const labDemand = lessons.filter((l) => l.requiresLab).reduce((a, l) => a + l.weeklyPeriods, 0);
  const labSupply = labs.reduce((a, r) => a + (usableCells - r.unavailable.length), 0);
  if (labDemand > labSupply) {
    issues.push({
      severity: 'BLOCKER',
      code: 'LAB_CAPACITY',
      title: 'Not enough laboratory slots',
      detail: `Lab subjects need ${labDemand} lab periods a week, but your ${labs.length} lab(s) offer only ${labSupply}.`,
      fix: 'Add a lab, free up lab availability, or make some subjects non-lab.',
    });
  } else if (labs.length && labDemand > labSupply * 0.85) {
    issues.push({
      severity: 'WARNING',
      code: 'LAB_TIGHT',
      title: 'Labs are nearly fully booked',
      detail: `Lab subjects use ${labDemand} of ${labSupply} available lab periods — little room for adjustments.`,
    });
  }

  // 7 ── Room capacity vs class size.
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const seenClass = new Set<string>();
  for (const l of lessons) {
    if (seenClass.has(l.classId)) continue;
    seenClass.add(l.classId);
    const home = l.homeRoomId ? roomById.get(l.homeRoomId) : undefined;
    if (home && l.classSize > home.capacity) {
      issues.push({
        severity: 'WARNING',
        code: 'ROOM_CAPACITY',
        title: `${l.className}'s room is too small`,
        detail: `${l.className} has ${l.classSize} students but ${home.name} seats ${home.capacity}.`,
        fix: 'Assign a bigger classroom in Classes.',
      });
    }
  }

  // Blockers first, then warnings — the order the admin should read them in.
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'BLOCKER' ? -1 : 1));
}

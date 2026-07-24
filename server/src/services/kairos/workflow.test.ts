import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { generateDraft, approveDraft, publishDraft, rollbackToVersion, updateDraftSlot, discardDraft, compareVersions } from './workflow.js';
import { planSubstitutes, applySubstitutes } from './substitute.js';

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end lifecycle against a real (test) database:
// generate → edit → approve → publish → v2 → rollback → substitutes.
// ─────────────────────────────────────────────────────────────────────────────

const toJson = (v: unknown) => JSON.stringify(v);
let schoolId = '';
const actor = { id: undefined as string | undefined, name: 'Test Principal' };

/** Next date that falls on timetable day 0 (Monday). Local components — not
 *  toISOString(), whose UTC shift can cross midnight onto a weekend. */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeAll(async () => {
  const school = await prisma.school.create({ data: { name: 'Workflow Test School', code: `WF-${Date.now()}` } });
  schoolId = school.id;

  await prisma.academicConfig.create({
    data: {
      schoolId,
      workingDays: 5,
      periodsPerDay: 8,
      breaksString: toJson([]),
      blockedString: toJson([{ day: 0, period: 0, reason: 'Assembly' }]),
      holidaysString: toJson([]),
    },
  });

  const building = await prisma.building.create({ data: { schoolId, name: 'Main' } });
  const [r1, r2] = await Promise.all([
    prisma.room.create({ data: { buildingId: building.id, name: 'R1', type: 'CLASSROOM', capacity: 40 } }),
    prisma.room.create({ data: { buildingId: building.id, name: 'R2', type: 'CLASSROOM', capacity: 40 } }),
  ]);
  await prisma.room.create({ data: { buildingId: building.id, name: 'Lab', type: 'LAB', capacity: 30 } });

  const subjects = await Promise.all(
    [
      { code: 'MATH', name: 'Maths' },
      { code: 'SCI', name: 'Science', requiresLab: true },
      { code: 'ENG', name: 'English' },
    ].map((s) => prisma.subject.create({ data: { schoolId, ...s } })),
  );

  const teacherDefs = [
    { name: 'T Math', subjects: ['MATH'] },
    { name: 'T Sci', subjects: ['SCI'] },
    { name: 'T Eng', subjects: ['ENG'] },
    { name: 'T Multi', subjects: ['MATH', 'ENG', 'SCI'] },
  ];
  for (let i = 0; i < teacherDefs.length; i++) {
    const u = await prisma.user.create({
      data: { schoolId, email: `wf-t${i}-${Date.now()}@test.local`, password: 'x', name: teacherDefs[i].name, role: 'TEACHER' },
    });
    await prisma.teacher.create({
      data: {
        schoolId,
        userId: u.id,
        employeeId: `WF-${i}`,
        department: 'Test',
        maxHours: 20,
        subjectsString: toJson(teacherDefs[i].subjects),
      },
    });
  }

  const classA = await prisma.class.create({ data: { schoolId, grade: 9, section: 'A', name: '9A', roomId: r1.id } });
  const classB = await prisma.class.create({ data: { schoolId, grade: 9, section: 'B', name: '9B', roomId: r2.id } });
  for (const cls of [classA, classB]) {
    await prisma.classSubjectPlan.createMany({
      data: [
        { classId: cls.id, subjectId: subjects[0].id, weeklyPeriods: 5 },
        { classId: cls.id, subjectId: subjects[1].id, weeklyPeriods: 4, requiresLab: true },
        { classId: cls.id, subjectId: subjects[2].id, weeklyPeriods: 4 },
      ],
    });
  }
});

describe('Kairos workflow — draft → approve → publish → rollback', () => {
  it('generates a valid draft without touching anything live', async () => {
    const out = await generateDraft(schoolId, actor);
    expect(out.ok).toBe(true);
    expect(out.result!.unplaced).toHaveLength(0);
    const draft = await prisma.timetable.findFirst({ where: { schoolId, status: 'DRAFT' } });
    expect(draft).toBeTruthy();
    expect(draft!.active).toBe(false);
    const live = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
    expect(live).toBeNull();
  });

  it('rejects a manual edit that would double-book a teacher', async () => {
    const draft = (await prisma.timetable.findFirst({ where: { schoolId, status: 'DRAFT' } }))!;
    const slots = await prisma.timetableSlot.findMany({ where: { timetableId: draft.id } });
    // Find two slots of different classes at different cells with different teachers.
    const a = slots[0];
    const b = slots.find((s) => s.classId !== a.classId && s.teacherId !== a.teacherId)!;
    // Try to give slot B teacher A at the exact cell teacher A is already teaching.
    const out = await updateDraftSlot(schoolId, b.id, { day: a.day, period: a.period, teacherId: a.teacherId }, actor);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.violations.join(' ')).toMatch(/already teaching|already has a lesson/i);
  });

  it('accepts a legal manual edit and locks the slot', async () => {
    const draft = (await prisma.timetable.findFirst({ where: { schoolId, status: 'DRAFT' } }))!;
    const slots = await prisma.timetableSlot.findMany({ where: { timetableId: draft.id }, include: { subject: true } });
    const movable = slots.find((s) => !s.subject.requiresLab)!;
    // Find an empty legal cell for this class+teacher.
    const busyClass = new Set(slots.filter((s) => s.classId === movable.classId).map((s) => `${s.day}|${s.period}`));
    const busyTeacher = new Set(slots.filter((s) => s.teacherId === movable.teacherId).map((s) => `${s.day}|${s.period}`));
    let target: { day: number; period: number } | null = null;
    outer: for (let d = 0; d < 5; d++)
      for (let p = 0; p < 8; p++) {
        if (d === 0 && p === 0) continue; // assembly
        if (!busyClass.has(`${d}|${p}`) && !busyTeacher.has(`${d}|${p}`)) {
          target = { day: d, period: p };
          break outer;
        }
      }
    expect(target).toBeTruthy();
    const out = await updateDraftSlot(schoolId, movable.id, target!, actor);
    expect(out.ok).toBe(true);
    const updated = await prisma.timetableSlot.findUnique({ where: { id: movable.id } });
    expect(updated!.locked).toBe(true);
    expect(updated!.day).toBe(target!.day);
  });

  it('refuses to publish before approval, then publishes v1 atomically', async () => {
    await expect(publishDraft(schoolId, actor)).rejects.toThrow(/approved/i);
    await approveDraft(schoolId, actor);
    const published = await publishDraft(schoolId, actor);
    expect(published.version).toBe(1);
    expect(published.active).toBe(true);
    expect(published.publishedByName).toBe('Test Principal');
    // Teacher loads recomputed from the live timetable.
    const teachers = await prisma.teacher.findMany({ where: { schoolId } });
    const slotCount = await prisma.timetableSlot.count({ where: { timetableId: published.id } });
    expect(teachers.reduce((a, t) => a + t.weeklyHours, 0)).toBe(slotCount);
  });

  it('publishes v2 with locked slots preserved, archiving v1', async () => {
    const v1 = (await prisma.timetable.findFirst({ where: { schoolId, active: true } }))!;
    const out = await generateDraft(schoolId, actor, { keepLocks: true });
    expect(out.ok).toBe(true);
    await approveDraft(schoolId, actor);
    const v2 = await publishDraft(schoolId, actor);
    expect(v2.version).toBe(2);
    const v1After = await prisma.timetable.findUnique({ where: { id: v1.id } });
    expect(v1After!.active).toBe(false);
    expect(v1After!.status).toBe('ARCHIVED');
    // Exactly one live timetable, always.
    expect(await prisma.timetable.count({ where: { schoolId, active: true } })).toBe(1);
    // Comparing v1 and v2 works.
    const diff = await compareVersions(schoolId, v1.id, v2.id);
    expect(diff.total).toBeGreaterThan(0);
  });

  it('rolls back to v1 transactionally', async () => {
    const v1 = (await prisma.timetable.findFirst({ where: { schoolId, version: 1 } }))!;
    const restored = await rollbackToVersion(schoolId, v1.id, actor);
    expect(restored.id).toBe(v1.id);
    expect(restored.active).toBe(true);
    expect(await prisma.timetable.count({ where: { schoolId, active: true } })).toBe(1);
    const v2 = await prisma.timetable.findFirst({ where: { schoolId, version: 2 } });
    expect(v2!.active).toBe(false);
    expect(v2!.status).toBe('ARCHIVED');
  });

  it('the database itself rejects double-booked slots', async () => {
    const live = (await prisma.timetable.findFirst({ where: { schoolId, active: true } }))!;
    const slot = (await prisma.timetableSlot.findFirst({ where: { timetableId: live.id } }))!;
    await expect(
      prisma.timetableSlot.create({
        data: {
          timetableId: live.id,
          day: slot.day,
          period: slot.period,
          classId: slot.classId,
          subjectId: slot.subjectId,
          teacherId: slot.teacherId,
        },
      }),
    ).rejects.toThrow(); // P2002 unique violation
  });

  it('discarding a draft never touches the live timetable', async () => {
    await generateDraft(schoolId, actor);
    const before = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
    await discardDraft(schoolId, actor);
    expect(await prisma.timetable.findFirst({ where: { schoolId, status: { in: ['DRAFT', 'APPROVED'] } } })).toBeNull();
    const after = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
    expect(after!.id).toBe(before!.id);
  });
});

describe('Kairos substitute engine — emergency cover', () => {
  it('suggests only qualified teachers who are genuinely free', async () => {
    const date = nextMonday();
    const teachers = await prisma.teacher.findMany({ where: { schoolId }, include: { user: true } });
    const live = (await prisma.timetable.findFirst({ where: { schoolId, active: true } }))!;
    // Pick a teacher who actually teaches on Monday.
    const monSlots = await prisma.timetableSlot.findMany({ where: { timetableId: live.id, day: 0 }, include: { subject: true } });
    const absentId = monSlots[0].teacherId;

    const plan = await planSubstitutes(schoolId, absentId, date);
    expect(plan.suggestions.length).toBeGreaterThan(0);

    const slotByTeacherPeriod = new Set(monSlots.map((s) => `${s.teacherId}|${s.period}`));
    for (const s of plan.suggestions) {
      for (const cand of [s.candidate, ...s.alternatives].filter(Boolean) as NonNullable<typeof s.candidate>[]) {
        const t = teachers.find((x) => x.id === cand.teacherId)!;
        const quals = JSON.parse(t.subjectsString ?? '[]') as string[];
        const subj = monSlots.find((m) => m.period === s.slot.period && m.classId === s.slot.classId)!.subject;
        expect(quals, `${t.user.name} must be qualified for ${subj.code}`).toContain(subj.code);
        expect(cand.teacherId).not.toBe(absentId);
        expect(slotByTeacherPeriod.has(`${cand.teacherId}|${s.slot.period}`), `${t.user.name} must be free P${s.slot.period + 1}`).toBe(false);
        expect(cand.reasons.length).toBeGreaterThan(0);
      }
    }

    // Apply the plan and confirm persistence + idempotent re-planning.
    const picks = plan.suggestions
      .filter((s) => s.candidate)
      .map((s) => ({
        period: s.slot.period,
        classId: s.slot.classId,
        subjectId: s.slot.subjectId,
        subTeacherId: s.candidate!.teacherId,
        reasons: s.candidate!.reasons,
        confidence: s.candidate!.confidence,
      }));
    expect(picks.length).toBeGreaterThan(0);
    await applySubstitutes(schoolId, absentId, date, picks);
    const subs = await prisma.substitution.findMany({ where: { absence: { teacherId: absentId, date } } });
    expect(subs).toHaveLength(picks.length);
    expect(subs.every((s) => s.accepted)).toBe(true);
    // Re-applying replaces, not duplicates.
    await applySubstitutes(schoolId, absentId, date, picks);
    expect(await prisma.substitution.count({ where: { absence: { teacherId: absentId, date } } })).toBe(picks.length);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { toJson } from '../src/lib/json.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

/** Next Monday (timetable day index 0) as YYYY-MM-DD — deterministic on any weekday. */
function nextMonday(): string {
  const d = new Date();
  const js = d.getDay(); // 0=Sun..6=Sat
  const delta = ((8 - js) % 7) || 7;
  d.setDate(d.getDate() + delta);
  // Build the string from LOCAL components — toISOString() is UTC and shifts
  // the date across the midnight boundary, which can land on a weekend.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('Reactive absence cascade', () => {
  it('one call: absence → auto-cover → families notified → one reversible event; undo restores everything', async () => {
    const fx = await createFixture();
    const date = nextMonday();

    // A live timetable with one Monday period taught by the absent teacher,
    // and a second teacher qualified to cover it.
    const subject = await prisma.subject.create({ data: { schoolId: fx.school.id, code: `MATH-${fx.suffix}`, name: 'Mathematics' } });
    await prisma.teacher.update({ where: { id: fx.otherTeacher.teacher.id }, data: { subjectsString: toJson([subject.code]) } });
    const tt = await prisma.timetable.create({ data: { schoolId: fx.school.id, name: 'Live', status: 'PUBLISHED', active: true, version: 1 } });
    await prisma.timetableSlot.create({
      data: { timetableId: tt.id, day: 0, period: 0, classId: fx.class.id, subjectId: subject.id, teacherId: fx.teacher.teacher.id },
    });

    const res = await request(app)
      .post('/api/staff/absence/cascade')
      .set(authHeader(fx.admin.token))
      .send({ teacherId: fx.teacher.teacher.id, date, reason: 'Medical leave' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.covered).toBe(1);
    expect(res.body.uncovered).toBe(0);
    expect(res.body.eventId).toBeTruthy();
    expect(res.body.steps.map((s: { key: string }) => s.key)).toEqual(['absence', 'plan', 'assign', 'rooms', 'notify', 'ledger']);

    // State: absence + accepted substitution by the qualified teacher.
    const absence = await prisma.staffAbsence.findFirst({ where: { teacherId: fx.teacher.teacher.id, date } });
    expect(absence).toBeTruthy();
    const subs = await prisma.substitution.findMany({ where: { absenceId: absence!.id } });
    expect(subs).toHaveLength(1);
    expect(subs[0].subTeacherId).toBe(fx.otherTeacher.teacher.id);
    expect(subs[0].accepted).toBe(true);

    // The whole cascade is ONE reversible ledger event.
    const event = await prisma.event.findFirst({ where: { id: res.body.eventId } });
    expect(event?.type).toBe('STAFF_ABSENCE_CASCADE');
    expect(event?.reversible).toBe(true);

    // People notified: the substitute and the affected class's family.
    expect(
      await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.otherTeacher.user.id, title: 'Cover assignment' } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { schoolId: fx.school.id, userId: fx.parent.user.id, title: { contains: 'Timetable change' } },
      }),
    ).toBe(1);
    expect(res.body.notified.familyUsers).toBeGreaterThan(0);

    // ── Undo: state restored atomically, substitutes informed honestly. ──
    const undo = await request(app).post('/api/staff/absence/undo').set(authHeader(fx.admin.token)).send({ eventId: res.body.eventId });
    expect(undo.status).toBe(200);
    expect(undo.body.substitutionsRemoved).toBe(1);
    expect(await prisma.substitution.count({ where: { absenceId: absence!.id } })).toBe(0);
    expect(await prisma.staffAbsence.count({ where: { teacherId: fx.teacher.teacher.id, date } })).toBe(0);
    expect((await prisma.event.findFirst({ where: { id: res.body.eventId } }))!.reverted).toBe(true);
    expect(
      await prisma.notification.count({ where: { userId: fx.otherTeacher.user.id, title: 'Cover assignment cancelled' } }),
    ).toBe(1);
  });

  it('without a published timetable the cascade still records the absence honestly and stays undoable', async () => {
    const fx = await createFixture();
    const date = nextMonday();
    const res = await request(app)
      .post('/api/staff/absence/cascade')
      .set(authHeader(fx.admin.token))
      .send({ teacherId: fx.teacher.teacher.id, date });
    expect(res.status).toBe(201);
    expect(res.body.covered).toBe(0);
    const plan = res.body.steps.find((s: { key: string }) => s.key === 'plan');
    expect(plan.status).toBe('SKIPPED');
    expect(plan.detail).toContain('No published timetable');

    const undo = await request(app).post('/api/staff/absence/undo').set(authHeader(fx.admin.token)).send({ eventId: res.body.eventId });
    expect(undo.status).toBe(200);
    expect(await prisma.staffAbsence.count({ where: { teacherId: fx.teacher.teacher.id, date } })).toBe(0);
  });
});

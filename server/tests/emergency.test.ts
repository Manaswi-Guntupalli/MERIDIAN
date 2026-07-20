import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Emergency Coordination', () => {
  it('activation cascades: incident, notifications, audit, timeline; attendance & timetable lock', async () => {
    const fx = await createFixture();

    const trig = await request(app).post('/api/emergency/trigger').set(authHeader(fx.principal.token)).send({ kind: 'FIRE' });
    expect(trig.status).toBe(201);
    const incidentId = trig.body.incident.id;

    // Incident stored ACTIVE
    const incident = await prisma.emergencyIncident.findUnique({ where: { id: incidentId } });
    expect(incident?.status).toBe('ACTIVE');

    // Notifications fanned out (at least the fixture's users)
    expect(await prisma.notification.count({ where: { schoolId: fx.school.id, category: 'EMERGENCY' } })).toBeGreaterThan(0);

    // Immutable audit + timeline written
    expect(await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'EMERGENCY_ACTIVATED' } })).toBe(1);
    const timeline = await prisma.emergencyEvent.findMany({ where: { incidentId } });
    expect(timeline.map((t) => t.type)).toEqual(expect.arrayContaining(['ACTIVATED', 'NOTIFIED', 'ATTENDANCE_LOCKED', 'TIMETABLE_PAUSED']));

    // Attendance editing is frozen (423)
    const mark = await request(app).post('/api/attendance/mark').set(authHeader(fx.teacher.token)).send({ studentId: fx.student.id, classId: fx.class.id, status: 'PRESENT' });
    expect(mark.status).toBe(423);

    // Timetable mutations are paused (423)
    const gen = await request(app).post('/api/timetable/generate').set(authHeader(fx.admin.token)).send({});
    expect(gen.status).toBe(423);

    // A second trigger is refused while one is active
    const dup = await request(app).post('/api/emergency/trigger').set(authHeader(fx.principal.token)).send({ kind: 'LOCKDOWN' });
    expect(dup.status).toBe(400);
  });

  it('teacher acknowledgement derives class status; resolution unlocks everything', async () => {
    const fx = await createFixture();
    const trig = await request(app).post('/api/emergency/trigger').set(authHeader(fx.principal.token)).send({ kind: 'LOCKDOWN' });
    const incidentId = trig.body.incident.id;

    // Teacher reports their class safe
    const ack = await request(app).post(`/api/emergency/${incidentId}/acknowledge`).set(authHeader(fx.teacher.token)).send({ status: 'SAFE' });
    expect(ack.status).toBe(200);

    // Principal dashboard reflects it — derived, not fabricated
    const state = await request(app).get(`/api/emergency/${incidentId}/state`).set(authHeader(fx.principal.token));
    expect(state.status).toBe(200);
    expect(state.body.teachers.safe).toBe(1);
    const myClass = state.body.classStatuses.find((c: { name: string }) => c.name === fx.class.name);
    expect(myClass.status).toBe('SAFE');

    // Re-acknowledging updates in place (no double count)
    await request(app).post(`/api/emergency/${incidentId}/acknowledge`).set(authHeader(fx.teacher.token)).send({ status: 'NEED_ASSISTANCE' });
    const state2 = await request(app).get(`/api/emergency/${incidentId}/state`).set(authHeader(fx.principal.token));
    expect(state2.body.teachers.safe).toBe(0);
    expect(state2.body.teachers.needAssistance).toBe(1);

    // Resolve → unlocks attendance
    const res = await request(app).post(`/api/emergency/resolve/${incidentId}`).set(authHeader(fx.principal.token));
    expect(res.status).toBe(200);
    expect((await prisma.emergencyIncident.findUnique({ where: { id: incidentId } }))!.status).toBe('RESOLVED');

    const mark = await request(app).post('/api/attendance/mark').set(authHeader(fx.teacher.token)).send({ studentId: fx.student.id, classId: fx.class.id, status: 'PRESENT' });
    expect(mark.status).toBe(200);
  });

  it('students cannot acknowledge; only teachers and parents', async () => {
    const fx = await createFixture();
    const trig = await request(app).post('/api/emergency/trigger').set(authHeader(fx.principal.token)).send({ kind: 'MEDICAL' });
    const res = await request(app).post(`/api/emergency/${trig.body.incident.id}/acknowledge`).set(authHeader(fx.student.userToken)).send({ status: 'ACKNOWLEDGED' });
    expect([400, 403]).toContain(res.status);
  });
});

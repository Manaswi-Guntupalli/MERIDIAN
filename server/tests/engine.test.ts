import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Presence engine — validation pipeline', () => {
  it('rejects a scan against an unknown reader id, and writes nothing (transaction rollback)', async () => {
    const fx = await createFixture();
    const before = await prisma.attendanceEvent.count({ where: { schoolId: fx.school.id } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: 'does-not-exist', cardUid: fx.card.uid });

    expect(res.status).toBe(400);
    const after = await prisma.attendanceEvent.count({ where: { schoolId: fx.school.id } });
    expect(after).toBe(before);
  });

  it('rejects an RFID scan when the reader is offline, and still logs it for audit', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.offlineReader.id, cardUid: fx.card.uid });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toMatch(/offline/i);

    const event = await prisma.attendanceEvent.findUnique({ where: { id: res.body.eventId } });
    expect(event?.verificationStatus).toBe('REJECTED');
  });

  it('flags an unrecognized card UID as UNKNOWN and never touches Attendance', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: 'NO-SUCH-CARD' });

    expect(res.body.status).toBe('UNKNOWN');
    const attendance = await prisma.attendance.findMany({ where: { schoolId: fx.school.id } });
    expect(attendance.length).toBe(0);
  });

  it('rejects a disabled card', async () => {
    const fx = await createFixture();
    await request(app).post(`/api/presence/cards/${fx.card.id}/disable`).set(authHeader(fx.admin.token)).expect(200);

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toMatch(/disabled/i);
  });

  it('rejects a lost card', async () => {
    const fx = await createFixture();
    await request(app).post(`/api/presence/cards/${fx.card.id}/lost`).set(authHeader(fx.admin.token)).expect(200);

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toMatch(/lost/i);
  });

  it('rejects a scan for an inactive student', async () => {
    const fx = await createFixture();
    await request(app).patch(`/api/students/${fx.student.id}`).set(authHeader(fx.admin.token)).send({ active: false }).expect(200);

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toMatch(/not active/i);
  });

  it('rejects a scan for a student with no class assigned', async () => {
    const fx = await createFixture();
    const orphan = await prisma.student.create({
      data: { schoolId: fx.school.id, admissionNo: `ADM-ORPHAN-${fx.suffix}`, rollNo: 99, name: 'No Class Student' },
    });
    const orphanCard = await prisma.rFIDCard.create({ data: { schoolId: fx.school.id, studentId: orphan.id, uid: `UID-ORPHAN-${fx.suffix}`, status: 'ACTIVE' } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: orphanCard.uid });

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toMatch(/no class/i);
  });

  it('ignores a duplicate scan within the configured window and does not double-count it', async () => {
    const fx = await createFixture();
    const first = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });
    expect(['VERIFIED', 'LATE']).toContain(first.body.status);

    const second = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });
    expect(second.body.status).toBe('DUPLICATE');

    const attendance = await prisma.attendance.findMany({ where: { schoolId: fx.school.id, studentId: fx.student.id } });
    expect(attendance.length).toBe(1); // one materialized row, not two
  });

  it('classifies a forced-late entry as LATE with minutes past the threshold', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/simulate/late').set(authHeader(fx.admin.token)).send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(res.body.status).toBe('LATE');
    expect(res.body.late).toBe(true);
    expect(res.body.lateMinutes).toBeGreaterThan(0);
  });

  it('toggles direction ENTRY → EXIT → REENTRY across successive scans', async () => {
    const fx = await createFixture();
    // Disable the duplicate window so three back-to-back scans aren't merged.
    await request(app).put('/api/presence/settings').set(authHeader(fx.admin.token)).send({ duplicateWindowSeconds: 0 }).expect(200);

    const scan = () => request(app).post('/api/presence/simulate/scan').set(authHeader(fx.admin.token)).send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    const e1 = await scan();
    const e2 = await scan();
    const e3 = await scan();

    expect(e1.body.direction).toBe('ENTRY');
    expect(e2.body.direction).toBe('EXIT');
    expect(e3.body.direction).toBe('REENTRY');
  });

  it('a successful scan writes exactly one AttendanceEvent and one Attendance row atomically', async () => {
    const fx = await createFixture();
    const beforeEvents = await prisma.attendanceEvent.count({ where: { schoolId: fx.school.id } });
    const beforeAttendance = await prisma.attendance.count({ where: { schoolId: fx.school.id } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(['VERIFIED', 'LATE']).toContain(res.body.status);
    expect(await prisma.attendanceEvent.count({ where: { schoolId: fx.school.id } })).toBe(beforeEvents + 1);
    expect(await prisma.attendance.count({ where: { schoolId: fx.school.id } })).toBe(beforeAttendance + 1);
  });

  it('MANUAL corrections bypass the reader-existence and offline checks entirely', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/scan')
      .set(authHeader(fx.admin.token))
      .send({ source: 'MANUAL', studentId: fx.student.id, direction: 'ENTRY' });

    expect(res.status).toBe(200);
    expect(['VERIFIED', 'LATE']).toContain(res.body.status);
  });
});

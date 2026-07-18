import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Trust Ledger integration', () => {
  it('issuing a card writes an AuditLog entry', async () => {
    const fx = await createFixture();
    const before = await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'RFID_CARD_ISSUED' } });

    await request(app).post('/api/presence/cards').set(authHeader(fx.admin.token)).send({ studentId: fx.studentInOtherClass.id, uid: `AUDIT-${fx.suffix}` });

    expect(await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'RFID_CARD_ISSUED' } })).toBe(before + 1);
  });

  it('disabling a card writes an AuditLog entry', async () => {
    const fx = await createFixture();
    const before = await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'RFID_CARD_DISABLED', entityId: fx.card.id } });

    await request(app).post(`/api/presence/cards/${fx.card.id}/disable`).set(authHeader(fx.admin.token));

    expect(await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'RFID_CARD_DISABLED', entityId: fx.card.id } })).toBe(before + 1);
  });

  it('a scan writes both an immutable Event and an AILog entry, atomically with the AttendanceEvent', async () => {
    const fx = await createFixture();
    const beforeEvents = await prisma.event.count({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_EVENT_RECORDED' } });
    const beforeAI = await prisma.aILog.count({ where: { schoolId: fx.school.id, engine: 'PRESENCE' } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(await prisma.event.count({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_EVENT_RECORDED' } })).toBe(beforeEvents + 1);
    // One AILog for the scan resolution itself, plus one per notification
    // channel stub fired for the parent (email + push — this fixture's
    // parent has no phone on file, so the SMS stub is skipped).
    expect(await prisma.aILog.count({ where: { schoolId: fx.school.id, engine: 'PRESENCE' } })).toBe(beforeAI + 3);

    const event = await prisma.event.findFirst({ where: { schoolId: fx.school.id, aggregateId: res.body.eventId } });
    expect(event).not.toBeNull();
    expect(event?.reversible).toBe(false); // attendance events are audited, not undo-able
  });

  it('a REJECTED scan still writes an Event — audit covers rejections, not just successes', async () => {
    const fx = await createFixture();
    await request(app).post(`/api/presence/cards/${fx.card.id}/disable`).set(authHeader(fx.admin.token));

    const beforeEvents = await prisma.event.count({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_EVENT_RECORDED' } });
    await request(app).post('/api/presence/simulate/scan').set(authHeader(fx.admin.token)).send({ readerId: fx.reader.id, cardUid: fx.card.uid });

    expect(await prisma.event.count({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_EVENT_RECORDED' } })).toBe(beforeEvents + 1);
  });
});

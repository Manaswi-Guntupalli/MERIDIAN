import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Presence notifications', () => {
  it('a verified entry notifies the linked parent', async () => {
    const fx = await createFixture();
    const before = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.parent.user.id, category: 'ATTENDANCE' } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid });
    expect(['VERIFIED', 'LATE']).toContain(res.body.status);

    const after = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.parent.user.id, category: 'ATTENDANCE' } });
    expect(after).toBe(before + 1);
  });

  it('a duplicate scan does not send a second parent notification', async () => {
    const fx = await createFixture();
    await request(app).post('/api/presence/simulate/scan').set(authHeader(fx.admin.token)).send({ readerId: fx.reader.id, cardUid: fx.card.uid });
    const afterFirst = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.parent.user.id, category: 'ATTENDANCE' } });

    const dup = await request(app).post('/api/presence/simulate/scan').set(authHeader(fx.admin.token)).send({ readerId: fx.reader.id, cardUid: fx.card.uid });
    expect(dup.body.status).toBe('DUPLICATE');

    const afterSecond = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.parent.user.id, category: 'ATTENDANCE' } });
    expect(afterSecond).toBe(afterFirst);
  });

  it('fee reminders are addressed to the student and their guardians — never broadcast', async () => {
    const fx = await createFixture();
    await prisma.fee.create({
      data: { schoolId: fx.school.id, studentId: fx.student.id, title: 'Term 1 Tuition', amount: 10000, paid: 0, dueDate: '2026-06-01', status: 'OVERDUE' },
    });
    // A second student with no portal account and no guardians — their fee
    // must not generate a broadcast either.
    await prisma.fee.create({
      data: { schoolId: fx.school.id, studentId: fx.studentInOtherClass.id, title: 'Term 1 Tuition', amount: 8000, paid: 0, dueDate: '2026-06-01', status: 'OVERDUE' },
    });

    const res = await request(app).post('/api/fees/remind').set(authHeader(fx.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.drafted).toBe(2);

    // No school-wide FEES broadcast rows may exist — that was the leak.
    const broadcasts = await prisma.notification.count({ where: { schoolId: fx.school.id, category: 'FEES', userId: null } });
    expect(broadcasts).toBe(0);

    // Student + guardian each got exactly their own reminder.
    for (const userId of [fx.student.userId!, fx.parent.user.id]) {
      const own = await prisma.notification.count({ where: { schoolId: fx.school.id, category: 'FEES', title: 'Fee reminder', userId } });
      expect(own).toBe(1);
    }

    // And the student's inbox via the API contains no other student's dues.
    const inbox = await request(app).get('/api/notifications').set(authHeader(fx.student.userToken));
    const feeItems = inbox.body.notifications.filter((n: { category: string; title: string }) => n.category === 'FEES');
    expect(feeItems).toHaveLength(1);
    expect(feeItems[0].body).toContain(fx.student.name);
    expect(feeItems[0].body).not.toContain(fx.studentInOtherClass.name);
  });

  it('an unknown card notifies admins under the SECURITY category, not a student/parent', async () => {
    const fx = await createFixture();
    const before = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.admin.user.id, category: 'SECURITY' } });

    const res = await request(app)
      .post('/api/presence/simulate/scan')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: 'TOTALLY-UNKNOWN' });
    expect(res.body.status).toBe('UNKNOWN');

    const after = await prisma.notification.count({ where: { schoolId: fx.school.id, userId: fx.admin.user.id, category: 'SECURITY' } });
    expect(after).toBe(before + 1);
  });
});

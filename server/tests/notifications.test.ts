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

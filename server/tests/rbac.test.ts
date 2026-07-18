import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Presence RBAC', () => {
  it('teacher is forbidden from creating a reader', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/readers').set(authHeader(fx.teacher.token)).send({ name: 'x', location: 'y' });
    expect(res.status).toBe(403);
  });

  it('teacher is forbidden from issuing a card', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/cards').set(authHeader(fx.teacher.token)).send({ studentId: fx.studentInOtherClass.id, uid: 'X' });
    expect(res.status).toBe(403);
  });

  it('a teacher may manually mark a student in their own class', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/scan')
      .set(authHeader(fx.teacher.token))
      .send({ source: 'MANUAL', studentId: fx.student.id, direction: 'ENTRY' });
    expect(res.status).toBe(200);
  });

  it("a teacher may NOT manually mark a student outside their own class", async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/scan')
      .set(authHeader(fx.teacher.token))
      .send({ source: 'MANUAL', studentId: fx.studentInOtherClass.id, direction: 'ENTRY' });
    expect(res.status).toBe(403);
  });

  it('admin has full access to readers, cards and manual corrections', async () => {
    const fx = await createFixture();
    expect((await request(app).get('/api/presence/readers').set(authHeader(fx.admin.token))).status).toBe(200);
    expect((await request(app).get('/api/presence/cards').set(authHeader(fx.admin.token))).status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/presence/scan')
          .set(authHeader(fx.admin.token))
          .send({ source: 'MANUAL', studentId: fx.studentInOtherClass.id, direction: 'ENTRY' })
      ).status,
    ).toBe(200);
  });

  it('a parent can view their own child\'s history but not another student\'s', async () => {
    const fx = await createFixture();
    const own = await request(app).get(`/api/presence/history/${fx.student.id}`).set(authHeader(fx.parent.token));
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/presence/history/${fx.studentInOtherClass.id}`).set(authHeader(fx.parent.token));
    expect(other.status).toBe(403);
  });

  it("a student can view their own history but not another student's", async () => {
    const fx = await createFixture();
    const own = await request(app).get(`/api/presence/history/${fx.student.id}`).set(authHeader(fx.student.userToken));
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/presence/history/${fx.studentInOtherClass.id}`).set(authHeader(fx.student.userToken));
    expect(other.status).toBe(403);
  });

  it('parent/student cannot see the staff operational live feed', async () => {
    const fx = await createFixture();
    const res = await request(app).get('/api/presence/events').set(authHeader(fx.parent.token));
    expect(res.status).toBe(403);
  });
});

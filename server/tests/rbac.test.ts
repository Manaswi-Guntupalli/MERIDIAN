import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Presence RBAC', () => {
  it('a student is forbidden from starting an attendance session', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/session/start').set(authHeader(fx.student.userToken)).send({ classId: fx.class.id });
    expect(res.status).toBe(403);
  });

  it('a teacher may start an attendance session for their own class', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/session/start').set(authHeader(fx.teacher.token)).send({ classId: fx.class.id });
    expect(res.status).toBe(201);
    expect(res.body.qr).toBeTruthy(); // staff see the token
  });

  it('admin can start a session and list sessions', async () => {
    const fx = await createFixture();
    expect((await request(app).post('/api/presence/session/start').set(authHeader(fx.admin.token)).send({ classId: fx.class.id })).status).toBe(201);
    expect((await request(app).get('/api/presence/session').set(authHeader(fx.admin.token))).status).toBe(200);
  });

  it('a student scanning the active session QR sees it without the token', async () => {
    const fx = await createFixture();
    await request(app).post('/api/presence/session/start').set(authHeader(fx.teacher.token)).send({ classId: fx.class.id });
    const res = await request(app).get(`/api/presence/session/active?classId=${fx.class.id}`).set(authHeader(fx.student.userToken));
    expect(res.status).toBe(200);
    expect(res.body.session?.qr).toBeNull(); // students never receive the token
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

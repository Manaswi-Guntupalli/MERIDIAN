import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('RFID card lifecycle', () => {
  it('issues a card to a student', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/cards')
      .set(authHeader(fx.admin.token))
      .send({ studentId: fx.studentInOtherClass.id, uid: `NEW-${fx.suffix}` });
    expect(res.status).toBe(201);
    expect(res.body.card.status).toBe('ACTIVE');
  });

  it('rejects issuing a second active card to a student who already has one', async () => {
    const fx = await createFixture();
    const res = await request(app).post('/api/presence/cards').set(authHeader(fx.admin.token)).send({ studentId: fx.student.id, uid: `SECOND-${fx.suffix}` });
    expect(res.status).toBe(400);
  });

  it('detects a duplicate UID within the same school', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/cards')
      .set(authHeader(fx.admin.token))
      .send({ studentId: fx.studentInOtherClass.id, uid: fx.card.uid }); // reuses fx.card's UID
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('replaces a card — old card is REPLACED and linked to the new ACTIVE card', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post(`/api/presence/cards/${fx.card.id}/replace`)
      .set(authHeader(fx.admin.token))
      .send({ newUid: `REPLACEMENT-${fx.suffix}` });

    expect(res.status).toBe(200);
    expect(res.body.oldCard.status).toBe('REPLACED');
    expect(res.body.oldCard.replacedByCardId).toBe(res.body.newCard.id);
    expect(res.body.newCard.status).toBe('ACTIVE');
  });

  it('disables then reissues a card', async () => {
    const fx = await createFixture();
    const disabled = await request(app).post(`/api/presence/cards/${fx.card.id}/disable`).set(authHeader(fx.admin.token));
    expect(disabled.body.card.status).toBe('DISABLED');

    const reissued = await request(app).post(`/api/presence/cards/${fx.card.id}/reissue`).set(authHeader(fx.admin.token));
    expect(reissued.status).toBe(200);
    expect(reissued.body.card.status).toBe('ACTIVE');
  });

  it('records full card history for a student', async () => {
    const fx = await createFixture();
    await request(app).post(`/api/presence/cards/${fx.card.id}/replace`).set(authHeader(fx.admin.token)).send({ newUid: `HIST-${fx.suffix}` });

    const res = await request(app).get(`/api/presence/cards/history/${fx.student.id}`).set(authHeader(fx.admin.token));
    expect(res.body.cards.length).toBe(2);
    expect(res.body.cards.map((c: { status: string }) => c.status).sort()).toEqual(['ACTIVE', 'REPLACED']);
  });
});

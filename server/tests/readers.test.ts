import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

describe('Reader heartbeat & health', () => {
  it('a heartbeat with the correct device key brings a reader online and records it', async () => {
    const fx = await createFixture();
    await prisma.rFIDReader.update({ where: { id: fx.reader.id }, data: { online: false } });

    const res = await request(app)
      .post(`/api/presence/readers/${fx.reader.id}/heartbeat`)
      .set('x-reader-key', fx.readerApiKey)
      .send({ readerId: fx.reader.id, firmwareVersion: '2.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.reader.online).toBe(true);
    expect(res.body.reader.apiKeyHash).toBeUndefined();

    const beats = await prisma.readerHeartbeat.count({ where: { readerId: fx.reader.id } });
    expect(beats).toBe(1);
  });

  it('rejects a heartbeat with the wrong device key', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post(`/api/presence/readers/${fx.reader.id}/heartbeat`)
      .set('x-reader-key', 'wrong-key')
      .send({ readerId: fx.reader.id });
    expect(res.status).toBe(401);
  });

  it('simulator go-online heartbeats every reader in the school back online', async () => {
    const fx = await createFixture();
    await prisma.rFIDReader.update({ where: { id: fx.reader.id }, data: { online: false } });

    const res = await request(app).post('/api/presence/simulate/go-online').set(authHeader(fx.admin.token));
    expect(res.status).toBe(200);

    const reader = await prisma.rFIDReader.findUnique({ where: { id: fx.reader.id } });
    expect(reader!.online).toBe(true);
    expect(reader!.lastHeartbeat).not.toBeNull();
    expect(await prisma.readerHeartbeat.count({ where: { readerId: fx.reader.id } })).toBe(1);
  });

  it('sweeps a reader offline once its last heartbeat is older than the configured threshold', async () => {
    const fx = await createFixture();
    await request(app).put('/api/presence/settings').set(authHeader(fx.admin.token)).send({ heartbeatOfflineThresholdSeconds: 15 }).expect(200);
    await prisma.rFIDReader.update({ where: { id: fx.reader.id }, data: { online: true, lastHeartbeat: new Date(Date.now() - 60_000) } });

    const res = await request(app).get('/api/presence/readers').set(authHeader(fx.admin.token));
    const found = res.body.readers.find((r: { id: string }) => r.id === fx.reader.id);
    expect(found.online).toBe(false);
  });
});

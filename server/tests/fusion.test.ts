import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

// ── Test doubles for the CAMERA only: unit vectors standing in for the live
// 128-D descriptors a real webcam frame produces. The verification math,
// engine gate, PROXY handling and alerts are all the real pipeline. ──
function unitVector(seedOffset = 0): number[] {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.37 + seedOffset) + (Math.random() - 0.5) * 0.01);
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
/** The same face re-captured: tiny noise, cosine ≈ 0.99 vs the template. */
function recapture(vec: number[]): number[] {
  const v = vec.map((x) => x + (Math.random() * 2 - 1) * 0.02);
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function enroll(schoolId: string, studentId: string, name: string, vector: number[]) {
  await prisma.faceEmbedding.create({
    data: { schoolId, subjectType: 'STUDENT', subjectId: studentId, name, vectorString: JSON.stringify(vector), label: 'front', quality: 0.9 },
  });
  await prisma.student.update({ where: { id: studentId }, data: { faceEnrolled: true, faceCount: 1 } });
}

describe('Fusion gate — RFID tap + live face, both required', () => {
  it('card + matching face marks attendance with the proof on the event', async () => {
    const fx = await createFixture();
    const template = unitVector(1);
    await enroll(fx.school.id, fx.student.id, fx.student.name, template);

    const res = await request(app)
      .post('/api/presence/scan/fusion')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid, vector: recapture(template), strict: true });
    expect(res.status).toBe(200);
    expect(['VERIFIED', 'LATE']).toContain(res.body.status); // LATE after start+grace — both a success
    expect(res.body.fusion.verified).toBe(true);
    expect(res.body.fusion.similarity).toBeGreaterThan(0.9);

    const event = await prisma.attendanceEvent.findUnique({ where: { id: res.body.eventId } });
    expect(event?.source).toBe('FUSION');
    expect(event?.notes).toContain('face verified');

    const att = await prisma.attendance.findFirst({ where: { studentId: fx.student.id } });
    expect(att).toBeTruthy();
  });

  it("someone else's face with this card is blocked as PROXY + security alert", async () => {
    const fx = await createFixture();
    // Phase-shifted sinusoid vectors: cosine ≈ cos(offset difference).
    // cos(2) ≈ −0.42 — decisively below the 0.72 verify threshold.
    const owner = unitVector(0);
    const imposter = unitVector(2);
    await enroll(fx.school.id, fx.student.id, fx.student.name, owner);
    await enroll(fx.school.id, fx.studentInOtherClass.id, fx.studentInOtherClass.name, imposter);

    const res = await request(app)
      .post('/api/presence/scan/fusion')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid, vector: recapture(imposter), strict: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROXY');
    expect(res.body.fusion.verified).toBe(false);
    expect(res.body.reason).toContain('does not match cardholder');
    // The engine names who actually showed up (1:N match).
    expect(res.body.reason).toContain(fx.studentInOtherClass.name);

    // No attendance for the cardholder; the incident is fully audited.
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0);
    expect(await prisma.faceEvent.count({ where: { schoolId: fx.school.id, kind: 'PROXY' } })).toBe(1);
    const alert = await prisma.notification.findFirst({ where: { schoolId: fx.school.id, title: 'Possible proxy attendance blocked' } });
    expect(alert?.severity).toBe('CRITICAL');
  });

  it('strict gate: an un-enrolled cardholder is REJECTED — never marked on card alone', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/scan/fusion')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid, vector: unitVector(5), strict: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reason).toContain('no enrolled face');
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0);
    // The rejection is on the audit trail, not silently dropped.
    const event = await prisma.attendanceEvent.findUnique({ where: { id: res.body.eventId } });
    expect(event?.verificationStatus).toBe('REJECTED');
  });

  it('non-strict (device path): un-enrolled cardholder degrades honestly to RFID', async () => {
    const fx = await createFixture();
    const res = await request(app)
      .post('/api/presence/scan/fusion')
      .set(authHeader(fx.admin.token))
      .send({ readerId: fx.reader.id, cardUid: fx.card.uid, vector: unitVector(7) });
    expect(res.status).toBe(200);
    expect(['VERIFIED', 'LATE']).toContain(res.body.status);
    expect(res.body.fusion.verified).toBeNull();
    const event = await prisma.attendanceEvent.findUnique({ where: { id: res.body.eventId } });
    expect(event?.source).toBe('RFID');
    expect(event?.notes).toContain('no face enrolled');
  });
});

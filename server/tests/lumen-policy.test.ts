import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, authHeader } from './helpers.js';

const app = createApp();

/** A VERIFIED admission document whose form version carried no phone box. */
async function makeVerifiedAdmission(schoolId: string) {
  const doc = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'admission-test.jpg', status: 'VERIFIED', overallConfidence: 0.95 },
  });
  await prisma.extractedField.createMany({
    data: [
      { documentId: doc.id, key: 'studentName', label: 'Student name', value: 'Test Child Kumar', confidence: 0.98, cropX: 0.1, cropY: 0.1, cropW: 0.4, cropH: 0.05, status: 'CONFIRMED', expected: true },
      { documentId: doc.id, key: 'dob', label: 'Date of birth', value: '2015-06-02', confidence: 0.97, cropX: 0.1, cropY: 0.2, cropW: 0.4, cropH: 0.05, status: 'CONFIRMED', expected: true },
      { documentId: doc.id, key: 'className', label: 'Class', value: '6A', confidence: 0.94, cropX: 0.1, cropY: 0.3, cropW: 0.3, cropH: 0.05, status: 'AUTO' },
      // This form version has no phone box at all → ABSENT, zero review work.
      { documentId: doc.id, key: 'phone', label: 'Contact number', value: '', confidence: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0, status: 'ABSENT', expected: true },
    ],
  });
  return doc;
}

describe('Commit policy — school business rule, separate from document structure', () => {
  it('default policy blocks the commit with NAMED fields; relaxing the policy commits the same document', async () => {
    const fx = await createFixture();
    const doc = await makeVerifiedAdmission(fx.school.id);

    // Readiness is visible on the document BEFORE anyone clicks commit.
    const detail = await request(app).get(`/api/documents/${doc.id}`).set(authHeader(fx.admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.document.commitReadiness.ready).toBe(false);
    expect(detail.body.document.commitReadiness.missing).toEqual([{ key: 'phone', label: 'Contact number' }]);

    // School A (defaults require phone): blocked, and the error names the field.
    const blocked = await request(app).post(`/api/documents/${doc.id}/commit`).set(authHeader(fx.admin.token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error ?? blocked.body.message ?? JSON.stringify(blocked.body)).toMatch(/Contact number/);

    // School B: phone is optional here — same templates, different policy.
    const put = await request(app)
      .put('/api/documents/commit-policy')
      .set(authHeader(fx.admin.token))
      .send({ kind: 'STUDENT', required: ['studentName', 'dob'] });
    expect(put.status).toBe(200);
    expect(put.body.required).toEqual(['studentName', 'dob']);

    // The exact same document now commits — the pipeline never had to care.
    const ok = await request(app).post(`/api/documents/${doc.id}/commit`).set(authHeader(fx.admin.token));
    expect(ok.status).toBe(200);
    const student = await prisma.student.findFirst({ where: { schoolId: fx.school.id, name: 'Test Child Kumar' } });
    expect(student).toBeTruthy();

    // The policy change itself is audited.
    expect(
      await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: 'LUMEN_COMMIT_POLICY_CHANGED' } }),
    ).toBe(1);
  });

  it('policy endpoint rejects unknown field keys and exposes legal choices', async () => {
    const fx = await createFixture();
    const bad = await request(app)
      .put('/api/documents/commit-policy')
      .set(authHeader(fx.admin.token))
      .send({ kind: 'STUDENT', required: ['studentName', 'notAField'] });
    expect(bad.status).toBe(400);

    const get = await request(app).get('/api/documents/commit-policy').set(authHeader(fx.admin.token));
    expect(get.status).toBe(200);
    expect(get.body.policy.STUDENT.required).toEqual(['studentName', 'dob', 'phone']); // defaults
    expect(get.body.policy.STUDENT.available.some((c: { key: string }) => c.key === 'bloodGroup')).toBe(true);
  });
});

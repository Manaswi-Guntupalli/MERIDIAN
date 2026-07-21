import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { commitDocument } from '../src/services/lumen/commit.js';
import { createFixture } from './helpers.js';

// The fixture creates classes 6A and 7A. We add fields to a VERIFIED admission
// document and try to commit it — asserting the class-existence guard.
async function admissionDoc(schoolId: string, className: string) {
  const doc = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'test-admission.jpg', status: 'VERIFIED', overallConfidence: 0.95 },
  });
  const crop = { cropX: 0.12, cropY: 0.14, cropW: 0.5, cropH: 0.06 };
  await prisma.extractedField.createMany({
    data: [
      { documentId: doc.id, key: 'studentName', label: 'Student name', value: 'Test Child', confidence: 0.99, status: 'AUTO', ...crop },
      { documentId: doc.id, key: 'className', label: 'Class', value: className, confidence: 0.95, status: 'AUTO', ...crop },
      // Satisfy the school's default commit policy (studentName, dob, phone) —
      // these tests are about CLASS validation, not policy gating (that has
      // its own suite in lumen-policy.test.ts).
      { documentId: doc.id, key: 'dob', label: 'Date of birth', value: '2014-04-09', confidence: 0.97, status: 'AUTO', ...crop },
      { documentId: doc.id, key: 'phone', label: 'Contact number', value: '+91 9822011223', confidence: 0.96, status: 'AUTO', ...crop },
    ],
  });
  return doc;
}

describe('Lumen commit — class validation', () => {
  it('blocks committing a student into a section the school does not have', async () => {
    const fx = await createFixture();
    // The fixture has grade 6 section A only; ask for 6C.
    const doc = await admissionDoc(fx.school.id, '6C');
    await expect(commitDocument(doc.id, fx.school.id, { id: fx.admin.user.id, name: fx.admin.user.name })).rejects.toThrow(/grade 6 only has section A/i);

    // Nothing was created — the transaction rolled back.
    expect(await prisma.student.count({ where: { schoolId: fx.school.id, name: 'Test Child' } })).toBe(0);
    expect((await prisma.document.findUnique({ where: { id: doc.id } }))!.status).toBe('VERIFIED');
  });

  it('blocks committing into a grade that does not exist at all', async () => {
    const fx = await createFixture();
    const doc = await admissionDoc(fx.school.id, 'Grade 11 · Section A');
    await expect(commitDocument(doc.id, fx.school.id, { id: fx.admin.user.id, name: fx.admin.user.name })).rejects.toThrow(/no grade 11/i);
  });

  it('commits cleanly into a valid class and assigns the student to it', async () => {
    const fx = await createFixture();
    const doc = await admissionDoc(fx.school.id, '6A');
    const result = await commitDocument(doc.id, fx.school.id, { id: fx.admin.user.id, name: fx.admin.user.name });
    expect(result.kind).toBe('STUDENT');
    const student = await prisma.student.findFirst({ where: { schoolId: fx.school.id, name: 'Test Child' }, include: { class: true } });
    expect(student?.class?.name).toBe(fx.class.name); // 6A
  });
});

import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createFixture, enrollTestFace, unitVector, recapture } from './helpers.js';
import { startSession, closeSession, expireIfDue } from '../src/services/presence/session.js';
import { markFace, markQr, markManual } from '../src/services/presence/engine.js';

// These exercise the REAL attendance engine — the verification state machine,
// anti-proxy gate, session lifecycle, Trust Core integration and notifications.
// Face descriptors are synthetic 512-D vectors (a test can't run a camera); the
// engine, matching and every side effect are the production code paths.

/** Add a second active student to the fixture's class (for the proxy case). */
async function secondStudentInClass(fx: Awaited<ReturnType<typeof createFixture>>) {
  return prisma.student.create({
    data: { schoolId: fx.school.id, admissionNo: `ADM-B-${fx.suffix}`, rollNo: 2, name: `Second Student ${fx.suffix}`, classId: fx.class.id },
  });
}

describe('Attendance sessions — the state machine', () => {
  it('start seeds a PENDING verification per active student and mints a token', async () => {
    const fx = await createFixture();
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id, createdBy: fx.teacher.user.id });
    expect(session.status).toBe('ACTIVE');
    expect(session.sessionToken.length).toBeGreaterThan(20);
    const verifications = await prisma.attendanceVerification.findMany({ where: { sessionId: session.id } });
    expect(verifications).toHaveLength(1); // the fixture class has one student
    expect(verifications[0].state).toBe('PENDING');
    // The start is on the Trust Core timeline.
    expect(await prisma.event.count({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_SESSION_STARTED' } })).toBe(1);
  });

  it('face is sufficient: a matching face → PRESENT, materialised + reversible', async () => {
    const fx = await createFixture();
    const v = unitVector(1);
    await enrollTestFace(fx.school.id, 'STUDENT', fx.student.id, fx.student.name, v);
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });

    const beforeAI = await prisma.aILog.count({ where: { schoolId: fx.school.id, engine: 'PRESENCE' } });
    const result = await markFace({ schoolId: fx.school.id, sessionId: session.id, embedding: recapture(v) });
    expect(result.state).toBe('PRESENT');
    expect(result.studentId).toBe(fx.student.id);

    // Materialised daily row exists (PRESENT, or LATE if the suite runs after
    // school start + grace — both mean the student is marked in).
    const att = await prisma.attendance.findFirst({ where: { studentId: fx.student.id } });
    expect(['PRESENT', 'LATE']).toContain(att?.status);
    expect(att?.source).toBe('FACE');
    // A reversible ATTENDANCE_MARKED event + an AILog with the real confidence.
    const marked = await prisma.event.findFirst({ where: { schoolId: fx.school.id, type: 'ATTENDANCE_MARKED' } });
    expect(marked?.reversible).toBe(true);
    expect(await prisma.aILog.count({ where: { schoolId: fx.school.id, engine: 'PRESENCE' } })).toBeGreaterThan(beforeAI);
    // Parent was notified.
    expect(await prisma.notification.count({ where: { userId: fx.parent.user.id, category: 'ATTENDANCE' } })).toBe(1);
  });

  it('QR alone is NOT present: QR_VERIFIED → UNVERIFIED_QR at expiry', async () => {
    const fx = await createFixture();
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    const qr = await markQr({ schoolId: fx.school.id, sessionId: session.id, token: session.sessionToken, studentId: fx.student.id });
    expect(qr.state).toBe('QR_VERIFIED');
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0); // NOT present yet

    // Force expiry → the QR-only verification becomes UNVERIFIED_QR, never PRESENT.
    await prisma.attendanceSession.update({ where: { id: session.id }, data: { expiryTime: new Date(Date.now() - 1000) } });
    expect(await expireIfDue(session.id)).toBe('EXPIRED');
    const v = await prisma.attendanceVerification.findFirst({ where: { sessionId: session.id, studentId: fx.student.id } });
    expect(v?.state).toBe('UNVERIFIED_QR');
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0);
  });

  it('QR + a matching face → PRESENT (both factors)', async () => {
    const fx = await createFixture();
    const v = unitVector(2);
    await enrollTestFace(fx.school.id, 'STUDENT', fx.student.id, fx.student.name, v);
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    const result = await markQr({ schoolId: fx.school.id, sessionId: session.id, token: session.sessionToken, studentId: fx.student.id, embedding: recapture(v) });
    expect(result.state).toBe('PRESENT');
    expect((await prisma.attendance.findFirst({ where: { studentId: fx.student.id } }))?.source).toBe('QR');
  });

  it('ANTI-PROXY: QR claims A but the face is B → PROXY_ATTEMPT, no attendance, alert + FaceEvent', async () => {
    const fx = await createFixture();
    const studentB = await secondStudentInClass(fx);
    const vA = unitVector(10);
    const vB = unitVector(99);
    await enrollTestFace(fx.school.id, 'STUDENT', fx.student.id, fx.student.name, vA);
    await enrollTestFace(fx.school.id, 'STUDENT', studentB.id, studentB.name, vB);
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });

    // Student A's QR is scanned, but the face presented is B's.
    const result = await markQr({ schoolId: fx.school.id, sessionId: session.id, token: session.sessionToken, studentId: fx.student.id, embedding: recapture(vB) });
    expect(result.state).toBe('PROXY_ATTEMPT');
    expect(result.reason).toMatch(/did not match/i);
    expect(result.reason).toContain(studentB.name); // names who actually showed up

    // No attendance for the claimed student; the incident is fully recorded.
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0);
    expect(await prisma.faceEvent.count({ where: { schoolId: fx.school.id, kind: 'PROXY' } })).toBe(1);
    expect(await prisma.event.count({ where: { schoolId: fx.school.id, type: 'PROXY_ATTEMPT' } })).toBe(1);
    const alert = await prisma.notification.findFirst({ where: { schoolId: fx.school.id, title: 'Possible proxy attendance blocked' } });
    expect(alert?.severity).toBe('CRITICAL');
  });

  it('an unknown face (nobody enrolled) is reported, not marked', async () => {
    const fx = await createFixture();
    await enrollTestFace(fx.school.id, 'STUDENT', fx.student.id, fx.student.name, unitVector(3));
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    const result = await markFace({ schoolId: fx.school.id, sessionId: session.id, embedding: unitVector(70000) });
    expect(result.state).toBe('ABSENT');
    expect(await prisma.attendance.count({ where: { studentId: fx.student.id } })).toBe(0);
    expect(await prisma.faceEvent.count({ where: { schoolId: fx.school.id, kind: 'UNKNOWN' } })).toBe(1);
  });

  it('no attendance outside an active session — expiry and close both refuse marks', async () => {
    const fx = await createFixture();
    const v = unitVector(4);
    await enrollTestFace(fx.school.id, 'STUDENT', fx.student.id, fx.student.name, v);
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    await closeSession(fx.school.id, session.id, { id: fx.teacher.user.id, name: 'T' });
    await expect(markFace({ schoolId: fx.school.id, sessionId: session.id, embedding: recapture(v) })).rejects.toThrow(/no longer active/i);
  });

  it('a replayed / wrong QR token is refused', async () => {
    const fx = await createFixture();
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    await expect(markQr({ schoolId: fx.school.id, sessionId: session.id, token: 'not-the-real-token', studentId: fx.student.id })).rejects.toThrow(/replayed|invalid/i);
  });

  it('a second active session for the same class is refused', async () => {
    const fx = await createFixture();
    await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    await expect(startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id })).rejects.toThrow(/already has an active/i);
  });

  it('manual override marks present and is auditable', async () => {
    const fx = await createFixture();
    const session = await startSession({ schoolId: fx.school.id, classId: fx.class.id, teacherId: fx.teacher.teacher.id });
    const result = await markManual({ schoolId: fx.school.id, sessionId: session.id, studentId: fx.student.id, actorId: fx.teacher.user.id });
    expect(result.state).toBe('PRESENT');
    expect((await prisma.attendance.findFirst({ where: { studentId: fx.student.id } }))?.source).toBe('MANUAL');
  });
});

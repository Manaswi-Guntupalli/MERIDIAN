import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { recordEvent } from '../eventStore.js';
import { auditLog } from '../trustLedger.js';
import { emitToSchool } from '../../lib/socket.js';
import { getPresenceSettings } from './settings.js';
import type { SessionQrPayload } from './types.js';

type Tx = Prisma.TransactionClient;
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Lazily expire a session whose window has passed. Any PENDING/QR_VERIFIED
 * verification becomes UNVERIFIED_QR — QR alone is never PRESENT. Idempotent:
 * calling it on an already-closed/expired session is a no-op. This is the only
 * place a session leaves ACTIVE by time, so "no attendance outside an active
 * session" holds without a background job.
 */
export async function expireIfDue(sessionId: string): Promise<'EXPIRED' | 'ACTIVE' | 'CLOSED'> {
  const s = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Attendance session not found');
  if (s.status !== 'ACTIVE') return s.status as 'EXPIRED' | 'CLOSED';
  if (s.expiryTime.getTime() > Date.now()) return 'ACTIVE';

  await prisma.$transaction(async (tx) => {
    await tx.attendanceSession.update({ where: { id: s.id }, data: { status: 'EXPIRED', closedAt: new Date() } });
    await tx.attendanceVerification.updateMany({
      where: { sessionId: s.id, state: { in: ['PENDING', 'QR_VERIFIED'] } },
      data: { state: 'UNVERIFIED_QR', reason: 'Session expired before the face was verified' },
    });
    await recordEvent(
      { schoolId: s.schoolId, type: 'ATTENDANCE_SESSION_EXPIRED', aggregate: 'AttendanceSession', aggregateId: s.id, payload: { sessionId: s.id }, reversible: false },
      tx,
    );
  });
  emitToSchool(s.schoolId, 'attendance:session', { id: s.id, status: 'EXPIRED' });
  return 'EXPIRED';
}

/** Load an ACTIVE session, expiring it first if its window has passed. */
export async function loadActiveSession(schoolId: string, sessionId: string) {
  await expireIfDue(sessionId);
  const s = await prisma.attendanceSession.findFirst({ where: { id: sessionId, schoolId } });
  if (!s) throw notFound('Attendance session not found');
  return s;
}

export interface StartSessionInput {
  schoolId: string;
  classId: string;
  teacherId: string;
  subjectId?: string;
  createdBy?: string;
  actorName?: string;
}

/**
 * Open attendance for a class. Refuses a second ACTIVE session for the same
 * class (one live register at a time), seeds a PENDING verification row for
 * every active student in the class, and mints a cryptographically random
 * token. The QR encodes ONLY { sessionId, token }.
 */
export async function startSession(input: StartSessionInput) {
  const cls = await prisma.class.findFirst({ where: { id: input.classId, schoolId: input.schoolId }, include: { students: { where: { active: true } } } });
  if (!cls) throw notFound('Class not found in this school');

  const existing = await prisma.attendanceSession.findFirst({ where: { schoolId: input.schoolId, classId: input.classId, status: 'ACTIVE' } });
  if (existing) {
    if (existing.expiryTime.getTime() > Date.now()) throw badRequest(`${cls.name} already has an active attendance session. Close it before starting another.`);
    await expireIfDue(existing.id);
  }

  const settings = await getPresenceSettings(input.schoolId);
  const now = new Date();
  const token = crypto.randomBytes(24).toString('base64url');

  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.attendanceSession.create({
      data: {
        schoolId: input.schoolId,
        classId: input.classId,
        teacherId: input.teacherId,
        subjectId: input.subjectId,
        date: dateStr(now),
        status: 'ACTIVE',
        startTime: now,
        expiryTime: new Date(now.getTime() + settings.sessionDurationMinutes * 60_000),
        sessionToken: token,
        createdBy: input.createdBy,
      },
    });
    if (cls.students.length) {
      await tx.attendanceVerification.createMany({
        data: cls.students.map((st) => ({ sessionId: s.id, studentId: st.id, state: 'PENDING' })),
      });
    }
    await recordEvent(
      {
        schoolId: input.schoolId,
        type: 'ATTENDANCE_SESSION_STARTED',
        aggregate: 'AttendanceSession',
        aggregateId: s.id,
        payload: { sessionId: s.id, classId: input.classId, className: cls.name, roster: cls.students.length },
        actorId: input.createdBy,
        actorName: input.actorName,
        reversible: false,
      },
      tx,
    );
    return s;
  });

  // Audit + broadcast AFTER commit — auditLog uses the global client, which
  // would deadlock against the interactive transaction's write lock on SQLite.
  await auditLog({ schoolId: input.schoolId, actorId: input.createdBy, action: 'ATTENDANCE_SESSION_STARTED', entity: 'AttendanceSession', entityId: session.id, meta: { classId: input.classId } });
  emitToSchool(input.schoolId, 'attendance:session', { id: session.id, status: 'ACTIVE', classId: input.classId });
  return session;
}

/** Manually close a session early. Same UNVERIFIED_QR sweep as expiry. */
export async function closeSession(schoolId: string, sessionId: string, actor?: { id?: string; name?: string }) {
  const s = await prisma.attendanceSession.findFirst({ where: { id: sessionId, schoolId } });
  if (!s) throw notFound('Attendance session not found');
  if (s.status !== 'ACTIVE') return s;

  const closed = await prisma.$transaction(async (tx) => {
    const updated = await tx.attendanceSession.update({ where: { id: s.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await tx.attendanceVerification.updateMany({
      where: { sessionId: s.id, state: { in: ['PENDING', 'QR_VERIFIED'] } },
      data: { state: 'UNVERIFIED_QR', reason: 'Session closed before the face was verified' },
    });
    await recordEvent(
      { schoolId, type: 'ATTENDANCE_SESSION_CLOSED', aggregate: 'AttendanceSession', aggregateId: s.id, payload: { sessionId: s.id }, actorId: actor?.id, actorName: actor?.name, reversible: false },
      tx,
    );
    return updated;
  });
  await auditLog({ schoolId, actorId: actor?.id, action: 'ATTENDANCE_SESSION_CLOSED', entity: 'AttendanceSession', entityId: s.id });
  emitToSchool(schoolId, 'attendance:session', { id: s.id, status: 'CLOSED' });
  return closed;
}

export function qrPayload(session: { id: string; sessionToken: string }): SessionQrPayload {
  return { sessionId: session.id, token: session.sessionToken };
}

/**
 * Validate a scanned QR against a session, inside the caller's transaction.
 * Throws on any failure — expired, wrong token, wrong session — so a
 * photographed or replayed QR can never mark attendance.
 */
export async function assertValidQr(tx: Tx, schoolId: string, payload: { sessionId: string; token: string }) {
  const s = await tx.attendanceSession.findFirst({ where: { id: payload.sessionId, schoolId } });
  if (!s) throw badRequest('This QR does not match any attendance session.');
  if (s.status !== 'ACTIVE') throw badRequest('This attendance session is no longer active.');
  if (s.expiryTime.getTime() <= Date.now()) throw badRequest('This QR has expired.');
  if (s.sessionToken !== payload.token) throw badRequest('Invalid or replayed QR token.');
  return s;
}

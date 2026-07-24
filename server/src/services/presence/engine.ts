import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { recordEvent } from '../eventStore.js';
import { logAI } from '../trustLedger.js';
import { notify } from '../notifications.js';
import { sendSms, sendEmail, sendPush } from './channels.js';
import { emitToSchool } from '../../lib/socket.js';
import { getPresenceSettings, minutesOfDay } from './settings.js';
import { matchFace, verifyFaceAgainst, MATCH_THRESHOLD } from '../face.js';
import { loadActiveSession } from './session.js';
import type { FaceEvidence, MarkResult, VerificationState } from './types.js';

type Tx = Prisma.TransactionClient;
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// The Attendance Engine — the single place every identity claim (kiosk face,
// student QR, manual mark) converges. It advances ONE AttendanceVerification
// state machine per (session, student) and, on reaching PRESENT, writes the
// AttendanceEvent + materialised daily Attendance + a reversible ATTENDANCE_
// MARKED event, all in one transaction, then fires notifications post-commit.
//
// Face is sufficient (FACE → PRESENT). QR alone is not (QR → PENDING, then
// UNVERIFIED_QR at expiry). QR claiming A while the face is B → PROXY_ATTEMPT:
// no attendance, a security alert, and a FaceEvent for the review queue.
// ─────────────────────────────────────────────────────────────────────────────

interface Deferred {
  emit: () => void;
  post: () => Promise<void>;
}

async function finalizePresent(
  tx: Tx,
  session: { id: string; schoolId: string },
  verificationId: string,
  student: { id: string; name: string; rollNo: number; classId: string | null },
  source: 'FACE' | 'QR' | 'MANUAL',
  now: Date,
  face: FaceEvidence | null,
  actorId?: string,
): Promise<{ result: MarkResult; deferred: Deferred }> {
  const settings = await getPresenceSettings(session.schoolId);
  const threshold = minutesOfDay(settings.schoolStartTime) + settings.lateGraceMinutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const late = nowMinutes > threshold;
  const lateMinutes = late ? nowMinutes - threshold : null;
  const status = late ? 'LATE' : 'VERIFIED';

  await tx.attendanceVerification.update({
    where: { id: verificationId },
    data: {
      state: 'PRESENT',
      markedPresentAt: now,
      ...(face ? { faceVerifiedAt: now, faceConfidence: face.confidence, faceDistance: face.distance, threshold: face.threshold } : {}),
      reason: face ? `Face verified ${(face.confidence * 100).toFixed(0)}%` : source === 'MANUAL' ? 'Marked present by staff' : undefined,
    },
  });

  const proof = face ? `face verified ${(face.confidence * 100).toFixed(0)}%${face.samples ? ` (${face.samples} template${face.samples === 1 ? '' : 's'})` : ''}` : source === 'MANUAL' ? 'manual mark' : null;
  const event = await tx.attendanceEvent.create({
    data: {
      schoolId: session.schoolId,
      studentId: student.id,
      sessionId: session.id,
      verificationId,
      source,
      timestamp: now,
      direction: 'ENTRY',
      verificationStatus: status,
      faceConfidence: face?.confidence,
      faceDistance: face?.distance,
      late,
      lateMinutes,
      createdBy: actorId,
      notes: proof,
    },
  });

  // Materialised daily view — the row every other engine reads.
  const date = dateStr(now);
  const attendance = await tx.attendance.upsert({
    where: { studentId_date: { studentId: student.id, date } },
    create: { schoolId: session.schoolId, studentId: student.id, classId: student.classId!, date, status: late ? 'LATE' : 'PRESENT', source, confidence: face?.confidence, markedById: actorId },
    update: { status: late ? 'LATE' : 'PRESENT', source, confidence: face?.confidence },
  });

  // Reversible: undoing this restores the prior daily status AND resets the
  // verification row (see eventStore reverser for ATTENDANCE_MARKED).
  const recorded = await recordEvent(
    {
      schoolId: session.schoolId,
      type: 'ATTENDANCE_MARKED',
      aggregate: 'Attendance',
      aggregateId: attendance.id,
      payload: { attendanceId: attendance.id, verificationId, eventId: event.id, studentId: student.id, studentName: student.name, source, status, previousStatus: null },
      actorId,
      reversible: true,
    },
    tx,
  );

  const result: MarkResult = {
    state: 'PRESENT',
    studentId: student.id,
    studentName: student.name,
    sessionId: session.id,
    reason: late ? `Present (late, ${lateMinutes} min)` : 'Present',
    face: face ?? undefined,
    eventId: event.id,
  };

  const deferred: Deferred = {
    emit: () => {
      recorded.emit();
      emitToSchool(session.schoolId, 'attendance:verification', { sessionId: session.id, studentId: student.id, state: 'PRESENT', status, confidence: face?.confidence ?? null });
    },
    post: async () => {
      await logAI({
        schoolId: session.schoolId,
        engine: 'PRESENCE',
        action: `${source} attendance — ${status.toLowerCase()}`,
        reason: face ? `Face matched ${student.name} at ${(face.confidence * 100).toFixed(1)}% ≥ ${(face.threshold * 100).toFixed(0)}% threshold (distance ${face.distance.toFixed(3)})` : `${source} attendance recorded`,
        confidence: face?.confidence ?? 1,
        input: { sessionId: session.id, source, threshold: face?.threshold },
        output: { studentId: student.id, status, distance: face?.distance },
        actorId,
      });
      await notifyParents(session.schoolId, student, late, lateMinutes, now);
    },
  };
  return { result, deferred };
}

async function recordProxy(
  tx: Tx,
  session: { id: string; schoolId: string },
  verificationId: string,
  claim: { id: string; name: string },
  face: FaceEvidence,
  now: Date,
): Promise<{ result: MarkResult; deferred: Deferred }> {
  const impostor = face.matchedName && face.matchedSubjectId !== claim.id ? ` — the face matched ${face.matchedName}` : '';
  const reason = `QR claimed ${claim.name}, but the face did not match (similarity ${(face.confidence * 100).toFixed(0)}% < ${(face.threshold * 100).toFixed(0)}%)${impostor}`;

  await tx.attendanceVerification.update({
    where: { id: verificationId },
    data: { state: 'PROXY_ATTEMPT', proxyClaimedStudentId: claim.id, proxyMatchedName: face.matchedName ?? null, faceConfidence: face.confidence, faceDistance: face.distance, threshold: face.threshold, reason },
  });
  const event = await tx.attendanceEvent.create({
    data: { schoolId: session.schoolId, studentId: claim.id, sessionId: session.id, verificationId, source: 'QR', timestamp: now, direction: 'UNKNOWN', verificationStatus: 'PROXY', faceConfidence: face.confidence, faceDistance: face.distance, notes: reason },
  });
  const recorded = await recordEvent(
    { schoolId: session.schoolId, type: 'PROXY_ATTEMPT', aggregate: 'AttendanceVerification', aggregateId: verificationId, payload: { verificationId, eventId: event.id, claimedStudentId: claim.id, claimedName: claim.name, matchedName: face.matchedName, similarity: face.confidence }, reversible: false },
    tx,
  );
  await tx.faceEvent.create({ data: { schoolId: session.schoolId, kind: 'PROXY', confidence: face.confidence, cameraId: 'attendance-session', note: reason } });

  const result: MarkResult = { state: 'PROXY_ATTEMPT', studentId: claim.id, studentName: claim.name, claimedName: claim.name, sessionId: session.id, reason, face };
  const deferred: Deferred = {
    emit: () => {
      recorded.emit();
      emitToSchool(session.schoolId, 'attendance:verification', { sessionId: session.id, studentId: claim.id, state: 'PROXY_ATTEMPT', reason });
    },
    post: async () => {
      await logAI({ schoolId: session.schoolId, engine: 'PRESENCE', action: 'QR attendance — proxy blocked', reason, confidence: face.confidence, input: { sessionId: session.id, claimedStudentId: claim.id }, output: { blocked: true, matchedName: face.matchedName } });
      await notifyAdminsProxy(session.schoolId, reason);
    },
  };
  return { result, deferred };
}

// ── Public entry points ──────────────────────────────────────────────────

export interface FaceMarkInput {
  schoolId: string;
  sessionId: string;
  embedding: number[]; // 512-D descriptor from the face service
  detScore?: number;
  actorId?: string;
}

/**
 * Kiosk face path (PRIMARY). 1:N recognise the descriptor, confirm the person
 * is on THIS session's register, and mark them present. Face is the identity,
 * so this path can't be a proxy — but a face not on the register is reported,
 * not marked.
 */
export async function markFace(input: FaceMarkInput): Promise<MarkResult> {
  if (!Array.isArray(input.embedding) || !input.embedding.length) throw badRequest('markFace requires a face embedding');
  const session = await loadActiveSession(input.schoolId, input.sessionId);
  if (session.status !== 'ACTIVE') throw badRequest('This attendance session is no longer active.');

  const match = await matchFace(input.schoolId, input.embedding, 'STUDENT');
  if (!match.matched || !match.subjectId) {
    await prisma.faceEvent.create({ data: { schoolId: input.schoolId, kind: 'UNKNOWN', confidence: match.confidence, cameraId: 'attendance-session', note: `Unrecognised face in ${session.id} (best ${(match.confidence * 100).toFixed(0)}%)` } });
    return { state: 'ABSENT', studentId: '', studentName: 'Unknown', sessionId: session.id, reason: `No confident match (best ${(match.confidence * 100).toFixed(0)}% < ${(MATCH_THRESHOLD * 100).toFixed(0)}%)` };
  }

  const face: FaceEvidence = { confidence: match.confidence, distance: Math.round((1 - match.confidence) * 1000) / 1000, threshold: MATCH_THRESHOLD, matchedName: match.name, matchedSubjectId: match.subjectId };
  const outcome = await prisma.$transaction(async (tx) => {
    const verification = await tx.attendanceVerification.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: match.subjectId! } }, include: { student: true } });
    if (!verification) {
      // Recognised, but not a student on this class's register.
      return { skip: true as const, name: match.name };
    }
    if (verification.state === 'PRESENT') {
      return { already: true as const, name: verification.student.name };
    }
    const { result, deferred } = await finalizePresent(tx, session, verification.id, verification.student, 'FACE', new Date(), face, input.actorId);
    return { result, deferred };
  });

  if ('skip' in outcome) return { state: 'ABSENT', studentId: match.subjectId ?? "", studentName: match.name ?? 'Unknown', sessionId: session.id, reason: `${match.name} is recognised but not on this class's register` };
  if ('already' in outcome) return { state: 'PRESENT', studentId: match.subjectId ?? "", studentName: outcome.name ?? "Student", sessionId: session.id, reason: 'Already marked present' };
  outcome.deferred.emit();
  await outcome.deferred.post();
  return outcome.result;
}

export interface QrMarkInput {
  schoolId: string;
  sessionId: string;
  token: string;
  studentId: string; // resolved from the student's JWT (or provided by the simulator)
  embedding?: number[]; // face captured alongside the QR scan (phone front camera)
  actorId?: string;
}

/**
 * QR path (VERIFICATION / fallback). Validates the session token, confirms the
 * claiming student is on the register, and:
 *   · face provided & verifies (1:1) → PRESENT (both factors)
 *   · face provided & fails         → PROXY_ATTEMPT (claimed A, face is B)
 *   · no face                       → QR_VERIFIED (PENDING until expiry, then
 *                                     UNVERIFIED_QR — QR alone is never present)
 */
export async function markQr(input: QrMarkInput): Promise<MarkResult> {
  const session = await loadActiveSession(input.schoolId, input.sessionId);
  if (session.status !== 'ACTIVE') throw badRequest('This attendance session is no longer active.');
  if (session.sessionToken !== input.token) throw badRequest('Invalid or replayed QR token.');
  if (session.expiryTime.getTime() <= Date.now()) throw badRequest('This QR has expired.');

  // 1:1 verify (if a face came with the scan) — done outside the tx (read-only).
  let face: FaceEvidence | null = null;
  if (input.embedding?.length) {
    const v = await verifyFaceAgainst(input.schoolId, 'STUDENT', input.studentId, input.embedding);
    if (v.samples > 0) {
      face = { confidence: v.similarity, distance: Math.round((1 - v.similarity) * 1000) / 1000, threshold: v.threshold, samples: v.samples };
      if (v.similarity < v.threshold) {
        // Who is it actually? (1:N, for an honest proxy reason.)
        const who = await matchFace(input.schoolId, input.embedding, 'STUDENT');
        face.matchedName = who.matched ? who.name : null;
        face.matchedSubjectId = who.matched ? who.subjectId : null;
      }
    }
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const verification = await tx.attendanceVerification.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } }, include: { student: true } });
    if (!verification) throw badRequest('You are not on this class\'s attendance register.');
    const student = verification.student;
    if (verification.state === 'PRESENT') return { already: true as const, name: student.name };

    // Face present but does NOT match the claiming student → proxy.
    if (face && face.confidence < face.threshold) {
      return await recordProxy(tx, session, verification.id, { id: student.id, name: student.name }, face, new Date());
    }
    // Face present and verifies → both factors → present.
    if (face && face.confidence >= face.threshold) {
      return await finalizePresent(tx, session, verification.id, student, 'QR', new Date(), face, input.actorId);
    }
    // QR only → verified but pending the face.
    await tx.attendanceVerification.update({ where: { id: verification.id }, data: { state: 'QR_VERIFIED', qrVerifiedAt: new Date(), reason: 'QR verified — awaiting face' } });
    await recordEvent({ schoolId: session.schoolId, type: 'QR_VERIFIED', aggregate: 'AttendanceVerification', aggregateId: verification.id, payload: { verificationId: verification.id, studentId: student.id }, actorId: input.actorId, reversible: false }, tx);
    return {
      pending: true as const,
      result: { state: 'QR_VERIFIED' as VerificationState, studentId: student.id, studentName: student.name, sessionId: session.id, reason: 'QR verified — show your face to complete attendance' },
    };
  });

  if ('already' in outcome) return { state: 'PRESENT', studentId: input.studentId, studentName: outcome.name ?? "Student", sessionId: session.id, reason: 'Already marked present' };
  if ('pending' in outcome) {
    emitToSchool(session.schoolId, 'attendance:verification', { sessionId: session.id, studentId: input.studentId, state: 'QR_VERIFIED' });
    return outcome.result;
  }
  outcome.deferred.emit();
  await outcome.deferred.post();
  return outcome.result;
}

export interface ManualMarkInput {
  schoolId: string;
  sessionId: string;
  studentId: string;
  actorId?: string;
}

/** Staff override — a teacher marks a student present by hand (audited). */
export async function markManual(input: ManualMarkInput): Promise<MarkResult> {
  const session = await loadActiveSession(input.schoolId, input.sessionId);
  if (session.status !== 'ACTIVE') throw badRequest('This attendance session is no longer active.');
  const outcome = await prisma.$transaction(async (tx) => {
    const verification = await tx.attendanceVerification.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } }, include: { student: true } });
    if (!verification) throw badRequest('That student is not on this class\'s register.');
    if (verification.state === 'PRESENT') return { already: true as const, name: verification.student.name };
    return await finalizePresent(tx, session, verification.id, verification.student, 'MANUAL', new Date(), null, input.actorId);
  });
  if ('already' in outcome) return { state: 'PRESENT', studentId: input.studentId, studentName: outcome.name ?? "Student", sessionId: session.id, reason: 'Already marked present' };
  outcome.deferred.emit();
  await outcome.deferred.post();
  return outcome.result;
}

// ── notifications ──────────────────────────────────────────────────────────

async function notifyParents(schoolId: string, student: { id: string; name: string }, late: boolean, lateMinutes: number | null, now: Date) {
  const links = await prisma.studentParent.findMany({ where: { studentId: student.id }, include: { parent: { include: { user: true } } } });
  const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const lateNote = late ? ` (${lateMinutes} min late)` : '';
  const body = `${student.name} was marked present at ${timeLabel}${lateNote}.`;
  for (const link of links) {
    await notify({ schoolId, userId: link.parent.userId, title: `${student.name} is present`, body, severity: late ? 'WARNING' : 'SUCCESS', category: 'ATTENDANCE' });
    const contact = link.parent.user;
    if (contact.phone) await sendSms({ schoolId, to: contact.phone, title: `${student.name} is present`, body });
    if (contact.email) await sendEmail({ schoolId, to: contact.email, title: `${student.name} is present`, body });
    await sendPush({ schoolId, to: contact.id, title: `${student.name} is present`, body });
  }
}

async function notifyAdminsProxy(schoolId: string, reason: string) {
  const admins = await prisma.user.findMany({ where: { schoolId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'] }, active: true } });
  for (const admin of admins) {
    await notify({
      schoolId,
      userId: admin.id,
      title: 'Possible proxy attendance blocked',
      body: `${reason}. No attendance was recorded.`,
      severity: 'CRITICAL',
      category: 'SECURITY',
      action: { href: '/presence/activity?status=PROXY' },
    });
  }
}

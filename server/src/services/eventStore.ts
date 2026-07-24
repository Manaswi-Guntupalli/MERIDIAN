import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { toJson, fromJson } from '../lib/json.js';
import { emitToSchool } from '../lib/socket.js';

export interface RecordEventInput {
  schoolId: string;
  type: string;
  aggregate: string;
  aggregateId: string;
  payload: unknown;
  actorId?: string;
  actorName?: string;
  reversible?: boolean;
}

/**
 * Append an immutable event to the store (the single source of truth) and
 * broadcast it in realtime. Every meaningful state change flows through here,
 * which is what powers Time Machine, audit and undo.
 *
 * Pass `tx` to append the event INSIDE the caller's transaction. This is how
 * a state change and its undo-event become atomic: either the record exists
 * with its event, or neither does. (A commit that mutates first and records
 * the event in a separate write can crash in between — leaving a record the
 * Trust ledger doesn't know how to undo.) When `tx` is given the socket
 * broadcast is deferred and returned as `emit` — firing it before the
 * transaction commits would announce an event that might yet roll back, so
 * the caller invokes it after the transaction succeeds.
 */
export async function recordEvent(input: RecordEventInput, tx?: Tx) {
  // HONESTY RULE: an event is only advertised as reversible when a reverser
  // actually exists for its type. Previously everything defaulted to true and
  // "undo" silently no-op'd — a trust product must never claim a rollback it
  // cannot perform. Callers may force `false`, but never force `true`.
  const reversible = input.reversible === false ? false : canReverse(input.type);

  const event = await (tx ?? prisma).event.create({
    data: {
      schoolId: input.schoolId,
      type: input.type,
      aggregate: input.aggregate,
      aggregateId: input.aggregateId,
      payloadString: toJson(input.payload),
      actorId: input.actorId,
      actorName: input.actorName,
      reversible,
    },
  });
  const emit = () => emitToSchool(input.schoolId, 'event:new', serializeEvent(event));
  if (!tx) emit();
  return Object.assign(event, { emit });
}

export function serializeEvent(e: {
  id: string;
  type: string;
  aggregate: string;
  aggregateId: string;
  payloadString: string;
  actorId: string | null;
  actorName: string | null;
  reversible: boolean;
  reverted: boolean;
  createdAt: Date;
}) {
  return {
    id: e.id,
    type: e.type,
    aggregate: e.aggregate,
    aggregateId: e.aggregateId,
    payload: fromJson(e.payloadString, {}),
    actorId: e.actorId,
    actorName: e.actorName,
    reversible: e.reversible,
    reverted: e.reverted,
    createdAt: e.createdAt,
  };
}

export async function listEvents(schoolId: string, opts: { limit?: number; until?: string } = {}) {
  const where: Record<string, unknown> = { schoolId };
  if (opts.until) where.createdAt = { lte: new Date(opts.until) };
  const events = await prisma.event.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
  });
  return events.map(serializeEvent);
}

// ── Reversal handlers: how to undo a given event type ──────────────────
// The single source of truth for what "reversible" means. If a type is not in
// this map, it is NOT reversible and we say so honestly in the API/UI.
// Reversers receive the transaction client so the state change and the ledger
// write commit atomically (using the global client here would deadlock against
// the transaction's own lock).
type Tx = Prisma.TransactionClient;
type Reverser = (payload: any, tx: Tx) => Promise<void>;

export function canReverse(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(reversers, type);
}

const reversers: Record<string, Reverser> = {
  ATTENDANCE_MARKED: async (p, tx) => {
    if (p.previousStatus) {
      await tx.attendance.update({
        where: { id: p.attendanceId },
        data: { status: p.previousStatus, source: p.previousSource ?? 'MANUAL' },
      });
    } else if (p.attendanceId) {
      await tx.attendance.delete({ where: { id: p.attendanceId } }).catch(() => {});
    }
    // Session-based marks also reset their verification row so the student can
    // be re-marked in the same session after an accidental undo.
    if (p.verificationId) {
      await tx.attendanceVerification
        .update({ where: { id: p.verificationId }, data: { state: 'PENDING', markedPresentAt: null, reason: 'Attendance undone' } })
        .catch(() => {});
    }
  },
  FEE_PAYMENT_RECORDED: async (p, tx) => {
    if (p.paymentId) await tx.payment.delete({ where: { id: p.paymentId } }).catch(() => {});
    if (p.feeId && typeof p.amount === 'number') {
      const fee = await tx.fee.findUnique({ where: { id: p.feeId } });
      if (fee) {
        const paid = Math.max(0, fee.paid - p.amount);
        await tx.fee.update({
          where: { id: fee.id },
          data: { paid, status: paid <= 0 ? 'PENDING' : paid >= fee.amount ? 'PAID' : 'PARTIAL' },
        });
      }
    }
  },
  STUDENT_CREATED: async (p, tx) => {
    if (p.studentId) await tx.student.delete({ where: { id: p.studentId } }).catch(() => {});
  },
  // Undoing a Lumen commit deletes the record it created and reopens the
  // document as VERIFIED, so it can be corrected and committed again. For a
  // teacher this also removes the login that came with the record — leaving an
  // orphaned account behind would be a security hole, not an undo.
  DOCUMENT_COMMITTED: async (p, tx) => {
    if (p.kind === 'STUDENT' && p.refId) {
      // Unlink guardians first — a StudentParent row would make the student
      // delete fail its FK check, and the old `.catch(() => {})` would have
      // swallowed that failure into a silent non-undo.
      await tx.studentParent.deleteMany({ where: { studentId: p.refId } });
      await tx.student.delete({ where: { id: p.refId } }).catch(() => {});
      // The student's own login account, if this commit created one.
      if (p.createdStudentUserId) {
        await tx.user.delete({ where: { id: p.createdStudentUserId } }).catch(() => {});
      }
      // If the commit created a parent portal account, it goes too — but only
      // when this student was its sole reason to exist. A parent linked to
      // another child (the sibling case) keeps their account.
      if (p.createdParentId) {
        const remaining = await tx.studentParent.count({ where: { parentId: p.createdParentId } });
        if (remaining === 0) {
          const parent = await tx.parent.findUnique({ where: { id: p.createdParentId }, select: { userId: true } });
          await tx.parent.delete({ where: { id: p.createdParentId } }).catch(() => {});
          if (parent?.userId) await tx.user.delete({ where: { id: parent.userId } }).catch(() => {});
        }
      }
    } else if (p.kind === 'TEACHER' && p.refId) {
      const teacher = await tx.teacher.findUnique({ where: { id: p.refId }, select: { userId: true } });
      await tx.teacher.delete({ where: { id: p.refId } }).catch(() => {});
      if (teacher?.userId) await tx.user.delete({ where: { id: teacher.userId } }).catch(() => {});
    }
    if (p.documentId) {
      await tx.document
        .update({
          where: { id: p.documentId },
          data: { status: 'VERIFIED', committedAt: null, committedKind: null, committedRefId: null },
        })
        .catch(() => {});
      await tx.documentActivity.create({
        data: { documentId: p.documentId, kind: 'COMMIT_UNDONE', detailString: JSON.stringify({ kind: p.kind }) },
      }).catch(() => {});
    }
  },
  DOCUMENT_VERIFIED: async (p, tx) => {
    if (p.documentId)
      await tx.document.update({ where: { id: p.documentId }, data: { status: 'REVIEW' } }).catch(() => {});
  },
  // Undoing an absence cascade restores the original timetable state: the
  // substitutions and the absence row are removed atomically. Notifications
  // already sent are NOT pretended away — the staff route sends an explicit
  // correction notice after the state is restored.
  STAFF_ABSENCE_CASCADE: async (p, tx) => {
    if (!p.absenceId) return;
    await tx.substitution.deleteMany({ where: { absenceId: p.absenceId } });
    await tx.staffAbsence.delete({ where: { id: p.absenceId } }).catch(() => {});
  },
  // Undoing an enrollment genuinely erases the biometric templates — which is
  // also the data-protection "right to erasure" path for a parent opt-out.
  FACE_ENROLLED: async (p, tx) => {
    if (!p.subjectId || !p.subjectType) return;
    await tx.faceEmbedding.deleteMany({ where: { subjectId: p.subjectId } });
    if (p.subjectType === 'STUDENT') {
      await tx.student.update({ where: { id: p.subjectId }, data: { faceEnrolled: false, faceCount: 0 } }).catch(() => {});
    } else {
      await tx.teacher.update({ where: { id: p.subjectId }, data: { faceEnrolled: false, faceCount: 0 } }).catch(() => {});
    }
  },
};

/**
 * Undo a reversible event. Applies the inverse operation to the materialized
 * state, marks the event reverted, and records a compensating event so the
 * ledger itself stays append-only and honest.
 */
export async function undoEvent(schoolId: string, eventId: string, actor?: { id: string; name: string }) {
  const event = await prisma.event.findFirst({ where: { id: eventId, schoolId } });
  if (!event) throw new Error('Event not found');
  if (event.reverted) throw new Error('Event already reverted');
  if (!event.reversible) throw new Error('Event is not reversible');

  const reverser = reversers[event.type];
  // Never mark something reverted that we cannot actually reverse.
  if (!reverser) throw new Error(`No reversal handler for event type ${event.type}`);

  const payload = fromJson<any>(event.payloadString, {});

  // The state change and the ledger update must both land, or neither.
  await prisma.$transaction(async (tx) => {
    await reverser(payload, tx);
    await tx.event.update({ where: { id: event.id }, data: { reverted: true } });
  });

  await recordEvent({
    schoolId,
    type: 'EVENT_REVERTED',
    aggregate: event.aggregate,
    aggregateId: event.aggregateId,
    payload: { revertedEventId: event.id, originalType: event.type },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });

  return { reverted: event.id };
}

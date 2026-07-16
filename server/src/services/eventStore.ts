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
 */
export async function recordEvent(input: RecordEventInput) {
  const event = await prisma.event.create({
    data: {
      schoolId: input.schoolId,
      type: input.type,
      aggregate: input.aggregate,
      aggregateId: input.aggregateId,
      payloadString: toJson(input.payload),
      actorId: input.actorId,
      actorName: input.actorName,
      reversible: input.reversible ?? true,
    },
  });
  emitToSchool(input.schoolId, 'event:new', serializeEvent(event));
  return event;
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
type Reverser = (payload: any) => Promise<void>;

const reversers: Record<string, Reverser> = {
  ATTENDANCE_MARKED: async (p) => {
    if (p.previousStatus) {
      await prisma.attendance.update({
        where: { id: p.attendanceId },
        data: { status: p.previousStatus, source: p.previousSource ?? 'MANUAL' },
      });
    } else if (p.attendanceId) {
      await prisma.attendance.delete({ where: { id: p.attendanceId } }).catch(() => {});
    }
  },
  FEE_PAYMENT_RECORDED: async (p) => {
    if (p.paymentId) await prisma.payment.delete({ where: { id: p.paymentId } }).catch(() => {});
    if (p.feeId && typeof p.amount === 'number') {
      const fee = await prisma.fee.findUnique({ where: { id: p.feeId } });
      if (fee) {
        const paid = Math.max(0, fee.paid - p.amount);
        await prisma.fee.update({
          where: { id: fee.id },
          data: { paid, status: paid <= 0 ? 'PENDING' : paid >= fee.amount ? 'PAID' : 'PARTIAL' },
        });
      }
    }
  },
  STUDENT_CREATED: async (p) => {
    if (p.studentId) await prisma.student.delete({ where: { id: p.studentId } }).catch(() => {});
  },
  DOCUMENT_VERIFIED: async (p) => {
    if (p.documentId)
      await prisma.document.update({ where: { id: p.documentId }, data: { status: 'REVIEW' } }).catch(() => {});
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

  const payload = fromJson<any>(event.payloadString, {});
  const reverser = reversers[event.type];
  if (reverser) await reverser(payload);

  await prisma.event.update({ where: { id: event.id }, data: { reverted: true } });

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

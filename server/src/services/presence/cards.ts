import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { recordEvent } from '../eventStore.js';
import { auditLog } from '../trustLedger.js';

export interface CardActor {
  id: string;
  name: string;
}

// Unique-constraint violation on (schoolId, uid) → a friendly 409 instead of
// a raw Prisma error. This IS the "duplicate UID detection" the admin sees.
async function createCard(data: Prisma.RFIDCardUncheckedCreateInput) {
  try {
    return await prisma.rFIDCard.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw badRequest(`Card UID "${data.uid}" is already registered to another student in this school.`);
    }
    throw err;
  }
}

export async function issueCard(input: { schoolId: string; studentId: string; uid: string }, actor?: CardActor) {
  const { schoolId, studentId, uid } = input;
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound('Student not found in your school');

  const existingActive = await prisma.rFIDCard.findFirst({ where: { schoolId, studentId, status: 'ACTIVE' } });
  if (existingActive) {
    throw badRequest('Student already has an active card. Replace or disable it before issuing a new one.');
  }

  const card = await createCard({ schoolId, studentId, uid: uid.trim(), status: 'ACTIVE' });

  await recordEvent({
    schoolId,
    type: 'RFID_CARD_ISSUED',
    aggregate: 'RFIDCard',
    aggregateId: card.id,
    payload: { cardId: card.id, studentId, uid: card.uid, studentName: student.name },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });
  await auditLog({ schoolId, actorId: actor?.id, action: 'RFID_CARD_ISSUED', entity: 'RFIDCard', entityId: card.id, meta: { studentId, uid: card.uid } });

  return card;
}

async function requireCard(schoolId: string, cardId: string) {
  const card = await prisma.rFIDCard.findFirst({ where: { id: cardId, schoolId } });
  if (!card) throw notFound('Card not found in your school');
  return card;
}

async function transitionCard(
  schoolId: string,
  cardId: string,
  status: 'DISABLED' | 'LOST' | 'BROKEN',
  eventType: string,
  actor: CardActor | undefined,
) {
  const card = await requireCard(schoolId, cardId);
  if (card.status !== 'ACTIVE') throw badRequest(`Card is already ${card.status.toLowerCase()}.`);

  const updated = await prisma.rFIDCard.update({
    where: { id: card.id },
    data: { status, deactivatedAt: new Date() },
  });

  await recordEvent({
    schoolId,
    type: eventType,
    aggregate: 'RFIDCard',
    aggregateId: card.id,
    payload: { cardId: card.id, studentId: card.studentId, uid: card.uid, previousStatus: card.status },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });
  await auditLog({ schoolId, actorId: actor?.id, action: eventType, entity: 'RFIDCard', entityId: card.id, meta: { uid: card.uid } });

  return updated;
}

export const disableCard = (schoolId: string, cardId: string, actor?: CardActor) =>
  transitionCard(schoolId, cardId, 'DISABLED', 'RFID_CARD_DISABLED', actor);

export const reportLost = (schoolId: string, cardId: string, actor?: CardActor) =>
  transitionCard(schoolId, cardId, 'LOST', 'RFID_CARD_LOST', actor);

export const reportBroken = (schoolId: string, cardId: string, actor?: CardActor) =>
  transitionCard(schoolId, cardId, 'BROKEN', 'RFID_CARD_BROKEN', actor);

// Reissue: bring a DISABLED/LOST/BROKEN card back to ACTIVE — only valid if
// the student currently has no other active card.
export async function reissueCard(schoolId: string, cardId: string, actor?: CardActor) {
  const card = await requireCard(schoolId, cardId);
  if (card.status === 'ACTIVE') throw badRequest('Card is already active.');
  if (card.status === 'REPLACED') throw badRequest('A replaced card cannot be reissued — issue a new card instead.');

  const existingActive = await prisma.rFIDCard.findFirst({ where: { schoolId, studentId: card.studentId, status: 'ACTIVE' } });
  if (existingActive) throw badRequest('Student already has an active card.');

  const updated = await prisma.rFIDCard.update({ where: { id: card.id }, data: { status: 'ACTIVE', deactivatedAt: null } });

  await recordEvent({
    schoolId,
    type: 'RFID_CARD_REISSUED',
    aggregate: 'RFIDCard',
    aggregateId: card.id,
    payload: { cardId: card.id, studentId: card.studentId, uid: card.uid, previousStatus: card.status },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });
  await auditLog({ schoolId, actorId: actor?.id, action: 'RFID_CARD_REISSUED', entity: 'RFIDCard', entityId: card.id, meta: { uid: card.uid } });

  return updated;
}

// Replace: retires the old card (REPLACED) and issues a fresh one to the
// same student, linked via replacedByCardId — the full card-history chain.
export async function replaceCard(schoolId: string, oldCardId: string, newUid: string, actor?: CardActor) {
  const oldCard = await requireCard(schoolId, oldCardId);
  if (oldCard.status === 'REPLACED') throw badRequest('Card has already been replaced.');

  const newCard = await createCard({ schoolId, studentId: oldCard.studentId, uid: newUid.trim(), status: 'ACTIVE' });
  const updatedOld = await prisma.rFIDCard.update({
    where: { id: oldCard.id },
    data: { status: 'REPLACED', deactivatedAt: new Date(), replacedByCardId: newCard.id },
  });

  await recordEvent({
    schoolId,
    type: 'RFID_CARD_REPLACED',
    aggregate: 'RFIDCard',
    aggregateId: newCard.id,
    payload: { oldCardId: oldCard.id, newCardId: newCard.id, studentId: oldCard.studentId, oldUid: oldCard.uid, newUid: newCard.uid },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });
  await auditLog({
    schoolId,
    actorId: actor?.id,
    action: 'RFID_CARD_REPLACED',
    entity: 'RFIDCard',
    entityId: newCard.id,
    meta: { oldCardId: oldCard.id, oldUid: oldCard.uid, newUid: newCard.uid },
  });

  return { oldCard: updatedOld, newCard };
}

export async function listCards(schoolId: string, opts: { studentId?: string; status?: string } = {}) {
  return prisma.rFIDCard.findMany({
    where: { schoolId, ...(opts.studentId ? { studentId: opts.studentId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    include: { student: { select: { id: true, name: true, rollNo: true, classId: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function cardHistory(schoolId: string, studentId: string) {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound('Student not found in your school');
  const cards = await prisma.rFIDCard.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: 'asc' } });
  return { student: { id: student.id, name: student.name, rollNo: student.rollNo }, cards };
}

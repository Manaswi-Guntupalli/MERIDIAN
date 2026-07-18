import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { recordEvent } from '../eventStore.js';
import { logAI } from '../trustLedger.js';
import { notify } from '../notifications.js';
import { sendSms, sendEmail, sendPush } from './channels.js';
import { emitToSchool } from '../../lib/socket.js';
import { getPresenceSettings, minutesOfDay } from './settings.js';
import type { AttendanceSource, Direction, ScanInput, ScanResult, VerificationStatus } from './types.js';

type Tx = Prisma.TransactionClient;
type ReaderRow = { id: string; name: string; location: string; direction: string; online: boolean } | null;

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

// Internal shape carried out of the transaction: the public ScanResult plus
// the bits (deferred socket emit, reader row, CV confidence) only needed for
// post-commit side effects (notify/emit/log), never returned to the caller.
interface EngineOutcome extends ScanResult {
  _emit: () => void;
  _reader: ReaderRow;
  _confidence?: number;
}

/**
 * The Presence Engine — the single place every attendance-producing source
 * (RFID reader, RFID simulator, QR kiosk, manual mark, face-recognition
 * match) converges. Validates, decides duplicate/late/direction, and writes
 * the AttendanceEvent + materialized Attendance row in one transaction, per
 * the "everything happens inside one transaction" requirement.
 *
 * Every lookup below runs inside the same transaction as the writes, so two
 * near-simultaneous taps of the same card can't both read "no recent event"
 * and both slip past the duplicate check.
 *
 * "Card assigned" (spec's validation step) is enforced structurally —
 * RFIDCard.studentId is a required column, so a card cannot exist unassigned.
 */
export async function processScan(input: ScanInput): Promise<ScanResult> {
  const { schoolId, source } = input;
  const now = input.simulateAt ?? new Date();

  if ((source === 'RFID' || source === 'QR') && (!input.readerId || !input.cardUid)) {
    throw badRequest(`${source} scans require both readerId and cardUid`);
  }
  if ((source === 'MANUAL' || source === 'CV') && !input.studentId) {
    throw badRequest(`${source} attendance requires studentId`);
  }

  const settings = await getPresenceSettings(schoolId);

  const outcome = await prisma.$transaction(async (tx): Promise<EngineOutcome> => {
    let reader: ReaderRow = null;
    if (input.readerId) {
      const row = await tx.rFIDReader.findFirst({ where: { id: input.readerId, schoolId } });
      if (!row) throw badRequest('Unknown reader'); // malformed request — nothing written
      reader = row;
      if ((source === 'RFID' || source === 'QR') && !row.online) {
        return writeOutcome(tx, { schoolId, source, readerId: row.id, verificationStatus: 'REJECTED', reason: 'Reader is offline', timestamp: now });
      }
    }

    let card: { id: string; status: string; studentId: string } | null = null;
    let studentId = input.studentId ?? null;

    if (source === 'RFID' || source === 'QR') {
      card = await tx.rFIDCard.findFirst({ where: { schoolId, uid: input.cardUid! } });
      if (!card) {
        return writeOutcome(tx, {
          schoolId,
          source,
          readerId: reader!.id,
          verificationStatus: 'UNKNOWN',
          reason: `Unrecognized card UID "${input.cardUid}"`,
          timestamp: now,
          notes: input.cardUid,
        });
      }
      if (card.status !== 'ACTIVE') {
        return writeOutcome(tx, {
          schoolId,
          source,
          readerId: reader!.id,
          cardId: card.id,
          studentId: card.studentId,
          verificationStatus: 'REJECTED',
          reason: `Card is ${card.status.toLowerCase()}`,
          timestamp: now,
        });
      }
      studentId = card.studentId;
    }

    const student = studentId ? await tx.student.findFirst({ where: { id: studentId, schoolId } }) : null;
    if (!student) {
      return writeOutcome(tx, { schoolId, source, readerId: reader?.id, cardId: card?.id, verificationStatus: 'REJECTED', reason: 'Student not found in this school', timestamp: now });
    }
    if (!student.active) {
      return writeOutcome(tx, { schoolId, source, readerId: reader?.id, cardId: card?.id, studentId: student.id, verificationStatus: 'REJECTED', reason: 'Student is not active', timestamp: now });
    }
    if (!student.classId) {
      return writeOutcome(tx, { schoolId, source, readerId: reader?.id, cardId: card?.id, studentId: student.id, verificationStatus: 'REJECTED', reason: 'Student has no class assigned', timestamp: now });
    }

    // Duplicate protection — a MANUAL correction is always an intentional
    // staff decision, never an accidental double-tap, so it skips this
    // window entirely. RFID/QR/CV all share the same check.
    if (source !== 'MANUAL') {
      const windowStart = new Date(now.getTime() - settings.duplicateWindowSeconds * 1000);
      const recent = await tx.attendanceEvent.findFirst({
        where: { schoolId, studentId: student.id, verificationStatus: { in: ['VERIFIED', 'LATE'] }, timestamp: { gte: windowStart, lte: now } },
        orderBy: { timestamp: 'desc' },
      });
      if (recent) {
        return writeOutcome(tx, {
          schoolId,
          source,
          readerId: reader?.id,
          cardId: card?.id,
          studentId: student.id,
          verificationStatus: 'DUPLICATE',
          reason: `Already scanned ${Math.round((now.getTime() - recent.timestamp.getTime()) / 1000)}s ago`,
          timestamp: now,
        });
      }
    }

    // Direction: explicit override (constrained by a one-way reader), a
    // fixed-direction reader, or inferred from today's last verified event.
    let direction: Direction;
    if (input.direction) {
      if (reader && reader.direction !== 'BOTH' && reader.direction !== input.direction) {
        return writeOutcome(tx, {
          schoolId,
          source,
          readerId: reader.id,
          cardId: card?.id,
          studentId: student.id,
          verificationStatus: 'REJECTED',
          reason: `This reader is configured for ${reader.direction} only`,
          timestamp: now,
        });
      }
      direction = input.direction;
    } else if (reader && reader.direction !== 'BOTH') {
      direction = reader.direction as Direction;
    } else {
      const today = dateStr(now);
      const last = await tx.attendanceEvent.findFirst({
        where: { schoolId, studentId: student.id, verificationStatus: { in: ['VERIFIED', 'LATE'] }, timestamp: { gte: new Date(`${today}T00:00:00`) } },
        orderBy: { timestamp: 'desc' },
      });
      direction = !last ? 'ENTRY' : last.direction === 'EXIT' ? 'REENTRY' : 'EXIT';
    }

    // Late policy applies only to the day's opening entry.
    let late = false;
    let lateMinutes: number | null = null;
    if (direction === 'ENTRY') {
      const threshold = minutesOfDay(settings.schoolStartTime) + settings.lateGraceMinutes;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes > threshold) {
        late = true;
        lateMinutes = nowMinutes - threshold;
      }
    }

    const verificationStatus: VerificationStatus = late ? 'LATE' : 'VERIFIED';

    const event = await tx.attendanceEvent.create({
      data: {
        schoolId,
        studentId: student.id,
        cardId: card?.id,
        readerId: reader?.id,
        source,
        timestamp: now,
        direction,
        verificationStatus,
        late,
        lateMinutes,
        createdBy: input.createdBy,
        notes: input.notes,
      },
    });

    // Materialized daily view — only entry-shaped directions mark presence;
    // an EXIT never un-marks a day already recorded present.
    let attendanceId: string | undefined;
    if (direction === 'ENTRY' || direction === 'REENTRY') {
      const date = dateStr(now);
      const attendanceRecord = await tx.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date } },
        create: {
          schoolId,
          studentId: student.id,
          classId: student.classId,
          date,
          status: late ? 'LATE' : 'PRESENT',
          source,
          confidence: input.confidence,
          markedById: input.createdBy,
        },
        update: { status: late ? 'LATE' : 'PRESENT', source, confidence: input.confidence },
      });
      attendanceId = attendanceRecord.id;
    }

    const recorded = await recordEvent(
      {
        schoolId,
        type: 'ATTENDANCE_EVENT_RECORDED',
        aggregate: 'AttendanceEvent',
        aggregateId: event.id,
        payload: { eventId: event.id, studentId: student.id, studentName: student.name, source, direction, verificationStatus, late, lateMinutes, attendanceId },
        actorId: input.createdBy,
        actorName: reader ? `${reader.name} (${source})` : undefined,
        reversible: false,
      },
      tx,
    );

    return {
      status: verificationStatus,
      eventId: event.id,
      direction,
      late,
      lateMinutes,
      timestamp: event.timestamp,
      student: { id: student.id, name: student.name, rollNo: student.rollNo },
      _emit: recorded.emit,
      _reader: reader,
      _confidence: input.confidence,
    };
  });

  const { _emit, _reader, _confidence, ...scanResult } = outcome;
  _emit();

  emitToSchool(schoolId, 'presence:event', { ...scanResult, readerName: _reader?.name, readerLocation: _reader?.location });

  await logAI({
    schoolId,
    engine: 'PRESENCE',
    action: `${source} ${scanResult.direction.toLowerCase()} — ${scanResult.status.toLowerCase()}`,
    reason: scanResult.reason ?? `${source} scan resolved and recorded`,
    confidence: source === 'CV' ? _confidence ?? 0.9 : 1,
    input: { source, readerId: input.readerId, cardUid: input.cardUid },
    output: { studentId: scanResult.student?.id, status: scanResult.status, direction: scanResult.direction },
    actorId: input.createdBy,
  });

  if (scanResult.status === 'VERIFIED' || scanResult.status === 'LATE') {
    await notifyParents(schoolId, scanResult, _reader);
  } else if (scanResult.status === 'UNKNOWN') {
    await notifyAdminsUnknownCard(schoolId, _reader, scanResult.reason);
  }

  return scanResult;
}

// Writes a non-success outcome (REJECTED / UNKNOWN / DUPLICATE) as its own
// AttendanceEvent row — "audit every action" means rejections stay visible
// to admins instead of being silently dropped.
async function writeOutcome(
  tx: Tx,
  args: {
    schoolId: string;
    source: AttendanceSource;
    readerId?: string;
    cardId?: string;
    studentId?: string | null;
    verificationStatus: 'REJECTED' | 'UNKNOWN' | 'DUPLICATE';
    reason: string;
    timestamp: Date;
    notes?: string;
  },
): Promise<EngineOutcome> {
  const event = await tx.attendanceEvent.create({
    data: {
      schoolId: args.schoolId,
      studentId: args.studentId ?? undefined,
      cardId: args.cardId,
      readerId: args.readerId,
      source: args.source,
      timestamp: args.timestamp,
      direction: 'UNKNOWN',
      verificationStatus: args.verificationStatus,
      notes: args.notes ?? args.reason,
    },
  });

  const student = args.studentId ? await tx.student.findFirst({ where: { id: args.studentId, schoolId: args.schoolId } }) : null;
  const reader = args.readerId ? await tx.rFIDReader.findFirst({ where: { id: args.readerId } }) : null;

  const recorded = await recordEvent(
    {
      schoolId: args.schoolId,
      type: 'ATTENDANCE_EVENT_RECORDED',
      aggregate: 'AttendanceEvent',
      aggregateId: event.id,
      payload: { eventId: event.id, verificationStatus: args.verificationStatus, reason: args.reason, source: args.source },
      reversible: false,
    },
    tx,
  );

  return {
    status: args.verificationStatus,
    eventId: event.id,
    direction: 'UNKNOWN',
    late: false,
    lateMinutes: null,
    timestamp: event.timestamp,
    reason: args.reason,
    student: student ? { id: student.id, name: student.name, rollNo: student.rollNo } : undefined,
    _emit: recorded.emit,
    _reader: reader,
    _confidence: undefined,
  };
}

async function notifyParents(schoolId: string, result: ScanResult, reader: ReaderRow) {
  if (!result.student) return;
  const links = await prisma.studentParent.findMany({ where: { studentId: result.student.id }, include: { parent: { include: { user: true } } } });
  const timeLabel = result.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const place = reader ? ` through ${reader.location}` : '';
  const verb = result.direction === 'EXIT' ? 'exited' : 'entered';
  const lateNote = result.late ? ` (${result.lateMinutes} min late)` : '';
  const body = `${result.student.name} ${verb} school at ${timeLabel}${place}${lateNote}.`;

  for (const link of links) {
    await notify({ schoolId, userId: link.parent.userId, title: `${result.student.name} ${verb} school`, body, severity: result.late ? 'WARNING' : 'SUCCESS', category: 'ATTENDANCE' });
    const contact = link.parent.user;
    if (contact.phone) await sendSms({ schoolId, to: contact.phone, title: `${result.student.name} ${verb} school`, body });
    if (contact.email) await sendEmail({ schoolId, to: contact.email, title: `${result.student.name} ${verb} school`, body });
    await sendPush({ schoolId, to: contact.id, title: `${result.student.name} ${verb} school`, body });
  }
}

async function notifyAdminsUnknownCard(schoolId: string, reader: ReaderRow, reason?: string) {
  const admins = await prisma.user.findMany({ where: { schoolId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'] }, active: true } });
  const place = reader ? ` at ${reader.location} (${reader.name})` : '';
  for (const admin of admins) {
    await notify({
      schoolId,
      userId: admin.id,
      title: 'Unrecognized card scanned',
      body: `${reason ?? 'Unknown card'}${place}. Needs review in Presence → Unknown Cards.`,
      severity: 'WARNING',
      category: 'SECURITY',
      action: { href: '/presence/attendance?filter=unknown' },
    });
  }
}

import { prisma } from '../../lib/prisma.js';
import { toJson, fromJson } from '../../lib/json.js';
import { notify } from '../notifications.js';
import { logAI } from '../trustLedger.js';
import { recordEvent, undoEvent } from '../eventStore.js';
import { emitToSchool } from '../../lib/socket.js';
import { planSubstitutes } from './substitute.js';
import { loadConfig } from './input.js';
import { dayIndexFor } from './substitute.js';
import type { SubstituteSuggestion } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The reactive cascade — the vision's one live flow, as ONE call:
//
//   teacher marked absent → Kairos plans cover → best substitutes assigned →
//   freed rooms identified → substitutes AND affected families notified →
//   the whole thing lands in the ledger as a single reversible event.
//
// Every step reports what it actually did (or honestly didn't: "no cover
// found for P5 Science"). Undo restores the timetable state atomically and
// sends an explicit correction — it never pretends the first messages
// were not sent.
// ─────────────────────────────────────────────────────────────────────────────

export interface CascadeStep {
  key: string;
  label: string;
  detail: string;
  status: 'DONE' | 'PARTIAL' | 'SKIPPED';
  at: string; // ISO timestamp — real execution time of the step
}

export interface CascadeResult {
  ok: boolean;
  absenceId: string;
  eventId: string | null;
  teacher: { id: string; name: string };
  date: string;
  steps: CascadeStep[];
  covered: number;
  uncovered: number;
  freedRooms: { period: number; room: string; className: string; subject: string }[];
  notified: { substitutes: number; familyUsers: number };
  reversible: boolean;
}

const now = () => new Date().toISOString();

export async function runAbsenceCascade(
  schoolId: string,
  teacherId: string,
  date: string,
  actor: { id: string; name: string },
  reason?: string,
): Promise<CascadeResult> {
  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId }, include: { user: true } });
  if (!teacher) throw new Error('Teacher not found');
  const teacherName = teacher.user.name;

  const steps: CascadeStep[] = [];

  // ── Step 1+2 outside the write transaction: plan first, so a planning
  //    failure leaves nothing half-written. ──
  const plan = await planSubstitutes(schoolId, teacherId, date);
  const suggestions = plan.suggestions;
  const withCandidate = suggestions.filter((s) => s.candidate);
  const withoutCandidate = suggestions.filter((s) => !s.candidate);

  // ── Steps 3+6 atomically: absence + substitutions + the reversible event
  //    commit together, or not at all. ──
  const picks = withCandidate.map((s) => ({
    period: s.slot.period,
    classId: s.slot.classId,
    subjectId: s.slot.subjectId,
    subTeacherId: s.candidate!.teacherId,
    reasons: s.candidate!.reasons,
    confidence: s.candidate!.confidence,
  }));

  const { cfg } = await loadConfig(schoolId);
  const day = dayIndexFor(date, cfg.workingDays) ?? 0;

  const txOut = await prisma.$transaction(async (tx) => {
    const absence = await tx.staffAbsence.upsert({
      where: { teacherId_date: { teacherId, date } },
      create: { teacherId, date, reason: reason ?? 'Marked via cascade' },
      update: { reason: reason ?? undefined },
    });
    // Re-running the cascade replaces the previous plan rather than stacking.
    await tx.substitution.deleteMany({ where: { absenceId: absence.id } });
    const subIds: string[] = [];
    for (const p of picks) {
      const sub = await tx.substitution.create({
        data: {
          absenceId: absence.id,
          subTeacherId: p.subTeacherId,
          day,
          period: p.period,
          classId: p.classId,
          subjectId: p.subjectId,
          reasonString: toJson(p.reasons ?? []),
          confidence: p.confidence ?? 0,
          accepted: true,
        },
      });
      subIds.push(sub.id);
    }

    const event = await recordEvent(
      {
        schoolId,
        type: 'STAFF_ABSENCE_CASCADE',
        aggregate: 'StaffAbsence',
        aggregateId: absence.id,
        payload: {
          absenceId: absence.id,
          teacherId,
          teacherName,
          date,
          substitutionIds: subIds,
          covered: picks.length,
          uncovered: withoutCandidate.length,
        },
        actorId: actor.id,
        actorName: actor.name,
      },
      tx,
    );
    return { absence, event, subIds };
  });
  txOut.event.emit();

  steps.push({
    key: 'absence',
    label: 'Absence recorded',
    detail: `${teacherName} marked absent for ${date}${reason ? ` — ${reason}` : ''}.`,
    status: 'DONE',
    at: now(),
  });

  if (plan.message) {
    steps.push({ key: 'plan', label: 'Cover planning', detail: plan.message, status: 'SKIPPED', at: now() });
  } else {
    steps.push({
      key: 'plan',
      label: 'Kairos scanned the live timetable',
      detail: `${suggestions.length} period(s) affected; qualified & free candidates found for ${withCandidate.length}.`,
      status: suggestions.length === 0 ? 'SKIPPED' : 'DONE',
      at: now(),
    });
    steps.push({
      key: 'assign',
      label: 'Substitutes assigned',
      detail: picks.length
        ? withCandidate
            .map((s) => `P${s.slot.period + 1} ${s.slot.subjectName} (${s.slot.className}) → ${s.candidate!.teacherName}`)
            .join(' · ')
        : 'No periods could be covered.',
      status: picks.length === suggestions.length && picks.length > 0 ? 'DONE' : picks.length > 0 ? 'PARTIAL' : suggestions.length === 0 ? 'SKIPPED' : 'PARTIAL',
      at: now(),
    });
  }

  // ── Step 4: freed rooms — honest definition: a room only frees up when a
  //    period found NO cover (a substitute keeps the room in use). ──
  const freedRooms = withoutCandidate
    .filter((s) => s.slot.roomName)
    .map((s) => ({ period: s.slot.period, room: s.slot.roomName!, className: s.slot.className, subject: s.slot.subjectName }));
  if (suggestions.length > 0) {
    steps.push({
      key: 'rooms',
      label: 'Room map updated',
      detail: freedRooms.length
        ? freedRooms.map((r) => `${r.room} free P${r.period + 1} (no cover for ${r.className} ${r.subject})`).join(' · ')
        : 'No rooms freed — every affected period is covered in its own room.',
      status: 'DONE',
      at: now(),
    });
  }

  // ── Step 5: notify substitutes + affected families. ──
  let familyUsers = 0;
  const subTeacherIds = [...new Set(picks.map((p) => p.subTeacherId))];
  if (subTeacherIds.length) {
    const subUsers = await prisma.teacher.findMany({ where: { id: { in: subTeacherIds } }, include: { user: true } });
    await Promise.all(
      subUsers.map((t) =>
        notify({
          schoolId,
          userId: t.userId,
          title: 'Cover assignment',
          body: `You are covering ${picks.filter((p) => p.subTeacherId === t.id).length} period(s) on ${date} for ${teacherName}.`,
          severity: 'INFO',
          category: 'TIMETABLE',
          action: { label: 'View timetable', to: '/kairos' },
        }),
      ),
    );
  }

  // Families of every affected class get ONE consolidated message each.
  const affectedClassIds = [...new Set(suggestions.map((s) => s.slot.classId))];
  if (affectedClassIds.length) {
    const byClass = new Map<string, SubstituteSuggestion[]>();
    for (const s of suggestions) {
      if (!byClass.has(s.slot.classId)) byClass.set(s.slot.classId, []);
      byClass.get(s.slot.classId)!.push(s);
    }
    for (const [classId, slots] of byClass) {
      const students = await prisma.student.findMany({
        where: { classId, schoolId, active: true },
        include: { user: { select: { id: true } }, parents: { include: { parent: { select: { userId: true } } } } },
      });
      const userIds = new Set<string>();
      for (const st of students) {
        if (st.user?.id) userIds.add(st.user.id);
        for (const link of st.parents) userIds.add(link.parent.userId);
      }
      const className = slots[0].slot.className;
      const lines = slots
        .map((s) =>
          s.candidate
            ? `P${s.slot.period + 1} ${s.slot.subjectName}: covered by ${s.candidate.teacherName}`
            : `P${s.slot.period + 1} ${s.slot.subjectName}: no cover assigned yet`,
        )
        .join(' · ');
      await Promise.all(
        [...userIds].map((uid) =>
          notify({
            schoolId,
            userId: uid,
            title: `Timetable change for ${className} (${date})`,
            body: `${teacherName} is absent today. ${lines}.`,
            severity: 'INFO',
            category: 'TIMETABLE',
          }),
        ),
      );
      familyUsers += userIds.size;
    }
    steps.push({
      key: 'notify',
      label: 'People notified',
      detail: `${subTeacherIds.length} substitute(s) and ${familyUsers} family member(s) across ${affectedClassIds.length} class(es).`,
      status: 'DONE',
      at: now(),
    });
  } else {
    steps.push({ key: 'notify', label: 'People notified', detail: 'No classes affected — nobody to notify.', status: 'SKIPPED', at: now() });
  }

  // ── Step 6: ledger. The event committed with the writes; the AI log
  //    carries the real mean candidate confidence. ──
  const meanConf = picks.length ? picks.reduce((a, p) => a + (p.confidence ?? 0), 0) / picks.length : 0;
  await logAI({
    schoolId,
    engine: 'KAIROS',
    action: 'Absence cascade executed',
    reason: `${teacherName} absent ${date}: ${picks.length}/${suggestions.length} period(s) auto-covered; ${freedRooms.length} room(s) freed; ${familyUsers} family member(s) notified.`,
    confidence: picks.length ? Math.round(meanConf * 100) / 100 : 1,
    input: { teacherId, date },
    output: { covered: picks.length, uncovered: withoutCandidate.length, eventId: txOut.event.id },
    actorId: actor.id,
  });
  steps.push({
    key: 'ledger',
    label: 'Logged & reversible',
    detail: 'One event in the Trust ledger holds the whole cascade — Undo restores the original timetable.',
    status: 'DONE',
    at: now(),
  });

  emitToSchool(schoolId, 'kairos:cascade', { date, teacherName, covered: picks.length, uncovered: withoutCandidate.length });

  return {
    ok: true,
    absenceId: txOut.absence.id,
    eventId: txOut.event.id,
    teacher: { id: teacherId, name: teacherName },
    date,
    steps,
    covered: picks.length,
    uncovered: withoutCandidate.length,
    freedRooms,
    notified: { substitutes: subTeacherIds.length, familyUsers },
    reversible: true,
  };
}

/**
 * Undo the cascade: restores state via the event-store reverser (atomic),
 * then sends honest correction notices to the substitutes who had been
 * assigned. Returns what was undone.
 */
export async function undoAbsenceCascade(schoolId: string, eventId: string, actor: { id: string; name: string }) {
  const event = await prisma.event.findFirst({ where: { id: eventId, schoolId, type: 'STAFF_ABSENCE_CASCADE' } });
  if (!event) throw new Error('Cascade event not found');
  const payload = fromJson<{ absenceId: string; teacherName: string; date: string; substitutionIds: string[] }>(
    event.payloadString,
    { absenceId: '', teacherName: '', date: '', substitutionIds: [] },
  );

  // Who was covering — captured BEFORE the reverser deletes the rows.
  const subs = payload.absenceId
    ? await prisma.substitution.findMany({
        where: { absenceId: payload.absenceId },
        include: { subTeacher: { select: { userId: true } } },
      })
    : [];

  await undoEvent(schoolId, eventId, actor);

  const subUserIds = [...new Set(subs.map((s) => s.subTeacher.userId))];
  await Promise.all(
    subUserIds.map((uid) =>
      notify({
        schoolId,
        userId: uid,
        title: 'Cover assignment cancelled',
        body: `The absence of ${payload.teacherName} on ${payload.date} was reverted — your cover assignment no longer applies.`,
        severity: 'INFO',
        category: 'TIMETABLE',
      }),
    ),
  );
  await logAI({
    schoolId,
    engine: 'KAIROS',
    action: 'Absence cascade undone',
    reason: `Cascade for ${payload.teacherName} (${payload.date}) reverted: ${subs.length} substitution(s) removed, absence cleared, ${subUserIds.length} substitute(s) informed.`,
    confidence: 1,
    output: { eventId },
    actorId: actor.id,
  });
  emitToSchool(schoolId, 'kairos:cascade', { date: payload.date, teacherName: payload.teacherName, undone: true });

  return { ok: true, undone: eventId, substitutionsRemoved: subs.length, substitutesInformed: subUserIds.length };
}

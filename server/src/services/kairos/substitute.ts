import { prisma } from '../../lib/prisma.js';
import { fromJson, toJson } from '../../lib/json.js';
import { notify } from '../notifications.js';
import { logAI } from '../trustLedger.js';
import { loadConfig } from './input.js';
import type { CellRef, SubstituteSuggestion } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Substitute engine — when a teacher is out, cover ONLY their slots for that
// day. The rest of the published timetable is untouched (emergency mode).
//
// A candidate must be: qualified for the subject, free that period in the
// live timetable, not absent themselves, not already covering another class
// then, within daily-load and consecutive-run limits. Ranked by current
// weekly load (lightest first), then by how light their day is.
// ─────────────────────────────────────────────────────────────────────────────

/** Map a calendar date to a timetable day index, or null on non-working days. */
export function dayIndexFor(date: string, workingDays: number): number | null {
  const js = new Date(`${date}T12:00:00`).getDay(); // 0=Sun..6=Sat
  const idx = js === 0 ? 6 : js - 1; // Mon=0..Sun=6
  return idx < workingDays ? idx : null;
}

export async function planSubstitutes(schoolId: string, teacherId: string, date: string) {
  const { cfg } = await loadConfig(schoolId);
  const day = dayIndexFor(date, cfg.workingDays);
  if (day === null) return { day: null, suggestions: [] as SubstituteSuggestion[], message: 'That date is not a working day.' };
  if (cfg.holidays.includes(date))
    return { day, suggestions: [] as SubstituteSuggestion[], message: 'That date is a holiday — no cover needed.' };

  const active = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
  if (!active) return { day, suggestions: [] as SubstituteSuggestion[], message: 'No published timetable yet.' };

  const [affected, allSlotsToday, teachers, absencesToday, subsToday] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { timetableId: active.id, teacherId, day },
      include: { class: true, subject: true, room: true },
      orderBy: { period: 'asc' },
    }),
    prisma.timetableSlot.findMany({ where: { timetableId: active.id, day } }),
    prisma.teacher.findMany({ where: { schoolId }, include: { user: true } }),
    prisma.staffAbsence.findMany({ where: { date, teacher: { schoolId } } }),
    prisma.substitution.findMany({ where: { absence: { date, teacher: { schoolId } } } }),
  ]);

  const absentIds = new Set([teacherId, ...absencesToday.map((a) => a.teacherId)]);
  const busy = new Map<string, Set<number>>(); // teacherId → periods busy today
  for (const s of allSlotsToday) {
    if (!busy.has(s.teacherId)) busy.set(s.teacherId, new Set());
    busy.get(s.teacherId)!.add(s.period);
  }
  // Substitutions already accepted today also count as busy.
  const subBusy = new Map<string, Set<number>>();
  for (const s of subsToday) {
    if (!subBusy.has(s.subTeacherId)) subBusy.set(s.subTeacherId, new Set());
    subBusy.get(s.subTeacherId)!.add(s.period);
  }

  const suggestions: SubstituteSuggestion[] = [];
  const takenThisPlan = new Map<string, Set<number>>(); // avoid double-assigning within one plan

  for (const slot of affected) {
    const ranked: { teacherId: string; teacherName: string; reasons: string[]; confidence: number }[] = [];
    for (const t of teachers) {
      if (t.id === teacherId || absentIds.has(t.id)) continue;
      const subjects = fromJson<string[]>(t.subjectsString, []);
      if (!subjects.includes(slot.subject.code)) continue;
      const periodsBusy = busy.get(t.id) ?? new Set<number>();
      const periodsSub = subBusy.get(t.id) ?? new Set<number>();
      const periodsPlan = takenThisPlan.get(t.id) ?? new Set<number>();
      if (periodsBusy.has(slot.period) || periodsSub.has(slot.period) || periodsPlan.has(slot.period)) continue;
      const unavailable = fromJson<CellRef[]>(t.unavailableString, []);
      if (unavailable.some((u) => u.day === day && u.period === slot.period)) continue;

      const dayLoad = periodsBusy.size + periodsSub.size + periodsPlan.size;
      if (dayLoad >= t.maxDailyPeriods) continue;
      // Consecutive-run check with the cover added.
      const merged = new Set([...periodsBusy, ...periodsSub, ...periodsPlan, slot.period]);
      let run = 1;
      for (let p = slot.period - 1; merged.has(p); p--) run++;
      for (let p = slot.period + 1; merged.has(p); p++) run++;
      if (run > t.maxConsecutive) continue;

      const reasons = [
        `Qualified for ${slot.subject.name}`,
        `Free during P${slot.period + 1} today`,
        `${t.weeklyHours}/${t.maxHours} periods this week`,
        dayLoad <= 3 ? `Light day today (${dayLoad} periods)` : `${dayLoad} periods today`,
      ];
      const confidence = Math.max(
        0.7,
        Math.round((0.97 - (t.weeklyHours / Math.max(1, t.maxHours)) * 0.15 - dayLoad * 0.01) * 100) / 100,
      );
      ranked.push({ teacherId: t.id, teacherName: t.user.name, reasons, confidence });
    }
    ranked.sort((a, b) => b.confidence - a.confidence);

    const top = ranked[0] ?? null;
    if (top) {
      if (!takenThisPlan.has(top.teacherId)) takenThisPlan.set(top.teacherId, new Set());
      takenThisPlan.get(top.teacherId)!.add(slot.period);
    }
    suggestions.push({
      slot: {
        day,
        period: slot.period,
        classId: slot.classId,
        className: slot.class.name,
        subjectId: slot.subjectId,
        subjectName: slot.subject.name,
        roomName: slot.room?.name,
      },
      candidate: top,
      alternatives: ranked.slice(1, 4),
    });
  }

  return { day, suggestions, message: null as string | null };
}

/** Persist a cover plan: absence + substitutions, notify, log. Transactional. */
export async function applySubstitutes(
  schoolId: string,
  teacherId: string,
  date: string,
  picks: { period: number; classId: string; subjectId: string; subTeacherId: string; reasons?: string[]; confidence?: number }[],
  actorId?: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    const absence = await tx.staffAbsence.upsert({
      where: { teacherId_date: { teacherId, date } },
      create: { teacherId, date, reason: 'Marked via Kairos cover planner' },
      update: {},
    });
    // Re-planning a day replaces the previous plan rather than stacking on it.
    await tx.substitution.deleteMany({ where: { absenceId: absence.id } });
    const { cfg } = await loadConfig(schoolId);
    const day = dayIndexFor(date, cfg.workingDays) ?? 0;
    for (const p of picks) {
      await tx.substitution.create({
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
    }
    return absence;
  });

  const subTeacherIds = [...new Set(picks.map((p) => p.subTeacherId))];
  const subUsers = await prisma.teacher.findMany({ where: { id: { in: subTeacherIds } }, include: { user: true } });
  await Promise.all(
    subUsers.map((t) =>
      notify({
        schoolId,
        userId: t.userId,
        title: 'Cover assignment',
        body: `You are covering ${picks.filter((p) => p.subTeacherId === t.id).length} period(s) on ${date}.`,
        severity: 'INFO',
        category: 'TIMETABLE',
        action: { label: 'View timetable', to: '/kairos' },
      }),
    ),
  );
  await logAI({
    schoolId,
    engine: 'KAIROS',
    action: 'Substitute plan applied',
    reason: `Covered ${picks.length} period(s) for ${date} without touching the rest of the timetable`,
    confidence: picks.length ? picks.reduce((a, p) => a + (p.confidence ?? 0.8), 0) / picks.length : 0.8,
    output: { date, covered: picks.length },
    actorId,
  });
  return result;
}

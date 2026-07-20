import { prisma } from '../../lib/prisma.js';
import { fromJson, toJson } from '../../lib/json.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { emitToSchool } from '../../lib/socket.js';
import { notify } from '../notifications.js';
import { auditLog, logAI } from '../trustLedger.js';
import { loadSolverInput } from './input.js';
import { preValidate } from './validate.js';
import { ScheduleState, solve, verifySolution } from './engine.js';
import type { Assignment, ConflictAnalysis, HealthReport, Issue, SolveResult, UnplacedLesson } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Workflow: Draft → Review/Edit/Lock → Approve → Publish → (Rollback)
//
// Safety rules enforced here:
//  • Generation never touches the published timetable — it writes a DRAFT.
//  • Publishing is one transaction: verify draft → archive current → activate
//    draft → recompute teacher loads. Any failure rolls the whole thing back,
//    so the school always has exactly one live timetable.
//  • Manual edits are validated against every hard constraint and rejected
//    with plain-English reasons — never applied silently broken.
// ─────────────────────────────────────────────────────────────────────────────

const T_STATUS = { DRAFT: 'DRAFT', APPROVED: 'APPROVED', PUBLISHED: 'PUBLISHED', ARCHIVED: 'ARCHIVED' } as const;

export async function getDraft(schoolId: string) {
  return prisma.timetable.findFirst({
    where: { schoolId, status: { in: [T_STATUS.DRAFT, T_STATUS.APPROVED] } },
    orderBy: { createdAt: 'desc' },
  });
}

export interface GenerateOutcome {
  ok: boolean;
  issues?: Issue[];
  timetableId?: string;
  result?: SolveResult;
  conflictAnalysis?: ConflictAnalysis | null;
}

// ── Conflict analysis: "the smallest set of conflicting rules, and the
//    cheapest way out". Cost ranks are declared planning constants keyed on
//    the fix/blocker vocabulary the engine itself emits — deterministic,
//    never model output. ──
const COST_LABELS: Record<number, string> = { 1: 'one-field change', 2: 'staffing change', 3: 'infrastructure / hiring' };
const BLOCKER_COST: Record<string, number> = {
  NO_CONFIG: 1, NO_CURRICULUM: 1, CLASS_OVERFULL: 1, ROOM_CAPACITY: 1, LAB_TIGHT: 1,
  NO_QUALIFIED_TEACHER: 2, TEACHER_OVERLOAD: 2,
  LAB_CAPACITY: 3, STAFF_CAPACITY: 3,
};
const FIX_COST: Record<string, number> = {
  'Raise a weekly cap': 1, 'Relax availability': 1,
  'Add a qualification': 2, 'Share the load': 2,
  'Free a lab period': 3,
};

export function analyzeConflicts(issues: Issue[], unplaced: UnplacedLesson[]): ConflictAnalysis | null {
  const conflicts = new Set<string>();
  const fixMap = new Map<string, { label: string; detail: string; costRank: number; addresses: number }>();

  for (const i of issues.filter((x) => x.severity === 'BLOCKER')) {
    conflicts.add(i.title);
    if (i.fix) {
      const cost = BLOCKER_COST[i.code] ?? 2;
      const e = fixMap.get(i.fix) ?? { label: i.fix, detail: i.detail, costRank: cost, addresses: 0 };
      e.addresses++;
      fixMap.set(i.fix, e);
    }
  }
  for (const u of unplaced) {
    conflicts.add(u.cause);
    for (const f of u.fixes) {
      const cost = FIX_COST[f.label] ?? 2;
      const e = fixMap.get(f.label) ?? { label: f.label, detail: f.detail, costRank: cost, addresses: 0 };
      e.addresses++;
      fixMap.set(f.label, e);
    }
  }
  if (!conflicts.size) return null;

  const fixes = [...fixMap.values()]
    .sort((a, b) => a.costRank - b.costRank || b.addresses - a.addresses)
    .map((f) => ({ ...f, costLabel: COST_LABELS[f.costRank] }));
  const cheapest = fixes[0] ?? null;
  return {
    conflicts: [...conflicts],
    fixes,
    cheapestFix: cheapest ? { label: cheapest.label, detail: cheapest.detail, costLabel: cheapest.costLabel } : null,
  };
}

/**
 * Generate (or regenerate) the draft. With `keepLocks`, locked slots of the
 * existing draft are preserved and the solver fills in around them.
 */
export async function generateDraft(
  schoolId: string,
  actor: { id?: string; name?: string },
  opts: { keepLocks?: boolean } = {},
): Promise<GenerateOutcome> {
  const data = await loadSolverInput(schoolId);
  const issues = preValidate(data);
  if (issues.some((i) => i.severity === 'BLOCKER')) {
    return { ok: false, issues, conflictAnalysis: analyzeConflicts(issues, []) };
  }

  let locked: Assignment[] = [];
  const existing = await getDraft(schoolId);
  if (opts.keepLocks && existing) {
    const lockedSlots = await prisma.timetableSlot.findMany({ where: { timetableId: existing.id, locked: true } });
    locked = lockedSlots.map((s) => ({
      classId: s.classId,
      subjectId: s.subjectId,
      day: s.day,
      period: s.period,
      teacherId: s.teacherId,
      roomId: s.roomId ?? undefined,
      locked: true,
    }));
  }

  const result = solve(data, { locked, timeBudgetMs: 3000 });

  // Final gate: independently re-verify every hard constraint. A draft that
  // fails this NEVER reaches the database.
  const problems = verifySolution(data, result.assignments);
  if (problems.length) {
    throw new Error(`Kairos internal verification failed — draft rejected: ${problems[0]}`);
  }

  const conflictAnalysis = analyzeConflicts([], result.unplaced);
  const health: HealthReport = {
    score: result.score,
    breakdown: result.breakdown,
    unplaced: result.unplaced,
    warnings: result.warnings,
    recommendations: result.recommendations,
    conflictAnalysis,
  };

  const timetable = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.timetableSlot.deleteMany({ where: { timetableId: existing.id } });
      await tx.timetable.delete({ where: { id: existing.id } });
    }
    const tt = await tx.timetable.create({
      data: {
        schoolId,
        name: `Draft ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        status: T_STATUS.DRAFT,
        active: false,
        solveMs: result.solveMs,
        score: result.score,
        healthString: toJson(health),
        generatedByName: actor.name,
      },
    });
    if (result.assignments.length) {
      await tx.timetableSlot.createMany({
        data: result.assignments.map((a) => ({
          timetableId: tt.id,
          day: a.day,
          period: a.period,
          classId: a.classId,
          subjectId: a.subjectId,
          teacherId: a.teacherId,
          roomId: a.roomId ?? null,
          locked: !!a.locked,
          explainString: toJson(a.explain ?? null),
        })),
      });
    }
    return tt;
  });

  await logAI({
    schoolId,
    engine: 'KAIROS',
    action: 'Draft generated',
    reason: `${result.stats.placed}/${result.stats.total} periods placed in ${result.solveMs}ms (${result.stats.restarts} attempts); ${result.unplaced.length} issue(s)`,
    confidence: result.score / 100,
    output: { score: result.score, placed: result.stats.placed, unplaced: result.unplaced.length },
    actorId: actor.id,
  });
  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_DRAFT_GENERATED', entity: 'Timetable', entityId: timetable.id, meta: { score: result.score } });
  emitToSchool(schoolId, 'timetable:draft', { id: timetable.id, score: result.score });

  return { ok: true, timetableId: timetable.id, result, conflictAnalysis };
}

/**
 * Manually move/re-staff a draft slot. Every hard constraint is re-checked
 * against the rest of the draft; violations reject the edit with reasons.
 * A successful manual edit locks the slot so regeneration respects it.
 */
export async function updateDraftSlot(
  schoolId: string,
  slotId: string,
  change: { day?: number; period?: number; teacherId?: string; roomId?: string | null },
  actor: { id?: string; name?: string },
) {
  const slot = await prisma.timetableSlot.findUnique({ where: { id: slotId }, include: { timetable: true } });
  if (!slot || slot.timetable.schoolId !== schoolId) throw notFound('Slot not found');
  if (slot.timetable.status !== T_STATUS.DRAFT && slot.timetable.status !== T_STATUS.APPROVED)
    throw badRequest('Only the draft can be edited. Generate a draft first.');

  const data = await loadSolverInput(schoolId);
  const siblings = await prisma.timetableSlot.findMany({ where: { timetableId: slot.timetableId, id: { not: slotId } } });

  const state = new ScheduleState(data);
  for (const s of siblings)
    state.place({ classId: s.classId, subjectId: s.subjectId, day: s.day, period: s.period, teacherId: s.teacherId, roomId: s.roomId ?? undefined });

  const lesson = data.lessons.find((l) => l.classId === slot.classId && l.subjectId === slot.subjectId);
  const teacher = state.teacherById.get(change.teacherId ?? slot.teacherId);
  const roomId = change.roomId === undefined ? slot.roomId : change.roomId;
  const room = roomId ? state.roomById.get(roomId) : undefined;
  const day = change.day ?? slot.day;
  const period = change.period ?? slot.period;

  if (!lesson) throw badRequest('This lesson is no longer in the curriculum — regenerate the draft.');
  if (!teacher) throw badRequest('Unknown teacher.');

  const violations = state.placementIssues(lesson, day, period, teacher, room);
  if (violations.length) return { ok: false as const, violations };

  const updated = await prisma.timetableSlot.update({
    where: { id: slotId },
    data: {
      day,
      period,
      teacherId: teacher.id,
      roomId: roomId ?? null,
      locked: true,
      explainString: toJson({
        reasons: [`Manually set by ${actor.name ?? 'admin'}`, `${teacher.name} is qualified and free`, 'All conflict checks passed'],
        alternatives: { teachers: 0, rooms: 0 },
        confidence: 1,
      }),
    },
  });
  await recomputeDraftHealth(slot.timetableId, schoolId);
  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_SLOT_EDITED', entity: 'TimetableSlot', entityId: slotId, meta: change });
  return { ok: true as const, slot: updated };
}

export async function setSlotLock(schoolId: string, slotId: string, locked: boolean) {
  const slot = await prisma.timetableSlot.findUnique({ where: { id: slotId }, include: { timetable: true } });
  if (!slot || slot.timetable.schoolId !== schoolId) throw notFound('Slot not found');
  if (slot.timetable.status !== T_STATUS.DRAFT && slot.timetable.status !== T_STATUS.APPROVED)
    throw badRequest('Only draft slots can be locked.');
  return prisma.timetableSlot.update({ where: { id: slotId }, data: { locked } });
}

/** Re-score the draft after a manual change (soft metrics only — hard ones are enforced). */
async function recomputeDraftHealth(timetableId: string, schoolId: string) {
  const [tt, slots, data] = await Promise.all([
    prisma.timetable.findUnique({ where: { id: timetableId } }),
    prisma.timetableSlot.findMany({ where: { timetableId } }),
    loadSolverInput(schoolId),
  ]);
  if (!tt) return;
  const state = new ScheduleState(data);
  for (const s of slots)
    state.place({ classId: s.classId, subjectId: s.subjectId, day: s.day, period: s.period, teacherId: s.teacherId, roomId: s.roomId ?? undefined });
  const total = data.lessons.reduce((a, l) => a + l.weeklyPeriods, 0);
  const placement = total ? Math.round((slots.length / total) * 100) : 100;
  const avgSoft = slots.length ? state.totalSoftCost() / slots.length : 0;
  const balance = Math.max(0, Math.round(100 - avgSoft * 30));
  const health = fromJson<HealthReport | null>(tt.healthString, null);
  const score = Math.max(0, Math.min(100, Math.round(placement * 0.6 + balance * 0.25 + (health?.breakdown.preferences ?? 100) * 0.15)));
  await prisma.timetable.update({
    where: { id: timetableId },
    data: {
      score,
      healthString: toJson({
        ...(health ?? { unplaced: [], warnings: [], recommendations: [] }),
        score,
        breakdown: { placement, balance, preferences: health?.breakdown.preferences ?? 100 },
      }),
    },
  });
}

export async function approveDraft(schoolId: string, actor: { id?: string; name?: string }) {
  const draft = await getDraft(schoolId);
  if (!draft) throw badRequest('There is no draft to approve. Generate one first.');
  if (draft.status === T_STATUS.APPROVED) return draft;
  const updated = await prisma.timetable.update({
    where: { id: draft.id },
    data: { status: T_STATUS.APPROVED, approvedByName: actor.name, approvedAt: new Date() },
  });
  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_APPROVED', entity: 'Timetable', entityId: draft.id });
  return updated;
}

/**
 * Publish the approved draft. Fully transactional — verifies integrity first,
 * archives the old version, activates the new one and recomputes teacher
 * loads. The school is never left without an active timetable.
 */
export async function publishDraft(schoolId: string, actor: { id?: string; name?: string }) {
  const draft = await getDraft(schoolId);
  if (!draft) throw badRequest('There is no draft to publish.');
  if (draft.status !== T_STATUS.APPROVED) throw badRequest('The draft must be approved by the principal before publishing.');

  const slots = await prisma.timetableSlot.findMany({ where: { timetableId: draft.id } });
  if (!slots.length) throw badRequest('The draft is empty — generate a timetable first.');

  // Final integrity verification: no class/teacher/room double-booking.
  const seen = new Set<string>();
  for (const s of slots) {
    for (const key of [
      `C|${s.classId}|${s.day}|${s.period}`,
      `T|${s.teacherId}|${s.day}|${s.period}`,
      ...(s.roomId ? [`R|${s.roomId}|${s.day}|${s.period}`] : []),
    ]) {
      if (seen.has(key)) throw badRequest('Draft failed final verification: a double-booking was found. Regenerate the draft.');
      seen.add(key);
    }
  }

  const published = await prisma.$transaction(async (tx) => {
    const current = await tx.timetable.findFirst({ where: { schoolId, active: true } });
    const maxVersion = await tx.timetable.aggregate({ where: { schoolId }, _max: { version: true } });
    if (current) {
      await tx.timetable.update({ where: { id: current.id }, data: { active: false, status: T_STATUS.ARCHIVED } });
    }
    const tt = await tx.timetable.update({
      where: { id: draft.id },
      data: {
        status: T_STATUS.PUBLISHED,
        active: true,
        version: (maxVersion._max.version ?? 0) + 1,
        name: `Version ${(maxVersion._max.version ?? 0) + 1}`,
        publishedByName: actor.name,
        publishedAt: new Date(),
      },
    });
    // Teacher weekly loads follow the live timetable.
    const load: Record<string, number> = {};
    for (const s of slots) load[s.teacherId] = (load[s.teacherId] ?? 0) + 1;
    const teachers = await tx.teacher.findMany({ where: { schoolId }, select: { id: true } });
    for (const t of teachers) {
      await tx.teacher.update({ where: { id: t.id }, data: { weeklyHours: load[t.id] ?? 0 } });
    }
    return tt;
  });

  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_PUBLISHED', entity: 'Timetable', entityId: published.id, meta: { version: published.version } });
  await prisma.event.create({
    data: {
      schoolId,
      type: 'TIMETABLE_PUBLISHED',
      aggregate: 'Timetable',
      aggregateId: published.id,
      payloadString: toJson({ version: published.version, score: published.score }),
      actorName: actor.name,
      reversible: true,
    },
  });
  await notify({
    schoolId,
    title: `Timetable v${published.version} is live`,
    body: `Published by ${actor.name ?? 'admin'}. All dashboards now follow the new schedule.`,
    severity: 'SUCCESS',
    category: 'TIMETABLE',
    action: { label: 'View timetable', to: '/kairos' },
  });
  emitToSchool(schoolId, 'timetable:published', { id: published.id, version: published.version });
  return published;
}

/** Roll back to an archived version — transactional, atomic swap. */
export async function rollbackToVersion(schoolId: string, timetableId: string, actor: { id?: string; name?: string }) {
  const target = await prisma.timetable.findFirst({ where: { id: timetableId, schoolId } });
  if (!target) throw notFound('Version not found');
  if (target.active) throw badRequest('That version is already live.');
  if (target.status !== T_STATUS.ARCHIVED) throw badRequest('Only previously published versions can be restored.');
  const slotCount = await prisma.timetableSlot.count({ where: { timetableId } });
  if (!slotCount) throw badRequest('That version has no slots and cannot be restored.');

  const restored = await prisma.$transaction(async (tx) => {
    const current = await tx.timetable.findFirst({ where: { schoolId, active: true } });
    if (current) await tx.timetable.update({ where: { id: current.id }, data: { active: false, status: T_STATUS.ARCHIVED } });
    const tt = await tx.timetable.update({
      where: { id: timetableId },
      data: { active: true, status: T_STATUS.PUBLISHED, publishedByName: actor.name, publishedAt: new Date() },
    });
    const slots = await tx.timetableSlot.findMany({ where: { timetableId } });
    const load: Record<string, number> = {};
    for (const s of slots) load[s.teacherId] = (load[s.teacherId] ?? 0) + 1;
    const teachers = await tx.teacher.findMany({ where: { schoolId }, select: { id: true } });
    for (const t of teachers) await tx.teacher.update({ where: { id: t.id }, data: { weeklyHours: load[t.id] ?? 0 } });
    return tt;
  });

  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_ROLLBACK', entity: 'Timetable', entityId: timetableId, meta: { version: target.version } });
  await notify({
    schoolId,
    title: `Rolled back to timetable v${target.version}`,
    body: `${actor.name ?? 'Admin'} restored a previous version. Dashboards updated instantly.`,
    severity: 'WARNING',
    category: 'TIMETABLE',
    action: { label: 'View timetable', to: '/kairos' },
  });
  emitToSchool(schoolId, 'timetable:published', { id: restored.id, version: restored.version });
  return restored;
}

export async function discardDraft(schoolId: string, actor: { id?: string; name?: string }) {
  const draft = await getDraft(schoolId);
  if (!draft) return null;
  await prisma.$transaction([
    prisma.timetableSlot.deleteMany({ where: { timetableId: draft.id } }),
    prisma.timetable.delete({ where: { id: draft.id } }),
  ]);
  await auditLog({ schoolId, actorId: actor.id, action: 'TIMETABLE_DRAFT_DISCARDED', entity: 'Timetable', entityId: draft.id });
  return draft.id;
}

/** Compare two versions: which cells changed, moved, or were re-staffed. */
export async function compareVersions(schoolId: string, aId: string, bId: string) {
  const [a, b] = await Promise.all([
    prisma.timetable.findFirst({ where: { id: aId, schoolId } }),
    prisma.timetable.findFirst({ where: { id: bId, schoolId } }),
  ]);
  if (!a || !b) throw notFound('Version not found');
  const [slotsA, slotsB] = await Promise.all([
    prisma.timetableSlot.findMany({ where: { timetableId: aId }, include: { class: true, subject: true, teacher: { include: { user: true } }, room: true } }),
    prisma.timetableSlot.findMany({ where: { timetableId: bId }, include: { class: true, subject: true, teacher: { include: { user: true } }, room: true } }),
  ]);
  const key = (s: (typeof slotsA)[number]) => `${s.classId}|${s.day}|${s.period}`;
  const mapA = new Map(slotsA.map((s) => [key(s), s]));
  const mapB = new Map(slotsB.map((s) => [key(s), s]));
  const changes: { className: string; day: number; period: number; from: string | null; to: string | null }[] = [];
  const describe = (s: (typeof slotsA)[number]) => `${s.subject.name} · ${s.teacher.user.name}${s.room ? ' · ' + s.room.name : ''}`;
  for (const [k, sa] of mapA) {
    const sb = mapB.get(k);
    if (!sb) changes.push({ className: sa.class.name, day: sa.day, period: sa.period, from: describe(sa), to: null });
    else if (sa.subjectId !== sb.subjectId || sa.teacherId !== sb.teacherId || sa.roomId !== sb.roomId)
      changes.push({ className: sa.class.name, day: sa.day, period: sa.period, from: describe(sa), to: describe(sb) });
  }
  for (const [k, sb] of mapB) {
    if (!mapA.has(k)) changes.push({ className: sb.class.name, day: sb.day, period: sb.period, from: null, to: describe(sb) });
  }
  changes.sort((x, y) => x.className.localeCompare(y.className) || x.day - y.day || x.period - y.period);
  let unchanged = 0;
  for (const [k, sa] of mapA) {
    const sb = mapB.get(k);
    if (sb && sa.subjectId === sb.subjectId && sa.teacherId === sb.teacherId && sa.roomId === sb.roomId) unchanged++;
  }
  return {
    a: { id: a.id, version: a.version, name: a.name },
    b: { id: b.id, version: b.version, name: b.name },
    unchanged,
    total: Math.max(slotsA.length, slotsB.length),
    changes: changes.slice(0, 120),
    changeCount: changes.length,
  };
}

/** Emergency: a room goes out of service for a date — re-home only those lessons. */
export async function planRoomClosure(schoolId: string, roomId: string, date: string) {
  const { loadConfig } = await import('./input.js');
  const { dayIndexFor } = await import('./substitute.js');
  const { cfg } = await loadConfig(schoolId);
  const day = dayIndexFor(date, cfg.workingDays);
  if (day === null) return { day: null, moves: [], message: 'Not a working day.' };
  const active = await prisma.timetable.findFirst({ where: { schoolId, active: true } });
  if (!active) return { day, moves: [], message: 'No published timetable.' };

  const [affected, allToday, rooms] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { timetableId: active.id, day, roomId },
      include: { class: true, subject: true, room: true },
      orderBy: { period: 'asc' },
    }),
    prisma.timetableSlot.findMany({ where: { timetableId: active.id, day } }),
    prisma.room.findMany({ where: { building: { schoolId } } }),
  ]);
  const busy = new Set(allToday.filter((s) => s.roomId).map((s) => `${s.roomId}|${s.period}`));
  const moves = affected.map((s) => {
    const needLab = s.subject.requiresLab;
    const alt = rooms.find(
      (r) => r.id !== roomId && (needLab ? r.type === 'LAB' : r.type === 'CLASSROOM' || r.type === 'HALL') && !busy.has(`${r.id}|${s.period}`),
    );
    if (alt) busy.add(`${alt.id}|${s.period}`);
    return {
      period: s.period,
      className: s.class.name,
      subject: s.subject.name,
      from: s.room?.name ?? '—',
      to: alt?.name ?? null,
      note: alt ? `${alt.name} is free and ${needLab ? 'is a laboratory' : `seats ${alt.capacity}`}` : 'No free room — consider merging or moving the lesson',
    };
  });
  return { day, moves, message: null };
}

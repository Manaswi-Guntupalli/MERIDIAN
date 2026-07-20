import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { notify } from '../services/notifications.js';
import { logAI, auditLog } from '../services/trustLedger.js';
import { getDashboardIntelligence } from '../services/intelligence.js';
import { STAFF_ADMIN } from '../utils/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// One-click executes — the difference between a dashboard that POINTS at work
// and one that COMPLETES it. Every kind here performs a real operation
// (assign cover, send reminders, message families), writes the audit trail,
// and reports exactly what it did. Nothing is queued or pretended.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

const today = () => new Date().toISOString().slice(0, 10);

const executeSchema = z.object({
  kind: z.enum(['assign-cover', 'fee-reminders', 'at-risk-outreach', 'counselling-flag']),
  studentIds: z.array(z.string()).max(50).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface ExecuteResult {
  ok: true;
  kind: string;
  done: number;
  summary: string;
  detail: string[];
  undoEventIds?: string[];
}

router.post(
  '/execute',
  validateBody(executeSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const actor = { id: req.user!.sub, name: req.user!.name };
    const body = req.body as z.infer<typeof executeSchema>;

    let result: ExecuteResult;
    switch (body.kind) {
      case 'assign-cover':
        result = await assignCover(schoolId, body.date ?? today(), actor);
        break;
      case 'fee-reminders':
        result = await feeReminders(schoolId, actor);
        break;
      case 'at-risk-outreach':
        result = await atRiskOutreach(schoolId, body.studentIds, actor);
        break;
      case 'counselling-flag':
        result = await counsellingFlag(schoolId, body.studentIds ?? [], actor);
        break;
    }
    res.json(result);
  }),
);

/** Auto-assign cover for every uncovered absence on the date — the full
 *  cascade (substitutes + freed rooms + family notifications + undoable
 *  ledger event) runs per absent teacher. */
async function assignCover(schoolId: string, date: string, actor: { id: string; name: string }): Promise<ExecuteResult> {
  const absences = await prisma.staffAbsence.findMany({
    where: { date, teacher: { schoolId } },
    include: { substitutions: true, teacher: { include: { user: true } } },
  });
  const uncovered = absences.filter((a) => a.substitutions.length === 0);
  if (!uncovered.length) {
    return { ok: true, kind: 'assign-cover', done: 0, summary: `No uncovered absences on ${date}.`, detail: [] };
  }
  const { runAbsenceCascade } = await import('../services/kairos/index.js');
  const detail: string[] = [];
  const undoEventIds: string[] = [];
  let covered = 0;
  for (const a of uncovered) {
    const out = await runAbsenceCascade(schoolId, a.teacherId, date, actor, a.reason ?? undefined);
    covered += out.covered;
    if (out.eventId) undoEventIds.push(out.eventId);
    detail.push(`${a.teacher.user.name}: ${out.covered}/${out.covered + out.uncovered} period(s) covered, ${out.notified.familyUsers} family member(s) notified`);
  }
  return {
    ok: true,
    kind: 'assign-cover',
    done: uncovered.length,
    summary: `Ran the cover cascade for ${uncovered.length} teacher(s) — ${covered} period(s) assigned. Undo is available per teacher in the Trust ledger.`,
    detail,
    undoEventIds,
  };
}

/** One consolidated reminder per family with open fees — real notifications,
 *  counted honestly, never spammed per-fee-row. */
async function feeReminders(schoolId: string, actor: { id: string; name: string }): Promise<ExecuteResult> {
  const open = await prisma.fee.findMany({
    where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
    include: { student: { include: { parents: { include: { parent: { select: { userId: true } } } }, user: { select: { id: true } } } } },
  });
  if (!open.length) return { ok: true, kind: 'fee-reminders', done: 0, summary: 'No open fee accounts — nothing to remind.', detail: [] };

  // Group by student; one message per family covering all their open items.
  const byStudent = new Map<string, { name: string; due: number; titles: string[]; userIds: Set<string> }>();
  for (const f of open) {
    const due = f.amount - f.paid;
    if (due <= 0) continue;
    const e = byStudent.get(f.studentId) ?? { name: f.student.name, due: 0, titles: [], userIds: new Set<string>() };
    e.due += due;
    e.titles.push(f.title);
    if (f.student.user?.id) e.userIds.add(f.student.user.id);
    for (const link of f.student.parents) e.userIds.add(link.parent.userId);
    byStudent.set(f.studentId, e);
  }

  let sent = 0;
  let unreachable = 0;
  const detail: string[] = [];
  for (const [, e] of byStudent) {
    if (!e.userIds.size) {
      unreachable++;
      continue;
    }
    await Promise.all(
      [...e.userIds].map((uid) =>
        notify({
          schoolId,
          userId: uid,
          title: `Fee reminder — ${e.name}`,
          body: `₹${Math.round(e.due).toLocaleString('en-IN')} outstanding (${e.titles.join(', ')}). Please clear at the school office or reach out for a plan.`,
          severity: 'WARNING',
          category: 'FEES',
        }),
      ),
    );
    sent += e.userIds.size;
    detail.push(`${e.name}: ₹${Math.round(e.due).toLocaleString('en-IN')} → ${e.userIds.size} recipient(s)`);
  }
  await auditLog({ schoolId, actorId: actor.id, action: 'FEE_REMINDERS_SENT', entity: 'Fee', meta: { families: byStudent.size, recipients: sent } });
  await logAI({
    schoolId,
    engine: 'COPILOT',
    action: 'Fee reminders dispatched',
    reason: `${byStudent.size} family account(s) with open dues; ${sent} in-app notification(s) delivered${unreachable ? `; ${unreachable} student(s) had no linked account to notify` : ''}.`,
    confidence: 1,
    output: { families: byStudent.size, recipients: sent, unreachable },
    actorId: actor.id,
    reversible: false,
  });
  return {
    ok: true,
    kind: 'fee-reminders',
    done: byStudent.size,
    summary: `Reminded ${byStudent.size} famil${byStudent.size === 1 ? 'y' : 'ies'} (${sent} notification(s))${unreachable ? ` — ${unreachable} had no linked portal account` : ''}.`,
    detail: detail.slice(0, 12),
  };
}

/** Resolve the at-risk list (engine first, honest fallback), message each
 *  family, and give admins the outreach summary. */
async function atRiskOutreach(schoolId: string, studentIds: string[] | undefined, actor: { id: string; name: string }): Promise<ExecuteResult> {
  let targets: { id: string; name: string; reasons: string[] }[] = [];
  let basis: string;

  if (studentIds?.length) {
    const students = await prisma.student.findMany({ where: { schoolId, id: { in: studentIds } } });
    targets = students.map((s) => ({ id: s.id, name: s.name, reasons: ['flagged manually'] }));
    basis = 'manually selected students';
  } else {
    const intel = await getDashboardIntelligence(schoolId);
    const atRisk = intel.engine === 'online' ? (intel.payload as { atRisk?: { available?: boolean; students?: { studentId: string; name: string; reasons: string[] }[] } })?.atRisk : undefined;
    if (atRisk?.available && atRisk.students?.length) {
      targets = atRisk.students.map((r) => ({ id: r.studentId, name: r.name, reasons: r.reasons }));
      basis = 'intelligence engine at-risk index';
    } else {
      // Honest fallback — plain observable criteria, labelled as such.
      const [students, att, fees] = await Promise.all([
        prisma.student.findMany({ where: { schoolId, active: true } }),
        prisma.attendance.findMany({ where: { schoolId }, select: { studentId: true, status: true } }),
        prisma.fee.findMany({ where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }, select: { studentId: true, amount: true, paid: true } }),
      ]);
      const rate = new Map<string, { p: number; t: number }>();
      for (const a of att) {
        const e = rate.get(a.studentId) ?? { p: 0, t: 0 };
        e.t++;
        if (a.status === 'PRESENT' || a.status === 'LATE') e.p++;
        rate.set(a.studentId, e);
      }
      const due = new Map<string, number>();
      for (const f of fees) due.set(f.studentId, (due.get(f.studentId) ?? 0) + (f.amount - f.paid));
      targets = students
        .map((s) => {
          const r = rate.get(s.id);
          const pct = r && r.t ? (r.p / r.t) * 100 : null;
          const owed = due.get(s.id) ?? 0;
          const reasons = [
            pct !== null && pct < 75 ? `attendance ${Math.round(pct)}%` : null,
            owed > 0 ? `fees ₹${Math.round(owed).toLocaleString('en-IN')} due` : null,
          ].filter((x): x is string => !!x);
          return { id: s.id, name: s.name, reasons };
        })
        .filter((t) => t.reasons.length > 0)
        .slice(0, 20);
      basis = 'fallback criteria (attendance < 75% or open fees) — intelligence engine unavailable';
    }
  }

  if (!targets.length) return { ok: true, kind: 'at-risk-outreach', done: 0, summary: 'No at-risk students to contact.', detail: [] };

  const links = await prisma.studentParent.findMany({
    where: { studentId: { in: targets.map((t) => t.id) } },
    include: { parent: { select: { userId: true } } },
  });
  const parentsByStudent = new Map<string, string[]>();
  for (const l of links) {
    if (!parentsByStudent.has(l.studentId)) parentsByStudent.set(l.studentId, []);
    parentsByStudent.get(l.studentId)!.push(l.parent.userId);
  }

  let reached = 0;
  let noFamily = 0;
  const detail: string[] = [];
  for (const t of targets) {
    const parentIds = parentsByStudent.get(t.id) ?? [];
    if (!parentIds.length) {
      noFamily++;
      detail.push(`${t.name}: no linked family account — needs a phone call`);
      continue;
    }
    await Promise.all(
      parentIds.map((uid) =>
        notify({
          schoolId,
          userId: uid,
          title: `Please meet ${t.name}'s class teacher`,
          body: `We'd like to talk about how ${t.name} is doing (${t.reasons.join('; ')}). Please reach out to schedule a short meeting this week.`,
          severity: 'WARNING',
          category: 'GENERAL',
        }),
      ),
    );
    reached++;
    detail.push(`${t.name}: family messaged (${t.reasons.join('; ')})`);
  }
  await auditLog({ schoolId, actorId: actor.id, action: 'AT_RISK_OUTREACH', entity: 'Student', meta: { basis, targeted: targets.length, reached, noFamily } });
  await logAI({
    schoolId,
    engine: 'FORESIGHT',
    action: 'At-risk family outreach dispatched',
    reason: `Targets from ${basis}; ${reached} famil${reached === 1 ? 'y' : 'ies'} messaged, ${noFamily} without a linked account.`,
    confidence: 1,
    output: { targeted: targets.length, reached, noFamily },
    actorId: actor.id,
    reversible: false,
  });
  return {
    ok: true,
    kind: 'at-risk-outreach',
    done: reached,
    summary: `Messaged ${reached} famil${reached === 1 ? 'y' : 'ies'} of at-risk students (${basis})${noFamily ? `; ${noFamily} need a phone call — no linked account` : ''}.`,
    detail: detail.slice(0, 12),
  };
}

/** Put named students on the counselling radar — notifies leadership and
 *  writes the audit entry that review workflows key off. */
async function counsellingFlag(schoolId: string, studentIds: string[], actor: { id: string; name: string }): Promise<ExecuteResult> {
  if (!studentIds.length) throw badRequest('studentIds is required for counselling-flag');
  const students = await prisma.student.findMany({ where: { schoolId, id: { in: studentIds } }, include: { class: true } });
  if (!students.length) throw badRequest('No matching students');
  const admins = await prisma.user.findMany({ where: { schoolId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'] }, active: true } });
  const names = students.map((s) => `${s.name}${s.class ? ` (${s.class.name})` : ''}`);
  await Promise.all(
    admins.map((a) =>
      notify({
        schoolId,
        userId: a.id,
        title: `Counselling follow-up requested — ${students.length} student(s)`,
        body: `${actor.name} flagged: ${names.join(', ')}. Please schedule counsellor time.`,
        severity: 'WARNING',
        category: 'GENERAL',
      }),
    ),
  );
  for (const s of students) {
    await auditLog({ schoolId, actorId: actor.id, action: 'COUNSELLING_FLAGGED', entity: 'Student', entityId: s.id });
  }
  return {
    ok: true,
    kind: 'counselling-flag',
    done: students.length,
    summary: `Flagged ${students.length} student(s) for counselling — leadership notified.`,
    detail: names,
  };
}

export default router;

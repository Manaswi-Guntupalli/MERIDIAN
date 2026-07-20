import { prisma } from '../lib/prisma.js';
import { getDashboardIntelligence } from './intelligence.js';
import { getActiveIncident, getIncidentState } from './emergency.js';

/**
 * Copilot intent registry. Each intent owns a resolver that fetches FACTS from
 * the database or the Python intelligence engine — never from the LLM. The
 * resolver returns the structured facts (the source of truth), a deterministic
 * fallback sentence (used when no OpenAI key is configured), context-aware
 * follow-up actions, and a confidence that reflects DATA AVAILABILITY, not a
 * guessed model certainty.
 */

export interface IntentContext {
  schoolId: string;
  params: Record<string, unknown>;
  question: string;
}

/** A follow-up the UI renders: either navigation (`to`) or a real one-click
 *  operation (`execute` → POST /actions/execute) that COMPLETES the task. */
export interface CopilotAction {
  label: string;
  to?: string;
  execute?: { kind: 'assign-cover' | 'fee-reminders' | 'at-risk-outreach' | 'counselling-flag'; params?: Record<string, unknown> };
}

export interface ResolvedFacts {
  facts: unknown;
  fallbackText: string;
  actions: CopilotAction[];
  confidence: number;
}

export interface IntentDef {
  id: string;
  category: 'attendance' | 'fees' | 'teachers' | 'timetable' | 'documents' | 'intelligence' | 'general';
  description: string; // shown to the LLM classifier
  keywords: string[]; // deterministic fallback classification
  resolve: (ctx: IntentContext) => Promise<ResolvedFacts>;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const num = (v: unknown, d: number) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);

// Follow-up action presets — every `to` is a real route in the client.
const ACTIONS = {
  attendance: [
    { label: 'Open attendance', to: '/attendance' },
    { label: 'Export report', to: '/reports' },
  ],
  fees: [
    { label: 'Draft reminders', to: '/fees' },
    { label: 'View fees', to: '/fees' },
  ],
  teachers: [
    { label: 'Assign substitute', to: '/foresight' },
    { label: 'Open timetable', to: '/kairos' },
  ],
  timetable: [{ label: 'Open Kairos', to: '/kairos' }],
  documents: [{ label: 'Open review queue', to: '/lumen' }],
  intelligence: [
    { label: 'Open dashboard', to: '/' },
    { label: 'Open Foresight', to: '/foresight' },
  ],
  general: [{ label: 'Open dashboard', to: '/' }],
  emergency: [{ label: 'Open Emergency', to: '/emergency' }],
} as const;

// Shared loader for the emergency intents — the active incident's full derived
// state, or null when there is none. Facts only; never invented.
async function activeEmergencyState(schoolId: string) {
  const active = await getActiveIncident(schoolId);
  if (!active) return null;
  return getIncidentState(schoolId, active.id);
}

// ─────────────────────────── shared data helpers ───────────────────────────

async function studentAttendanceRates(schoolId: string) {
  const [students, rows] = await Promise.all([
    prisma.student.findMany({ where: { schoolId, active: true }, include: { class: true } }),
    prisma.attendance.findMany({ where: { schoolId }, select: { studentId: true, status: true } }),
  ]);
  const byStudent = new Map<string, { present: number; total: number }>();
  for (const r of rows) {
    const e = byStudent.get(r.studentId) ?? { present: 0, total: 0 };
    e.total++;
    if (r.status === 'PRESENT' || r.status === 'LATE') e.present++;
    byStudent.set(r.studentId, e);
  }
  return students.map((s) => {
    const e = byStudent.get(s.id) ?? { present: 0, total: 0 };
    return {
      id: s.id,
      name: s.name,
      className: s.class?.name ?? null,
      rollNo: s.rollNo,
      present: e.present,
      total: e.total,
      rate: e.total ? Math.round((e.present / e.total) * 100) : null,
    };
  });
}

async function latestAttendanceDate(schoolId: string): Promise<string | null> {
  const row = await prisma.attendance.findFirst({ where: { schoolId }, orderBy: { date: 'desc' }, select: { date: true } });
  return row?.date ?? null;
}

interface IntelPayload {
  meta?: { anchorDate?: string };
  healthScore?: { overall?: number | null; categories?: Record<string, { score?: number | null; weight?: number }> };
  insights?: Array<Record<string, unknown>>;
  recommendations?: Array<Record<string, unknown>>;
  anomalies?: Array<Record<string, unknown>>;
  forecasts?: Record<string, unknown>;
}

async function engine(schoolId: string): Promise<{ ok: boolean; payload?: IntelPayload; error?: string }> {
  const res = await getDashboardIntelligence(schoolId);
  if (res.engine !== 'online' || !res.payload) return { ok: false, error: res.error ?? 'engine offline' };
  return { ok: true, payload: res.payload as IntelPayload };
}

const ENGINE_OFFLINE: Omit<ResolvedFacts, 'facts'> = {
  fallbackText:
    'The intelligence engine is offline, so I can’t compute that right now. Start it with `npm run intelligence` and try again — I never invent these numbers.',
  actions: ACTIONS.intelligence.slice(),
  confidence: 0.3,
};

// ────────────────────────────── intent registry ─────────────────────────────

export const INTENTS: IntentDef[] = [
  // ── Attendance ──
  {
    id: 'attendance_below_threshold',
    category: 'attendance',
    description: 'List students whose overall attendance rate is below a percentage (default 75%).',
    keywords: ['below', 'less than', 'under', 'low attendance', 'attendance below', '75', 'poor attendance', 'at risk attendance'],
    resolve: async ({ schoolId, params }) => {
      const pct = num(params.percent ?? params.threshold, 75);
      const rated = (await studentAttendanceRates(schoolId)).filter((s) => s.rate !== null);
      const below = rated.filter((s) => (s.rate as number) < pct).sort((a, b) => (a.rate as number) - (b.rate as number));
      return {
        facts: { thresholdPct: pct, count: below.length, students: below.slice(0, 40) },
        fallbackText: below.length
          ? `${below.length} student(s) are below ${pct}% attendance. Lowest: ${below.slice(0, 5).map((s) => `${s.name} (${s.rate}%${s.className ? `, ${s.className}` : ''})`).join(', ')}.`
          : `No students are below ${pct}% attendance.`,
        actions: [
          ...(below.length
            ? [{ label: `Message ${Math.min(below.length, 20)} famil${below.length === 1 ? 'y' : 'ies'} now`, execute: { kind: 'at-risk-outreach' as const, params: { studentIds: below.slice(0, 20).map((s) => s.id) } } }]
            : []),
          ...ACTIONS.attendance,
        ],
        confidence: rated.length ? 0.95 : 0.5,
      };
    },
  },
  {
    id: 'attendance_absentees_today',
    category: 'attendance',
    description: "List students marked absent on the most recent attendance day (today's absentees).",
    keywords: ["today's absentees", 'absent today', 'who is absent', 'absentees', 'who was absent'],
    resolve: async ({ schoolId }) => {
      const date = await latestAttendanceDate(schoolId);
      const rows = date
        ? await prisma.attendance.findMany({ where: { schoolId, date, status: 'ABSENT' }, include: { student: { include: { class: true } } } })
        : [];
      const list = rows.map((r) => ({ name: r.student.name, className: r.student.class?.name ?? null, rollNo: r.student.rollNo }));
      return {
        facts: { date, count: list.length, absentees: list.slice(0, 50) },
        fallbackText: !date
          ? 'No attendance has been recorded yet.'
          : list.length
            ? `${list.length} student(s) were absent on ${date}: ${list.slice(0, 8).map((s) => s.name).join(', ')}${list.length > 8 ? '…' : ''}.`
            : `No students were marked absent on ${date}.`,
        actions: ACTIONS.attendance.slice(),
        confidence: date ? 0.95 : 0.4,
      };
    },
  },
  {
    id: 'attendance_worst_class',
    category: 'attendance',
    description: 'Identify the class or classes with the lowest attendance rate.',
    keywords: ['worst attendance', 'lowest attendance', 'which class', 'worst class', 'class attendance'],
    resolve: async ({ schoolId }) => {
      const rated = (await studentAttendanceRates(schoolId)).filter((s) => s.rate !== null && s.className);
      const byClass = new Map<string, { present: number; total: number }>();
      for (const s of rated) {
        const e = byClass.get(s.className!) ?? { present: 0, total: 0 };
        e.present += s.present;
        e.total += s.total;
        byClass.set(s.className!, e);
      }
      const ranked = [...byClass.entries()]
        .map(([name, e]) => ({ className: name, rate: e.total ? Math.round((e.present / e.total) * 100) : null }))
        .filter((c) => c.rate !== null)
        .sort((a, b) => (a.rate as number) - (b.rate as number));
      return {
        facts: { classes: ranked, worst: ranked[0] ?? null },
        fallbackText: ranked.length
          ? `Lowest attendance: ${ranked[0].className} at ${ranked[0].rate}%. Best: ${ranked[ranked.length - 1].className} at ${ranked[ranked.length - 1].rate}%.`
          : 'No class attendance data yet.',
        actions: ACTIONS.attendance.slice(),
        confidence: ranked.length ? 0.95 : 0.5,
      };
    },
  },
  {
    id: 'attendance_perfect',
    category: 'attendance',
    description: 'List students with perfect (100%) attendance across the recorded window.',
    keywords: ['perfect attendance', '100%', 'never absent', 'full attendance'],
    resolve: async ({ schoolId }) => {
      const rated = (await studentAttendanceRates(schoolId)).filter((s) => s.total > 0);
      const perfect = rated.filter((s) => s.rate === 100);
      return {
        facts: { count: perfect.length, of: rated.length, students: perfect.slice(0, 50).map((s) => ({ name: s.name, className: s.className })) },
        fallbackText: perfect.length
          ? `${perfect.length} of ${rated.length} students have perfect attendance: ${perfect.slice(0, 8).map((s) => s.name).join(', ')}${perfect.length > 8 ? '…' : ''}.`
          : 'No students currently have perfect attendance.',
        actions: ACTIONS.attendance.slice(),
        confidence: rated.length ? 0.9 : 0.5,
      };
    },
  },

  // ── Fees ──
  {
    id: 'fees_overdue',
    category: 'fees',
    description: 'List overdue / unpaid fee accounts, optionally above a rupee threshold.',
    keywords: ['overdue fee', 'unpaid', "haven't paid", 'not paid', 'pending fee', 'fee due', 'owe'],
    resolve: async ({ schoolId, params }) => {
      const threshold = num(params.threshold, 0);
      const rows = await prisma.fee.findMany({ where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }, include: { student: true } });
      const accounts = rows
        .map((f) => ({ student: f.student.name, due: Math.round(f.amount - f.paid), title: f.title, status: f.status }))
        .filter((a) => a.due > threshold)
        .sort((a, b) => b.due - a.due);
      const total = accounts.reduce((a, r) => a + r.due, 0);
      return {
        facts: { thresholdRupees: threshold, count: accounts.length, totalOutstanding: total, accounts: accounts.slice(0, 40) },
        fallbackText: accounts.length
          ? `${accounts.length} account(s)${threshold ? ` above ${inr(threshold)}` : ''} owe ${inr(total)}. Largest: ${accounts.slice(0, 4).map((a) => `${a.student} ${inr(a.due)}`).join(', ')}.`
          : `No overdue accounts${threshold ? ` above ${inr(threshold)}` : ''}.`,
        actions: [
          ...(accounts.length ? [{ label: 'Send reminders now', execute: { kind: 'fee-reminders' as const } }] : []),
          ...ACTIONS.fees,
        ],
        confidence: 0.95,
      };
    },
  },
  {
    id: 'fees_total_outstanding',
    category: 'fees',
    description: 'Report the total outstanding (unpaid) fee amount across the school.',
    keywords: ['total outstanding', 'total fees', 'how much outstanding', 'total due', 'total unpaid'],
    resolve: async ({ schoolId }) => {
      const rows = await prisma.fee.findMany({ where: { schoolId }, select: { amount: true, paid: true, status: true } });
      const outstanding = rows.reduce((a, f) => a + (f.amount - f.paid), 0);
      const billed = rows.reduce((a, f) => a + f.amount, 0);
      const collected = rows.reduce((a, f) => a + f.paid, 0);
      const openCount = rows.filter((f) => f.status !== 'PAID').length;
      return {
        facts: { outstanding: Math.round(outstanding), billed: Math.round(billed), collected: Math.round(collected), collectionRatePct: billed ? Math.round((collected / billed) * 100) : 100, openAccounts: openCount },
        fallbackText: `${inr(outstanding)} outstanding across ${openCount} open account(s) — ${billed ? Math.round((collected / billed) * 100) : 100}% of billed fees collected.`,
        actions: ACTIONS.fees.slice(),
        confidence: 0.97,
      };
    },
  },
  {
    id: 'fees_unpaid_month',
    category: 'fees',
    description: 'List fee accounts due in a given month (default the latest month with dues) that are unpaid.',
    keywords: ['this month', 'unpaid this month', 'paid this month', 'month fees'],
    resolve: async ({ schoolId, params }) => {
      const rows = await prisma.fee.findMany({ where: { schoolId }, include: { student: true } });
      const month = (typeof params.month === 'string' && params.month) || rows.map((f) => f.dueDate.slice(0, 7)).sort().pop() || '';
      const unpaid = rows
        .filter((f) => f.dueDate.startsWith(month) && f.status !== 'PAID')
        .map((f) => ({ student: f.student.name, due: Math.round(f.amount - f.paid), dueDate: f.dueDate, status: f.status }))
        .sort((a, b) => b.due - a.due);
      return {
        facts: { month, count: unpaid.length, totalDue: unpaid.reduce((a, r) => a + r.due, 0), accounts: unpaid.slice(0, 40) },
        fallbackText: unpaid.length
          ? `${unpaid.length} account(s) due in ${month} are unpaid, totalling ${inr(unpaid.reduce((a, r) => a + r.due, 0))}.`
          : `No unpaid accounts due in ${month}.`,
        actions: ACTIONS.fees.slice(),
        confidence: month ? 0.9 : 0.5,
      };
    },
  },

  // ── Teachers ──
  {
    id: 'teachers_absent',
    category: 'teachers',
    description: 'List teachers marked absent on the most recent date, and whether cover is arranged.',
    keywords: ['teachers absent', 'which teachers are absent', 'staff absent', 'absent teachers'],
    resolve: async ({ schoolId }) => {
      const date = (await prisma.staffAbsence.findFirst({ where: { teacher: { schoolId } }, orderBy: { date: 'desc' }, select: { date: true } }))?.date ?? null;
      const rows = date
        ? await prisma.staffAbsence.findMany({ where: { date, teacher: { schoolId } }, include: { teacher: { include: { user: true } }, substitutions: true } })
        : [];
      const list = rows.map((a) => ({ teacher: a.teacher.user.name, covered: a.substitutions.length > 0 }));
      const uncovered = list.filter((t) => !t.covered);
      return {
        facts: { date, count: list.length, uncovered: uncovered.length, absences: list },
        fallbackText: !date
          ? 'No staff absences are recorded.'
          : list.length
            ? `${list.length} teacher(s) absent on ${date}; ${uncovered.length} still uncovered${uncovered.length ? `: ${uncovered.map((t) => t.teacher).join(', ')}` : ''}.`
            : `No teachers absent on ${date}.`,
        actions: [
          ...(uncovered.length ? [{ label: `Auto-assign cover (${uncovered.length})`, execute: { kind: 'assign-cover' as const, params: date ? { date } : {} } }] : []),
          ...ACTIONS.teachers,
        ],
        confidence: date ? 0.95 : 0.4,
      };
    },
  },
  {
    id: 'teachers_workload',
    category: 'teachers',
    description: 'Rank teachers by weekly teaching load and flag those at or near their cap.',
    keywords: ['highest workload', 'overloaded', 'workload', 'busiest teacher', 'most hours', 'near cap'],
    resolve: async ({ schoolId }) => {
      const teachers = await prisma.teacher.findMany({ where: { schoolId }, include: { user: true } });
      const ranked = teachers
        .map((t) => ({ name: t.user.name, weeklyHours: t.weeklyHours, maxHours: t.maxHours, atCap: t.weeklyHours >= t.maxHours - 1 }))
        .sort((a, b) => b.weeklyHours - a.weeklyHours);
      const overloaded = ranked.filter((t) => t.atCap);
      return {
        facts: { count: ranked.length, overloaded: overloaded.length, teachers: ranked.slice(0, 15) },
        fallbackText: ranked.length
          ? `Highest load: ${ranked.slice(0, 3).map((t) => `${t.name} (${t.weeklyHours}/${t.maxHours}h)`).join(', ')}. ${overloaded.length} teacher(s) at/near cap.`
          : 'No teacher workload data.',
        actions: ACTIONS.teachers.slice(),
        confidence: ranked.length ? 0.95 : 0.5,
      };
    },
  },
  {
    id: 'teachers_substitutes',
    category: 'teachers',
    description: 'Show substitute cover assignments on the most recent date with absences.',
    keywords: ['substitute', 'substitutes', 'cover', 'who is covering', 'replacement teacher'],
    resolve: async ({ schoolId }) => {
      const date = (await prisma.staffAbsence.findFirst({ where: { teacher: { schoolId } }, orderBy: { date: 'desc' }, select: { date: true } }))?.date ?? null;
      const rows = date
        ? await prisma.substitution.findMany({ where: { absence: { date, teacher: { schoolId } } }, include: { subTeacher: { include: { user: true } }, absence: { include: { teacher: { include: { user: true } } } } } })
        : [];
      const list = rows.map((s) => ({ covering: s.subTeacher.user.name, for: s.absence.teacher.user.name, accepted: s.accepted }));
      return {
        facts: { date, count: list.length, substitutions: list },
        fallbackText: !date
          ? 'No absences requiring substitutes.'
          : list.length
            ? `${list.length} substitution(s) on ${date}: ${list.map((s) => `${s.covering} for ${s.for}`).join(', ')}.`
            : `No substitutes assigned on ${date}.`,
        actions: ACTIONS.teachers.slice(),
        confidence: date ? 0.9 : 0.4,
      };
    },
  },

  // ── Timetable ──
  {
    id: 'timetable_today',
    category: 'timetable',
    description: "Summarize today's timetable — periods scheduled per class in the active timetable.",
    keywords: ["today's timetable", 'timetable today', 'schedule today', "today's schedule", 'classes today'],
    resolve: async ({ schoolId }) => {
      const jsDay = new Date().getDay();
      const day = jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1;
      const slots = await prisma.timetableSlot.findMany({
        where: { timetable: { schoolId, active: true }, day },
        include: { class: true, subject: true, teacher: { include: { user: true } } },
        orderBy: [{ classId: 'asc' }, { period: 'asc' }],
      });
      const byClass = new Map<string, number>();
      for (const s of slots) byClass.set(s.class.name, (byClass.get(s.class.name) ?? 0) + 1);
      return {
        facts: { day, totalSlots: slots.length, perClass: [...byClass.entries()].map(([name, periods]) => ({ className: name, periods })) },
        fallbackText: slots.length
          ? `${slots.length} periods scheduled today across ${byClass.size} class(es).`
          : 'No active timetable, or nothing scheduled today.',
        actions: ACTIONS.timetable.slice(),
        confidence: slots.length ? 0.9 : 0.5,
      };
    },
  },
  {
    id: 'timetable_room_conflicts',
    category: 'timetable',
    description: 'Detect rooms double-booked in the same day/period in the active timetable.',
    keywords: ['room conflict', 'conflicts', 'double booked', 'clash', 'room clash'],
    resolve: async ({ schoolId }) => {
      const slots = await prisma.timetableSlot.findMany({
        where: { timetable: { schoolId, active: true }, roomId: { not: null } },
        include: { room: true, class: true },
      });
      const seen = new Map<string, number>();
      const conflicts: { room: string; day: number; period: number }[] = [];
      for (const s of slots) {
        const key = `${s.roomId}-${s.day}-${s.period}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (seen.get(key) === 2) conflicts.push({ room: s.room?.name ?? '?', day: s.day, period: s.period });
      }
      return {
        facts: { count: conflicts.length, conflicts },
        fallbackText: conflicts.length
          ? `${conflicts.length} room conflict(s) detected in the active timetable.`
          : 'No room conflicts — the active timetable is clash-free (enforced at the database level).',
        actions: ACTIONS.timetable.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'timetable_free_rooms',
    category: 'timetable',
    description: 'List rooms that are free (unbooked) in the active timetable during a given day/period, defaulting to now.',
    keywords: ['free room', 'free classroom', 'available room', 'empty room', 'vacant room'],
    resolve: async ({ schoolId, params }) => {
      const jsDay = new Date().getDay();
      const day = num(params.day, jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1);
      const period = num(params.period, 0);
      const [rooms, taken] = await Promise.all([
        prisma.room.findMany({ where: { building: { schoolId } }, select: { name: true } }),
        prisma.timetableSlot.findMany({ where: { timetable: { schoolId, active: true }, day, period, roomId: { not: null } }, select: { roomId: true, room: { select: { name: true } } } }),
      ]);
      const takenNames = new Set(taken.map((t) => t.room?.name));
      const free = rooms.map((r) => r.name).filter((n) => !takenNames.has(n));
      return {
        facts: { day, period, totalRooms: rooms.length, freeCount: free.length, freeRooms: free },
        fallbackText: rooms.length
          ? `${free.length} of ${rooms.length} rooms are free at day ${day}, period ${period + 1}${free.length ? `: ${free.slice(0, 10).join(', ')}` : ''}.`
          : 'No rooms are configured.',
        actions: ACTIONS.timetable.slice(),
        confidence: rooms.length ? 0.85 : 0.5,
      };
    },
  },

  // ── Documents ──
  {
    id: 'documents_review',
    category: 'documents',
    description: 'List documents awaiting human review in Lumen (status REVIEW).',
    keywords: ['pending ocr', 'document', 'documents', 'manual verification', 'verify', 'review queue', 'pending review', 'awaiting review'],
    resolve: async ({ schoolId }) => {
      const docs = await prisma.document.findMany({ where: { schoolId, status: 'REVIEW' }, select: { id: true, overallConfidence: true, correctionCount: true, createdAt: true } });
      return {
        facts: { count: docs.length, documents: docs.map((d) => ({ id: d.id, confidencePct: Math.round(d.overallConfidence * 100), corrections: d.correctionCount })) },
        fallbackText: docs.length
          ? `${docs.length} document(s) await manual review in Lumen.`
          : 'No documents are awaiting review.',
        actions: ACTIONS.documents.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'documents_low_confidence',
    category: 'documents',
    description: 'List documents whose OCR extraction confidence is below a threshold (default 80%).',
    keywords: ['low confidence', 'low-confidence', 'poor extraction', 'unreliable extraction', 'low ocr'],
    resolve: async ({ schoolId, params }) => {
      const pct = num(params.percent ?? params.threshold, 80) / 100;
      const docs = await prisma.document.findMany({ where: { schoolId, overallConfidence: { lt: pct }, status: { not: 'QUEUED' } }, select: { id: true, overallConfidence: true, status: true } });
      const sorted = docs.map((d) => ({ id: d.id, confidencePct: Math.round(d.overallConfidence * 100), status: d.status })).sort((a, b) => a.confidencePct - b.confidencePct);
      return {
        facts: { thresholdPct: Math.round(pct * 100), count: sorted.length, documents: sorted.slice(0, 30) },
        fallbackText: sorted.length
          ? `${sorted.length} document(s) extracted below ${Math.round(pct * 100)}% confidence (lowest ${sorted[0].confidencePct}%).`
          : `No documents below ${Math.round(pct * 100)}% extraction confidence.`,
        actions: ACTIONS.documents.slice(),
        confidence: 0.9,
      };
    },
  },

  // ── Intelligence (Python engine — LLM only explains its JSON) ──
  {
    id: 'intel_why_attendance',
    category: 'intelligence',
    description: 'Explain why attendance changed, using the intelligence engine’s attendance trend insight and its evidence.',
    keywords: ['why did attendance', 'why is attendance', 'attendance drop', 'attendance decline', 'explain attendance'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      const insight = (e.payload!.insights ?? []).find((i) => (i as { id?: string }).id === 'attendance-trend') ?? null;
      return {
        facts: { insight },
        fallbackText: insight
          ? String((insight as { reason?: string }).reason ?? (insight as { title?: string }).title ?? 'Attendance insight available.')
          : 'The engine reported no significant attendance trend.',
        actions: ACTIONS.intelligence.slice(),
        confidence: insight ? num((insight as { confidence?: { value?: number } }).confidence?.value, 60) / 100 : 0.6,
      };
    },
  },
  {
    id: 'intel_trends',
    category: 'intelligence',
    description: 'Summarize attendance/operational trends and forecasts from the intelligence engine.',
    keywords: ['trend', 'trends', 'forecast', 'tomorrow', 'predict', 'projection'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      return {
        facts: { forecasts: e.payload!.forecasts ?? {}, attendanceInsight: (e.payload!.insights ?? []).find((i) => (i as { id?: string }).id === 'attendance-trend') ?? null },
        fallbackText: 'Forecasts and trend evidence retrieved from the intelligence engine.',
        actions: ACTIONS.intelligence.slice(),
        confidence: 0.8,
      };
    },
  },
  {
    id: 'intel_top_recommendation',
    category: 'intelligence',
    description: 'Explain the engine’s highest-priority recommended action and why it ranks first.',
    keywords: ['top recommendation', 'what should i do', 'biggest issue', 'most important', 'priority action', 'what needs my attention'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      const recs = e.payload!.recommendations ?? [];
      return {
        facts: { top: recs[0] ?? null, alsoRanked: recs.slice(1, 3) },
        fallbackText: recs.length ? String((recs[0] as { title?: string }).title ?? 'Top action identified.') : 'No actions currently cross the evidence thresholds.',
        actions: ACTIONS.intelligence.slice(),
        confidence: recs.length ? 0.85 : 0.6,
      };
    },
  },
  {
    id: 'intel_anomalies',
    category: 'intelligence',
    description: 'Report anomalies (unusual patterns) flagged by the intelligence engine.',
    keywords: ['anomaly', 'anomalies', 'unusual', 'outlier', 'strange pattern', 'flagged'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      const anomalies = e.payload!.anomalies ?? [];
      return {
        facts: { count: anomalies.length, anomalies },
        fallbackText: anomalies.length
          ? `${anomalies.length} unusual pattern(s) flagged: ${anomalies.slice(0, 3).map((a) => (a as { entity?: string }).entity).join(', ')}.`
          : 'No anomalies crossed the detection threshold.',
        actions: ACTIONS.intelligence.slice(),
        confidence: 0.85,
      };
    },
  },
  {
    id: 'intel_at_risk',
    category: 'intelligence',
    description: 'Identify students at risk — combining low attendance and overdue fees from real records.',
    keywords: ['at risk', 'at-risk', 'which students are at risk', 'risk students', 'struggling students'],
    resolve: async ({ schoolId }) => {
      const [rated, fees] = await Promise.all([
        studentAttendanceRates(schoolId),
        prisma.fee.findMany({ where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }, select: { studentId: true, amount: true, paid: true } }),
      ]);
      const dueByStudent = new Map<string, number>();
      for (const f of fees) dueByStudent.set(f.studentId, (dueByStudent.get(f.studentId) ?? 0) + (f.amount - f.paid));
      const risk = rated
        .filter((s) => s.rate !== null)
        .map((s) => ({ id: s.id, name: s.name, className: s.className, attendancePct: s.rate, feesDue: Math.round(dueByStudent.get(s.id) ?? 0) }))
        .filter((s) => (s.attendancePct as number) < 75 || s.feesDue > 0)
        .map((s) => ({ ...s, reasons: [(s.attendancePct as number) < 75 ? `attendance ${s.attendancePct}%` : null, s.feesDue > 0 ? `fees ${inr(s.feesDue)}` : null].filter(Boolean) }))
        .sort((a, b) => b.reasons.length - a.reasons.length || (a.attendancePct as number) - (b.attendancePct as number));
      const both = risk.filter((s) => s.reasons.length === 2);
      return {
        facts: { criteria: 'attendance < 75% OR outstanding fees', count: risk.length, bothFactors: both.length, students: risk.slice(0, 30).map(({ id: _id, ...rest }) => rest) },
        fallbackText: risk.length
          ? `${risk.length} student(s) show a risk signal; ${both.length} have both low attendance and overdue fees${both.length ? `: ${both.slice(0, 5).map((s) => s.name).join(', ')}` : ''}.`
          : 'No students currently show attendance or fee risk signals.',
        actions: [
          ...(risk.length
            ? [
                { label: `Message ${Math.min(risk.length, 20)} famil${risk.length === 1 ? 'y' : 'ies'}`, execute: { kind: 'at-risk-outreach' as const, params: { studentIds: risk.slice(0, 20).map((s) => s.id) } } },
                ...(both.length ? [{ label: `Flag ${both.length} for counselling`, execute: { kind: 'counselling-flag' as const, params: { studentIds: both.slice(0, 20).map((s) => s.id) } } }] : []),
              ]
            : []),
          ...ACTIONS.intelligence,
        ],
        confidence: rated.length ? 0.85 : 0.5,
      };
    },
  },
  {
    id: 'intel_health_summary',
    category: 'intelligence',
    description: 'Summarize the computed operational health score and its category breakdown.',
    keywords: ['health', 'health summary', 'school health', 'overall health', 'how is the school'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      return {
        facts: { healthScore: e.payload!.healthScore ?? null },
        fallbackText: e.payload!.healthScore?.overall != null ? `Operational health is ${e.payload!.healthScore.overall}/100 (weighted across attendance, finance, staffing, operations, timetable and documents).` : 'Health score unavailable.',
        actions: ACTIONS.intelligence.slice(),
        confidence: 0.9,
      };
    },
  },

  // ── Emergency (Trust Core) ──
  {
    id: 'emergency_status',
    category: 'intelligence',
    description: 'Report the active emergency: type, when it started, who activated it, and whether attendance/timetable are locked.',
    keywords: ['emergency status', 'active incident', 'active emergency', 'is there an emergency', 'when was the incident', 'who activated', 'attendance locked', 'timetable resumed', 'timetable paused', 'is attendance locked'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency. Attendance and timetable editing are unlocked.', actions: ACTIONS.emergency.slice(), confidence: 0.95 };
      return {
        facts: { active: true, incident: s.incident, locks: s.locks },
        fallbackText: `${s.incident.title} is ACTIVE — activated by ${s.incident.triggeredBy ?? 'staff'} at ${new Date(s.incident.createdAt).toLocaleTimeString('en-IN')}. Attendance and timetable editing are locked until it is resolved.`,
        actions: ACTIONS.emergency.slice(),
        confidence: 0.97,
      };
    },
  },
  {
    id: 'emergency_teachers_pending',
    category: 'intelligence',
    description: 'List teachers who have not yet acknowledged / reported class status during the active emergency.',
    keywords: ["teachers haven't acknowledged", 'teachers pending', 'who has not acknowledged', 'pending teachers', 'not confirmed', 'awaiting teachers'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency.', actions: ACTIONS.emergency.slice(), confidence: 0.9 };
      return {
        facts: { total: s.teachers.total, safe: s.teachers.safe, needAssistance: s.teachers.needAssistance, pending: s.teachers.pending, pendingTeachers: s.teachers.pendingList },
        fallbackText: s.teachers.pending
          ? `${s.teachers.pending} of ${s.teachers.total} teachers have not acknowledged: ${s.teachers.pendingList.slice(0, 8).map((t) => t.name).join(', ')}${s.teachers.pending > 8 ? '…' : ''}.`
          : `All ${s.teachers.total} teachers have reported in.`,
        actions: ACTIONS.emergency.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'emergency_need_assistance',
    category: 'intelligence',
    description: 'List teachers or classes that reported Need Assistance during the active emergency.',
    keywords: ['need assistance', 'requesting assistance', 'need help', 'requesting help', 'assistance'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency.', actions: ACTIONS.emergency.slice(), confidence: 0.9 };
      return {
        facts: { count: s.needAssistanceList.length, list: s.needAssistanceList },
        fallbackText: s.needAssistanceList.length
          ? `${s.needAssistanceList.length} reporting Need Assistance: ${s.needAssistanceList.map((a) => `${a.teacher} (${a.className ?? 'class'})`).join(', ')}.`
          : 'No teacher has requested assistance.',
        actions: ACTIONS.emergency.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'emergency_classes_pending',
    category: 'intelligence',
    description: 'Show which classes still need confirmation (no Safe/Need-Assistance report) in the active emergency.',
    keywords: ['classes still need', 'which classes', 'classes pending', 'class status', 'classes not confirmed', 'unconfirmed classes'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency.', actions: ACTIONS.emergency.slice(), confidence: 0.9 };
      const pending = s.classStatuses.filter((c) => c.status === 'PENDING');
      const need = s.classStatuses.filter((c) => c.status === 'NEED_ASSISTANCE');
      return {
        facts: { pending: pending.map((c) => c.name), needAssistance: need.map((c) => c.name), safe: s.classStatuses.filter((c) => c.status === 'SAFE').length, classes: s.classStatuses },
        fallbackText: pending.length
          ? `${pending.length} class(es) still pending: ${pending.map((c) => c.name).join(', ')}.${need.length ? ` ${need.length} need assistance: ${need.map((c) => c.name).join(', ')}.` : ''}`
          : `All classes have reported.${need.length ? ` ${need.length} need assistance.` : ' All safe.'}`,
        actions: ACTIONS.emergency.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'emergency_parents',
    category: 'intelligence',
    description: 'Report how many parents have acknowledged the active emergency.',
    keywords: ['parents acknowledged', 'how many parents', 'parent acknowledgement', 'parents waiting', 'parents informed'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency.', actions: ACTIONS.emergency.slice(), confidence: 0.9 };
      return {
        facts: { total: s.parents.total, acknowledged: s.parents.acknowledged, needInfo: s.parents.needInfo, waiting: s.parents.waiting, acknowledgedPct: s.parents.acknowledgedPct },
        fallbackText: `${s.parents.acknowledged} of ${s.parents.total} parents acknowledged (${s.parents.acknowledgedPct}%); ${s.parents.waiting} still waiting${s.parents.needInfo ? `, ${s.parents.needInfo} requested information` : ''}.`,
        actions: ACTIONS.emergency.slice(),
        confidence: 0.95,
      };
    },
  },
  {
    id: 'emergency_timeline',
    category: 'intelligence',
    description: 'Show the timeline of the active emergency incident.',
    keywords: ['incident timeline', 'emergency timeline', 'show timeline', 'what happened', 'incident log'],
    resolve: async ({ schoolId }) => {
      const s = await activeEmergencyState(schoolId);
      if (!s) return { facts: { active: false }, fallbackText: 'There is no active emergency.', actions: ACTIONS.emergency.slice(), confidence: 0.9 };
      return {
        facts: { timeline: s.timeline.map((e) => ({ at: e.at, message: e.message })) },
        fallbackText: `${s.timeline.length} timeline events. Latest: ${s.timeline.slice(-1)[0]?.message ?? '—'}.`,
        actions: ACTIONS.emergency.slice(),
        confidence: 0.95,
      };
    },
  },

  // ── General ──
  {
    id: 'general_attention',
    category: 'general',
    description: 'Summarize what needs the principal’s attention today — top recommendations and warning insights.',
    keywords: ['what needs my attention', 'attention today', 'what should i look at', "what's important", 'priorities today'],
    resolve: async ({ schoolId }) => {
      const e = await engine(schoolId);
      if (!e.ok) return { facts: { engine: 'offline' }, ...ENGINE_OFFLINE };
      const recs = (e.payload!.recommendations ?? []).slice(0, 3);
      const warnings = (e.payload!.insights ?? []).filter((i) => ['CRITICAL', 'WARNING'].includes(String((i as { severity?: string }).severity)));
      return {
        facts: { topActions: recs, warningInsights: warnings.slice(0, 4) },
        fallbackText: recs.length ? `Top priorities: ${recs.map((r) => (r as { title?: string }).title).join('; ')}.` : 'Nothing crosses the attention thresholds right now.',
        actions: ACTIONS.general.slice(),
        confidence: 0.85,
      };
    },
  },
  {
    id: 'general_report',
    category: 'general',
    description: 'Produce a concise operational report: roll of the school, attendance, fees and computed health.',
    keywords: ['operational report', 'summary', 'pta', 'overview', "today's report", 'brief me', 'report'],
    resolve: async ({ schoolId }) => {
      const [students, teachers, classes, fees, e] = await Promise.all([
        prisma.student.count({ where: { schoolId, active: true } }),
        prisma.teacher.count({ where: { schoolId } }),
        prisma.class.count({ where: { schoolId } }),
        prisma.fee.findMany({ where: { schoolId }, select: { amount: true, paid: true, status: true } }),
        engine(schoolId),
      ]);
      const outstanding = Math.round(fees.reduce((a, f) => a + (f.amount - f.paid), 0));
      const openAccounts = fees.filter((f) => f.status !== 'PAID').length;
      return {
        facts: {
          roll: { students, teachers, classes },
          fees: { outstanding, openAccounts },
          health: e.ok ? e.payload!.healthScore?.overall ?? null : null,
          engineOnline: e.ok,
        },
        fallbackText: `${students} students, ${teachers} staff, ${classes} classes. Outstanding fees ${inr(outstanding)} across ${openAccounts} account(s).${e.ok && e.payload!.healthScore?.overall != null ? ` Operational health ${e.payload!.healthScore.overall}/100.` : ''}`,
        actions: ACTIONS.general.slice(),
        confidence: 0.9,
      };
    },
  },
];

// Deterministic keyword classifier — used when OpenAI is unavailable or returns
// an unknown intent. Scores each intent by keyword hits; ties break by order.
export function keywordClassify(question: string): { intent: string; params: Record<string, unknown> } {
  const q = question.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const intent of INTENTS) {
    let score = 0;
    for (const kw of intent.keywords) if (q.includes(kw)) score += kw.length; // longer phrase = stronger signal
    if (score > 0 && (!best || score > best.score)) best = { id: intent.id, score };
  }
  return { intent: best?.id ?? 'unknown', params: extractParams(q) };
}

// Pull obvious numeric params so the deterministic path handles "below 80%"
// and "above ₹10,000" without the LLM.
export function extractParams(q: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const percent = q.match(/(\d{1,3})\s*%/);
  if (percent) params.percent = Number(percent[1]);
  const rupees = q.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i) || q.match(/above\s+([\d,]+)/i) || q.match(/over\s+([\d,]+)/i);
  if (rupees) params.threshold = Number(rupees[1].replace(/,/g, ''));
  return params;
}

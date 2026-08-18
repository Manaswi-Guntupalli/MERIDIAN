import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { UserX, AlertTriangle, CheckCircle2, MinusCircle, CircleDashed, Undo2, X, Zap } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Badge, EmptyState, Spinner, SkeletonRows } from '@/components/ui';
import { Table, CellIdentity } from '@/components/ui/Table';
import { initials, cn } from '@/lib/utils';
import type { TeacherRow } from '@/types';

interface CascadeStep {
  key: string;
  label: string;
  detail: string;
  status: 'DONE' | 'PARTIAL' | 'SKIPPED';
  at: string;
}
interface CascadeResult {
  ok: boolean;
  eventId: string | null;
  teacher: { id: string; name: string };
  date: string;
  steps: CascadeStep[];
  covered: number;
  uncovered: number;
  freedRooms: { period: number; room: string; className: string; subject: string }[];
  notified: { substitutes: number; familyUsers: number };
}

export default function Staff() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: async () => (await api.get('/staff')).data.teachers as TeacherRow[] });
  const [cascade, setCascade] = useState<CascadeResult | null>(null);
  const [undone, setUndone] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['staff'] });
    qc.invalidateQueries({ queryKey: ['intelligence'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  // ── The live cascade: one call → absence, auto-cover, freed rooms,
  //    notifications, reversible ledger event. The modal replays the real
  //    executed steps (server timestamps, not an animation script). ──
  const runCascade = useMutation({
    mutationFn: async (teacherId: string) =>
      (await api.post('/staff/absence/cascade', { teacherId, date: new Date().toISOString().slice(0, 10) })).data as CascadeResult,
    onSuccess: (res) => {
      setUndone(false);
      setCascade(res);
      refresh();
    },
    onError: (e) => pushToast({ title: 'Cascade failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  const undo = useMutation({
    mutationFn: async (eventId: string) => (await api.post('/staff/absence/undo', { eventId })).data,
    onSuccess: (res) => {
      setUndone(true);
      pushToast({
        title: 'Cascade undone',
        body: `${res.substitutionsRemoved} substitution(s) removed; ${res.substitutesInformed} substitute(s) informed of the correction.`,
        severity: 'SUCCESS',
      });
      refresh();
    },
    onError: (e) => pushToast({ title: 'Undo failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (isLoading) {
    return (
      <div className="surface overflow-hidden">
        <SkeletonRows rows={8} />
      </div>
    );
  }
  const overloaded = data?.filter((t) => t.overloaded).length ?? 0;

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Staff"
        subtitle="Mark a teacher absent and watch the cascade: cover assigned, rooms updated, families notified — one reversible action."
        actions={overloaded > 0 && <Badge severity="WARNING"><AlertTriangle className="h-3.5 w-3.5" /> {overloaded} near cap</Badge>}
      />

      <Table
        rows={data ?? []}
        rowKey={(t) => t.id}
        empty={<EmptyState title="No staff yet" />}
        columns={[
          { key: 'name', header: 'Teacher', cell: (t) => <CellIdentity initials={initials(t.name)} title={t.name} sub={t.employeeId} /> },
          { key: 'dept', header: 'Department', cell: (t) => <span className="text-slate-600">{t.department}</span> },
          {
            key: 'subjects',
            header: 'Teaches',
            cell: (t) => (
              <div className="flex flex-wrap gap-1">
                {t.subjects.map((s) => <span key={s} className="rounded border border-line bg-ink-800 px-1.5 py-px text-[0.68rem] font-medium text-slate-500">{s}</span>)}
                {t.classesLed.map((c) => <span key={c} className="rounded border border-brand-200 bg-brand-50 px-1.5 py-px text-[0.68rem] font-semibold text-brand-700">{c}</span>)}
              </div>
            ),
          },
          {
            key: 'load',
            header: 'Weekly load',
            width: '190px',
            cell: (t) => (
              <div className="flex items-center gap-2.5">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className={cn('h-full rounded-full', t.overloaded ? 'bg-rose-400' : t.load > 80 ? 'bg-amber-400' : 'bg-brand-500')}
                    style={{ width: `${Math.min(100, t.load)}%` }}
                  />
                </div>
                <span className={cn('tnum text-[0.75rem] font-semibold', t.overloaded ? 'text-rose-400' : 'text-slate-500')}>
                  {t.weeklyHours}/{t.maxHours}h
                </span>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            width: '100px',
            cell: (t) => (t.overloaded ? <Badge severity="WARNING">at cap</Badge> : <Badge severity="SUCCESS">balanced</Badge>),
          },
          {
            key: 'action',
            header: '',
            align: 'right',
            width: '150px',
            cell: (t) => (
              <button
                onClick={() => runCascade.mutate(t.id)}
                disabled={runCascade.isPending}
                className="btn-ghost !px-2.5 !py-1 text-[0.72rem]"
                title="Marks absent for today and runs the full cover cascade"
              >
                {runCascade.isPending ? <Spinner /> : <UserX className="h-3.5 w-3.5" />} Absent → cascade
              </button>
            ),
          },
        ]}
      />

      {/* ── Cascade timeline — the 30-second proof ── */}
      <AnimatePresence>
        {cascade && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm"
            onClick={() => setCascade(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white"><Zap className="h-4 w-4" /></span>
                  <div>
                    <h3 className="font-bold text-slate-900">The cascade ran</h3>
                    <p className="text-[0.72rem] text-slate-500">{cascade.teacher.name} · {cascade.date} · every step below actually executed</p>
                  </div>
                </div>
                <button onClick={() => setCascade(null)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-0">
                {cascade.steps.map((s, i) => (
                  <motion.div
                    key={s.key}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.35 }}
                    className="relative flex gap-3 pb-4"
                  >
                    {i < cascade.steps.length - 1 && <span className="absolute left-[9px] top-6 h-full w-px bg-line" />}
                    <span className="relative z-10 mt-0.5 shrink-0">
                      {s.status === 'DONE' ? (
                        <CheckCircle2 className="h-[18px] w-[18px] text-mint-500" />
                      ) : s.status === 'PARTIAL' ? (
                        <MinusCircle className="h-[18px] w-[18px] text-amber-500" />
                      ) : (
                        <CircleDashed className="h-[18px] w-[18px] text-slate-300" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {s.label}
                        <span className="ml-2 text-[0.62rem] font-normal text-slate-400">{new Date(s.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.detail}</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + cascade.steps.length * 0.35 }}
                className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line bg-ink-800/40 px-3.5 py-2.5"
              >
                <div className="text-xs text-slate-500">
                  <b className="text-slate-700">{cascade.covered}</b> covered · <b className="text-slate-700">{cascade.uncovered}</b> uncovered ·{' '}
                  <b className="text-slate-700">{cascade.notified.familyUsers}</b> family member(s) notified
                </div>
                {cascade.eventId && !undone ? (
                  <button onClick={() => undo.mutate(cascade.eventId!)} disabled={undo.isPending} className="btn-ghost !py-1.5 text-xs">
                    <Undo2 className="h-3.5 w-3.5" /> {undo.isPending ? 'Undoing…' : 'Undo everything'}
                  </button>
                ) : undone ? (
                  <Badge severity="INFO">Undone — timetable restored</Badge>
                ) : null}
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

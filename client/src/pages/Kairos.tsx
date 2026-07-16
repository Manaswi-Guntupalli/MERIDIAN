import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarClock, Zap, AlertTriangle, Wand2, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, Spinner, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Timetable, Conflict, ClassRow, TeacherRow } from '@/types';

export default function Kairos() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const user = useAuth((s) => s.user)!;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);
  const [classId, setClassId] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [solveInfo, setSolveInfo] = useState<{ score: number; solveMs: number; placed: number } | null>(null);
  const [whatIf, setWhatIf] = useState<any>(null);

  const tt = useQuery({ queryKey: ['timetable'], queryFn: async () => (await api.get('/timetable')).data.timetable as Timetable | null });
  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  const staff = useQuery({ queryKey: ['staff'], queryFn: async () => (await api.get('/staff')).data.teachers as TeacherRow[] });

  const solve = useMutation({
    mutationFn: async () => (await api.post('/timetable/solve', { persist: true })).data,
    onSuccess: (res) => {
      setConflicts(res.conflicts);
      setSolveInfo({ score: res.score, solveMs: res.solveMs, placed: res.placed });
      qc.invalidateQueries({ queryKey: ['timetable'] });
      pushToast({ title: 'Solved', body: `${res.placed} slots · ${res.conflicts.length} conflicts · ${res.solveMs}ms`, severity: res.conflicts.length ? 'WARNING' : 'SUCCESS' });
    },
  });

  const simulate = useMutation({
    mutationFn: async (teacherId: string) => (await api.post('/timetable/what-if', { teacherId })).data,
    onSuccess: (res) => setWhatIf(res),
  });

  const activeClass = classId || classes.data?.[0]?.id;
  const slots = tt.data?.slots.filter((s) => s.classId === activeClass) ?? [];
  const days = tt.data?.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const periods = tt.data?.periods ?? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const cell = (d: number, p: number) => slots.find((s) => s.day === d && s.period === p);

  return (
    <div>
      <PageHeader
        overline="Engine 02 · Kairos"
        title="A timetable that explains itself"
        subtitle="CP-style feasibility + soft refine. When a perfect fit is impossible, Kairos tells you exactly which rule to bend."
        actions={
          <div className="flex gap-2">
            <select value={activeClass} onChange={(e) => setClassId(e.target.value)} className="input w-28">
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {isAdmin && (
              <button onClick={() => solve.mutate()} disabled={solve.isPending} className="btn-primary">
                {solve.isPending ? <Spinner /> : <><Zap className="h-4 w-4" /> Solve</>}
              </button>
            )}
          </div>
        }
      />

      {(solveInfo || tt.data) && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge severity="INFO"><CalendarClock className="h-3.5 w-3.5" /> Score {solveInfo?.score ?? tt.data?.score ?? 0}/100</Badge>
          {solveInfo && <Badge>{solveInfo.solveMs}ms solve</Badge>}
          {solveInfo && <Badge>{solveInfo.placed} slots placed</Badge>}
          {conflicts.length > 0 && <Badge severity="CRITICAL"><AlertTriangle className="h-3.5 w-3.5" /> {conflicts.length} conflicts</Badge>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tt.isLoading ? <LoadingScreen /> : tt.data ? (
            <Card className="!p-3 overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
                  <div />
                  {days.map((d) => <div key={d} className="pb-2 text-center text-xs font-bold uppercase tracking-wider text-slate-500">{d}</div>)}
                  {periods.map((pLabel, p) => (
                    <Fragment key={`p-${p}`}>
                      <div className="flex items-center justify-center text-[0.65rem] font-semibold text-slate-600">{pLabel}</div>
                      {days.map((_, d) => {
                        const c = cell(d, p);
                        return (
                          <motion.div key={`${d}-${p}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (d + p) * 0.01 }} className="p-1">
                            {c ? (
                              <div className="h-full rounded-lg border p-1.5 text-[0.65rem] leading-tight" style={{ borderColor: `${c.subjectColor}55`, background: `${c.subjectColor}18` }}>
                                <div className="font-bold text-white">{c.subject}</div>
                                <div className="truncate text-slate-400">{c.teacher.split(' ').slice(-1)}</div>
                                {c.room && <div className="text-slate-600">{c.room}</div>}
                              </div>
                            ) : <div className="grid h-full min-h-[52px] place-items-center rounded-lg border border-dashed border-white/5 text-slate-700">·</div>}
                          </motion.div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </Card>
          ) : <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="No timetable yet" hint="Hit Solve to generate one." />}

          {/* What-if simulation */}
          <Card className="mt-6">
            <div className="mb-3 flex items-center gap-2"><Wand2 className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">What-if: teacher out today</h2></div>
            <div className="flex flex-wrap gap-2">
              {staff.data?.slice(0, 6).map((t) => (
                <button key={t.id} onClick={() => simulate.mutate(t.id)} className="chip glass-hover hover:!text-white">{t.name}</button>
              ))}
            </div>
            <AnimatePresence>
              {whatIf && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 overflow-hidden">
                  <div className="text-sm text-slate-400">Re-optimised <span className="font-bold text-white">{whatIf.affectedCount}</span> affected cells only:</div>
                  <div className="mt-2 space-y-1.5">
                    {whatIf.suggestions.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
                        <Badge>{s.className}</Badge>
                        <span className="text-slate-400">{s.subject}</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="font-semibold text-mint-400">{s.suggestedTeacher}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>

        {/* Explainable conflicts */}
        <div>
          <h2 className="mb-3 font-bold text-white">Explainable conflicts</h2>
          {conflicts.length === 0 ? (
            <Card className="text-center text-sm text-slate-500">
              {solveInfo ? '✓ No conflicts — every class placed.' : 'Run Solve to surface the minimal unsatisfiable core and cheapest fixes.'}
            </Card>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
                  <Card className="!border-rose-400/20 !bg-rose-500/[0.04]">
                    <div className="flex items-start gap-2">
                      <span className="text-rose-400">✕</span>
                      <div className="text-sm font-bold text-white">{c.reason}</div>
                    </div>
                    <div className="mt-1 pl-5 font-mono text-xs text-slate-500">cause: {c.cause}</div>
                    <div className="mt-3 space-y-1.5 pl-5">
                      {c.fixes.map((f, j) => (
                        <div key={j} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 text-mint-400">→</span>
                          <div><span className="font-semibold text-mint-400">{f.label}</span><span className="text-slate-500"> · {f.detail}</span></div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

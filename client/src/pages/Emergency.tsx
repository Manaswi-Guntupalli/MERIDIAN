import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Waves, HeartPulse, Lock, ShieldAlert, Send, CheckCircle2, Users, Bell, Clock, Timer, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, Spinner, LoadingScreen } from '@/components/ui';
import { cn } from '@/lib/utils';

const KINDS = [
  { kind: 'FIRE', icon: Flame, tone: 'from-rose-500 to-amber-500', desc: 'Evacuate to assembly ground' },
  { kind: 'EARTHQUAKE', icon: Waves, tone: 'from-amber-500 to-yellow-500', desc: 'Drop, cover, hold' },
  { kind: 'MEDICAL', icon: HeartPulse, tone: 'from-rose-500 to-pink-500', desc: 'Dispatch medical team' },
  { kind: 'LOCKDOWN', icon: Lock, tone: 'from-brand-500 to-indigo-500', desc: 'Secure all rooms' },
];

interface IncidentState {
  incident: { id: string; kind: string; title: string; instruction: string; status: string; triggeredBy?: string; createdAt: string };
  teachers: { total: number; safe: number; needAssistance: number; pending: number; pendingList: { name: string; className: string | null }[] };
  parents: { total: number; acknowledged: number; needInfo: number; waiting: number; acknowledgedPct: number };
  classStatuses: { classId: string; name: string; status: 'SAFE' | 'PENDING' | 'NEED_ASSISTANCE' }[];
  needAssistanceList: { teacher: string; className: string | null; note?: string | null; at: string }[];
  timeline: { id: string; type: string; message: string; actorName?: string | null; at: string }[];
  locks: { attendance: boolean; timetable: boolean };
}

function useElapsed(since?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return '00:00';
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function Emergency() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);
  const { pushToast } = useUI();
  const [confirm, setConfirm] = useState<string | null>(null);

  const active = useQuery({ queryKey: ['emergency'], queryFn: async () => (await api.get('/emergency/active')).data.active as { id: string; kind: string } | null });

  const state = useQuery({
    queryKey: ['emergency-state', active.data?.id],
    queryFn: async () => (await api.get(`/emergency/${active.data!.id}/state`)).data as IncidentState,
    enabled: !!active.data?.id && isAdmin,
    refetchInterval: 5000,
  });

  const trigger = useMutation({
    mutationFn: async (kind: string) => (await api.post('/emergency/trigger', { kind })).data,
    onSuccess: (res) => { pushToast({ title: `🚨 ${res.incident.kind} activated`, body: 'Everyone alerted · attendance & timetable frozen', severity: 'CRITICAL' }); qc.invalidateQueries({ queryKey: ['emergency'] }); setConfirm(null); },
  });
  const resolve = useMutation({
    mutationFn: async (id: string) => api.post(`/emergency/resolve/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emergency'] }); pushToast({ title: 'All clear', body: 'Attendance & timetable unlocked', severity: 'SUCCESS' }); },
  });

  const elapsed = useElapsed(state.data?.incident.createdAt);

  return (
    <div>
      <PageHeader overline="Trust Core" title="Emergency Coordination" subtitle="One button alerts every teacher, parent and administrator, freezes attendance & timetable, and coordinates the response — every action audited." />

      {/* ── Active-incident command dashboard (admins) ── */}
      <AnimatePresence>
        {active.data && isAdmin && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 space-y-4">
            {state.isLoading || !state.data ? (
              <Card className="!border-rose-400/40 !bg-rose-500/10"><LoadingScreen label="Loading incident…" /></Card>
            ) : (
              <>
                <Card className="!border-rose-400/40 !bg-rose-500/10">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="grid h-12 w-12 shrink-0 animate-pulseGlow place-items-center rounded-xl bg-rose-500/30 text-rose-300"><ShieldAlert className="h-6 w-6" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-bold text-rose-200">{state.data.incident.title} · ACTIVE</div>
                      <div className="text-sm text-rose-200/80">{state.data.incident.instruction}</div>
                      <div className="mt-0.5 text-xs text-rose-200/60">Activated by {state.data.incident.triggeredBy ?? 'staff'} · {new Date(state.data.incident.createdAt).toLocaleTimeString('en-IN')}</div>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 px-3 py-2 text-rose-100"><Timer className="h-4 w-4" /><span className="tnum text-lg font-bold">{elapsed}</span></div>
                    <button onClick={() => resolve.mutate(state.data!.incident.id)} disabled={resolve.isPending} className="btn-ghost !border-rose-400/40 !text-rose-200 hover:!bg-rose-500/20"><CheckCircle2 className="h-4 w-4" /> Resolve incident</button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge severity={state.data.locks.attendance ? 'CRITICAL' : 'SUCCESS'}>Attendance {state.data.locks.attendance ? 'locked' : 'unlocked'}</Badge>
                    <Badge severity={state.data.locks.timetable ? 'CRITICAL' : 'SUCCESS'}>Timetable {state.data.locks.timetable ? 'paused' : 'live'}</Badge>
                    <Badge severity="INFO"><ShieldCheck className="h-3 w-3" /> Every action audited</Badge>
                  </div>
                </Card>

                {/* Live counters */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Counter label="Teachers safe" value={`${state.data.teachers.safe}/${state.data.teachers.total}`} tone="text-mint-500" icon={<CheckCircle2 className="h-4 w-4" />} />
                  <Counter label="Need assistance" value={state.data.teachers.needAssistance} tone="text-amber-500" icon={<TriangleAlert className="h-4 w-4" />} />
                  <Counter label="Teachers pending" value={state.data.teachers.pending} tone="text-rose-500" icon={<Clock className="h-4 w-4" />} />
                  <Counter label="Parents acknowledged" value={`${state.data.parents.acknowledgedPct}%`} tone="text-cyan-500" icon={<Users className="h-4 w-4" />} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Teacher acknowledgements */}
                  <Card>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-bold text-slate-900">Teacher acknowledgements</h2>
                      <span className="text-xs text-slate-500">{state.data.teachers.total - state.data.teachers.pending}/{state.data.teachers.total} reported</span>
                    </div>
                    {state.data.needAssistanceList.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        {state.data.needAssistanceList.map((a) => (
                          <div key={a.teacher} className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
                            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                            <span className="font-semibold text-slate-900">{a.teacher}</span>
                            <span className="text-slate-500">{a.className ?? ''} · needs assistance</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Pending ({state.data.teachers.pending})</div>
                    {state.data.teachers.pendingList.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {state.data.teachers.pendingList.map((t) => (
                          <span key={t.name} className="rounded-lg border border-line bg-ink-800/60 px-2 py-1 text-xs text-slate-600">{t.name}{t.className ? ` · ${t.className}` : ''}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-mint-600">Everyone has reported in ✓</div>
                    )}
                  </Card>

                  {/* Parent acknowledgements */}
                  <Card>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-bold text-slate-900">Parent acknowledgements</h2>
                      <span className="text-xs text-slate-500">{state.data.parents.acknowledged}/{state.data.parents.total}</span>
                    </div>
                    <div className="mb-2 h-2.5 overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${state.data.parents.acknowledgedPct}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Mini label="Acknowledged" value={state.data.parents.acknowledged} tone="text-mint-600" />
                      <Mini label="Need info" value={state.data.parents.needInfo} tone="text-amber-600" />
                      <Mini label="Waiting" value={state.data.parents.waiting} tone="text-slate-500" />
                    </div>
                  </Card>
                </div>

                {/* Class status grid */}
                <Card>
                  <h2 className="mb-3 font-bold text-slate-900">Class status <span className="text-xs font-normal text-slate-400">· derived from class-teacher reports</span></h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {state.data.classStatuses.map((c) => (
                      <div key={c.classId} className={cn('flex items-center justify-between rounded-xl border px-3 py-2.5', c.status === 'SAFE' ? 'border-mint-400/40 bg-mint-400/10' : c.status === 'NEED_ASSISTANCE' ? 'border-amber-400/40 bg-amber-400/10' : 'border-line bg-ink-800/40')}>
                        <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                        <Badge severity={c.status === 'SAFE' ? 'SUCCESS' : c.status === 'NEED_ASSISTANCE' ? 'WARNING' : 'INFO'}>{c.status === 'SAFE' ? 'Safe' : c.status === 'NEED_ASSISTANCE' ? 'Assist' : 'Pending'}</Badge>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Incident timeline */}
                <Card className="!p-0">
                  <div className="flex items-center gap-2 border-b border-line px-5 py-4"><ScrollText className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-slate-900">Incident timeline</h2><span className="ml-auto text-xs text-slate-400">immutable audit trail</span></div>
                  <div className="max-h-80 overflow-y-auto no-scrollbar p-3">
                    {state.data.timeline.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5">
                        <span className="tnum mt-0.5 shrink-0 text-xs font-semibold text-slate-400">{new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        <span className="text-sm text-slate-700">{e.message}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Trigger grid (hidden while an incident is active) ── */}
      {!active.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KINDS.map((k, i) => (
              <motion.button
                key={k.kind}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -4 }}
                onClick={() => setConfirm(k.kind)}
                className="surface surface-hover group relative overflow-hidden p-6 text-left"
              >
                <div className={cn('absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition group-hover:opacity-40', k.tone)} />
                <span className={cn('grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br text-slate-900', k.tone)}><k.icon className="h-6 w-6" /></span>
                <div className="mt-4 text-lg font-bold text-slate-900">{k.kind}</div>
                <div className="text-xs text-slate-500">{k.desc}</div>
              </motion.button>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Info icon={<Bell className="h-4 w-4" />} title="Coordinated cascade" desc="Every role notified, banner shown, attendance & timetable frozen — in one action" />
            <Info icon={<Users className="h-4 w-4" />} title="Live accountability" desc="Teacher class-status & parent acknowledgements tracked in real time" />
            <Info icon={<ShieldAlert className="h-4 w-4" />} title="Immutable audit" desc="Activation, notifications, responses & resolution logged in the Trust Core" />
          </div>
        </>
      )}

      <AnimatePresence>
        {confirm && (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setConfirm(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="surface w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/20 text-rose-400"><ShieldAlert className="h-7 w-7" /></span>
              <h2 className="mt-4 text-lg font-bold text-slate-900">Trigger {confirm} emergency?</h2>
              <p className="mt-1 text-sm text-slate-500">This alerts everyone in the school and freezes attendance & timetable changes until resolved. Use only for a real emergency or a sanctioned drill.</p>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setConfirm(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => trigger.mutate(confirm)} disabled={trigger.isPending} className="btn-danger flex-1">{trigger.isPending ? <Spinner /> : <><Send className="h-4 w-4" /> Trigger</>}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Counter({ label, value, tone, icon }: { label: string; value: React.ReactNode; tone: string; icon: React.ReactNode }) {
  return (
    <Card className="!py-3">
      <div className="flex items-center gap-1.5"><span className={tone}>{icon}</span><span className="text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400">{label}</span></div>
      <div className="tnum mt-1 font-display text-2xl font-semibold text-slate-900">{value}</div>
    </Card>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-ink-800/50 py-2">
      <div className={cn('tnum text-lg font-bold', tone)}>{value}</div>
      <div className="text-[0.62rem] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

function Info({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-brand-400">{icon}</span>
      <div><div className="text-sm font-semibold text-slate-900">{title}</div><div className="text-xs text-slate-500">{desc}</div></div>
    </Card>
  );
}

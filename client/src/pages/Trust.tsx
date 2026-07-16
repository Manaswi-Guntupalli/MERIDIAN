import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { History, GitCommitHorizontal, Undo2, ShieldCheck, Sparkles, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen } from '@/components/ui';
import { cn, timeAgo, confColor } from '@/lib/utils';
import type { EventItem, AILogItem } from '@/types';

const TABS = [
  { id: 'time', label: 'Time Machine', icon: Clock },
  { id: 'audit', label: 'Audit Timeline', icon: GitCommitHorizontal },
  { id: 'ledger', label: 'AI Trust Ledger', icon: ShieldCheck },
] as const;

export default function Trust() {
  const [tab, setTab] = useState<'time' | 'audit' | 'ledger'>('time');
  return (
    <div>
      <PageHeader
        overline="Trust Core"
        title="Time Machine & audit"
        subtitle="Every change is an immutable event. Rewind the whole school to any moment, replay the audit trail, and undo anything."
      />
      <div className="mb-6 inline-flex rounded-xl border border-white/10 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-brand-gradient text-ink-950' : 'text-slate-400 hover:text-white')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'time' && <TimeMachine />}
      {tab === 'audit' && <AuditTimeline />}
      {tab === 'ledger' && <Ledger />}
    </div>
  );
}

function TimeMachine() {
  const events = useQuery({ queryKey: ['events'], queryFn: async () => (await api.get('/trust/events', { params: { limit: 200 } })).data.events as EventItem[] });
  const [pos, setPos] = useState(100);

  const { minT, maxT, atISO } = useMemo(() => {
    const list = events.data ?? [];
    if (!list.length) return { minT: 0, maxT: 0, atISO: new Date().toISOString() };
    const times = list.map((e) => new Date(e.createdAt).getTime());
    const min = Math.min(...times), max = Math.max(...times);
    const at = new Date(min + ((max - min) * pos) / 100).toISOString();
    return { minT: min, maxT: max, atISO: at };
  }, [events.data, pos]);

  const snap = useQuery({
    queryKey: ['time-machine', atISO],
    queryFn: async () => (await api.get('/trust/time-machine', { params: { at: atISO } })).data,
    enabled: !!events.data?.length,
  });

  if (events.isLoading) return <LoadingScreen />;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2"><History className="h-4 w-4 text-brand-400" /><span className="font-bold text-white">Rewind the school</span></div>
        <Badge severity="INFO">{new Date(atISO).toLocaleString()}</Badge>
      </div>
      <p className="mb-5 text-sm text-slate-400">Drag the slider to reconstruct the school's state as it stood at any past moment.</p>

      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-full accent-brand-500" />
      <div className="mt-1 flex justify-between text-[0.65rem] text-slate-600">
        <span>{minT ? new Date(minT).toLocaleDateString() : ''}</span>
        <span>now</span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Snap label="Events" value={snap.data?.eventCount ?? 0} />
        <Snap label="Students added" value={snap.data?.snapshot.studentsCreated ?? 0} />
        <Snap label="Attendance marks" value={snap.data?.snapshot.attendanceMarks ?? 0} />
        <Snap label="Fee payments" value={snap.data?.snapshot.feePayments ?? 0} />
      </div>
    </Card>
  );
}

function Snap({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
      <motion.div key={value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-extrabold text-white">{value}</motion.div>
      <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function AuditTimeline() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const events = useQuery({ queryKey: ['events'], queryFn: async () => (await api.get('/trust/events', { params: { limit: 120 } })).data.events as EventItem[] });

  const undo = useMutation({
    mutationFn: async (id: string) => api.post(`/trust/events/${id}/undo`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['stats'] }); pushToast({ title: 'Reverted', body: 'State restored; ledger stays append-only', severity: 'SUCCESS' }); },
    onError: () => pushToast({ title: 'Cannot undo', body: 'This event is not reversible', severity: 'WARNING' }),
  });

  if (events.isLoading) return <LoadingScreen />;

  return (
    <Card className="!p-0">
      <div className="relative px-5 py-4">
        <div className="absolute bottom-0 left-[38px] top-14 w-px bg-white/[0.08]" />
        <div className="space-y-1">
          {events.data?.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }} className="relative flex items-center gap-4 py-2.5">
              <span className={cn('z-10 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-ink-900', e.reverted ? 'bg-slate-600' : e.type.includes('EMERGENCY') ? 'bg-rose-400' : e.type.includes('REVERTED') ? 'bg-amber-400' : 'bg-brand-400')}>
                <span className="h-1 w-1 rounded-full bg-ink-950" />
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-semibold', e.reverted ? 'text-slate-500 line-through' : 'text-white')}>{prettyType(e.type)}</div>
                <div className="text-xs text-slate-500">{e.actorName ?? 'system'} · {timeAgo(e.createdAt)} · <span className="font-mono text-slate-600">{e.aggregate}</span></div>
              </div>
              {e.reverted ? <Badge>reverted</Badge> : e.reversible ? (
                <button onClick={() => undo.mutate(e.id)} className="btn-ghost !py-1.5 text-xs"><Undo2 className="h-3.5 w-3.5" /> Undo</button>
              ) : <Badge>final</Badge>}
            </motion.div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Ledger() {
  const logs = useQuery({ queryKey: ['ai-logs'], queryFn: async () => (await api.get('/trust/ai-logs')).data.logs as AILogItem[] });
  if (logs.isLoading) return <LoadingScreen />;
  const engineColor: Record<string, string> = { LUMEN: 'text-brand-400', KAIROS: 'text-cyan-400', FORESIGHT: 'text-amber-400', COPILOT: 'text-mint-400', PRESENCE: 'text-rose-400' };
  return (
    <div className="space-y-2">
      {logs.data?.length ? logs.data.map((l, i) => (
        <motion.div key={l.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
          <Card className="flex items-center gap-4 !py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5"><Sparkles className={cn('h-4 w-4', engineColor[l.engine])} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className={cn('text-[0.65rem] font-bold uppercase tracking-wider', engineColor[l.engine])}>{l.engine}</span><span className="text-sm font-semibold text-white">{l.action}</span></div>
              {l.reason && <div className="truncate text-xs text-slate-500">{l.reason}</div>}
            </div>
            {l.confidence != null && <span className={cn('text-xs font-bold', confColor(l.confidence))}>{Math.round(l.confidence * 100)}%</span>}
            <span className="hidden text-[0.65rem] text-slate-600 sm:inline">{timeAgo(l.createdAt)}</span>
          </Card>
        </motion.div>
      )) : <Card className="text-center text-sm text-slate-500">No AI actions logged yet. Use Lumen, Kairos, Copilot or Presence to populate the ledger.</Card>}
    </div>
  );
}

function prettyType(t: string) {
  return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

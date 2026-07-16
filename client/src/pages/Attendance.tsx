import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, X, Clock, CalendarOff, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ClassRow, RosterEntry } from '@/types';

const STATUSES = [
  { key: 'PRESENT', icon: Check, tone: 'text-mint-400 bg-mint-400/10 border-mint-400/30' },
  { key: 'ABSENT', icon: X, tone: 'text-rose-400 bg-rose-400/10 border-rose-400/30' },
  { key: 'LATE', icon: Clock, tone: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  { key: 'LEAVE', icon: CalendarOff, tone: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30' },
];

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [classId, setClassId] = useState(params.get('classId') ?? '');

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const roster = useQuery({
    queryKey: ['attendance', 'roster', classId],
    queryFn: async () => (await api.get(`/attendance/class/${classId}`)).data as { date: string; roster: RosterEntry[] },
    enabled: !!classId,
  });

  const mark = useMutation({
    mutationFn: async (v: { studentId: string; status: string }) => api.post('/attendance/mark', { ...v, classId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance', 'roster', classId] }),
  });

  const bulk = useMutation({
    mutationFn: async (status: string) => (await api.post('/attendance/bulk', { classId, status })).data,
    onSuccess: (res) => {
      pushToast({ title: 'Done ✓', body: `${res.className}: ${res.marked} marked ${res.status}`, severity: 'SUCCESS' });
      qc.invalidateQueries({ queryKey: ['attendance', 'roster', classId] });
    },
  });

  const marked = roster.data?.roster.filter((r) => r.status !== 'UNMARKED').length ?? 0;
  const present = roster.data?.roster.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length ?? 0;

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Attendance"
        subtitle="Mark manually, or let Presence stream RFID/CV taps in live. Every mark is a reversible event."
        actions={
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setParams({ classId: e.target.value }); }} className="input w-40">
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <Badge severity="INFO">{roster.data?.date}</Badge>
        <span className="text-sm text-slate-400">{marked} marked · {present} present</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => bulk.mutate('PRESENT')} className="btn-ghost !py-2 text-xs"><Zap className="h-3.5 w-3.5 text-mint-400" /> All present</button>
          <button onClick={() => bulk.mutate('ABSENT')} className="btn-ghost !py-2 text-xs">All absent</button>
        </div>
      </Card>

      {roster.isLoading ? (
        <LoadingScreen />
      ) : roster.data?.roster.length ? (
        <div className="grid gap-2">
          {roster.data.roster.map((r, i) => (
            <motion.div key={r.studentId} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.015, 0.25) }}>
              <Card className="flex items-center gap-3 !py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-xs font-bold text-slate-400">{r.rollNo}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{r.name}</div>
                  {r.source && r.source !== 'MANUAL' && <span className="text-[0.65rem] text-cyan-400">via {r.source}</span>}
                </div>
                <div className="flex gap-1.5">
                  {STATUSES.map((st) => {
                    const activeStatus = r.status === st.key;
                    return (
                      <button
                        key={st.key}
                        onClick={() => mark.mutate({ studentId: r.studentId, status: st.key })}
                        className={cn('grid h-8 w-8 place-items-center rounded-lg border transition', activeStatus ? st.tone : 'border-white/10 text-slate-600 hover:border-white/20 hover:text-slate-300')}
                        title={st.key}
                      >
                        <st.icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState title="No students in this class" />
      )}
    </div>
  );
}

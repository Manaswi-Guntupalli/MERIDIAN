import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Play, ScanFace, ChevronRight, Radio } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, Spinner, EmptyState } from '@/components/ui';
import { timeAgo } from '@/lib/utils';
import type { AttendanceSessionView } from '@/types';

interface ClassRow { id: string; name: string }
interface SessionRow { id: string; className: string; status: string; date: string; startTime: string; roster: number }

// Launcher for classroom attendance. Picking a class and pressing "Start
// Attendance" opens the dedicated, projector-ready session screen — the QR
// only ever lives there, only while attendance is active.
export default function Sessions() {
  const navigate = useNavigate();
  const { pushToast } = useUI();
  const [classId, setClassId] = useState('');

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  useEffect(() => { if (!classId && classes.data?.length) setClassId(classes.data[0].id); }, [classes.data, classId]);

  const sessions = useQuery({
    queryKey: ['attendance-sessions'],
    queryFn: async () => (await api.get('/presence/session')).data.sessions as SessionRow[],
    refetchInterval: 8000,
  });

  const start = useMutation({
    mutationFn: async () => (await api.post('/presence/session/start', { classId })).data as AttendanceSessionView,
    onSuccess: (s) => navigate(`/presence/live/${s.id}`),
    onError: (e) => pushToast({ title: 'Could not start attendance', body: apiError(e), severity: 'CRITICAL' }),
  });

  const active = sessions.data?.filter((s) => s.status === 'ACTIVE') ?? [];
  const recent = sessions.data?.filter((s) => s.status !== 'ACTIVE').slice(0, 8) ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Launcher */}
      <Card className="lg:col-span-1">
        <div className="mb-1 text-sm font-semibold text-slate-900">Take attendance for a class</div>
        <p className="mb-3 text-[0.72rem] leading-relaxed text-slate-500">
          Opens a dedicated session screen (large QR + live countdown + register) — project it for the class. Face marks a student present instantly; the QR is the verification fallback.
        </p>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input mb-3 w-full">
          {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => start.mutate()} disabled={start.isPending || !classId} className="btn-primary w-full">
          {start.isPending ? <Spinner /> : <Play className="h-4 w-4" />} Start attendance
        </button>
      </Card>

      {/* Active + recent sessions */}
      <div className="space-y-5 lg:col-span-2">
        {active.length > 0 && (
          <Card className="!p-0">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              <Radio className="h-4 w-4 text-mint-500" />
              <h2 className="font-bold text-slate-900">Active now</h2>
            </div>
            <div className="divide-y divide-line">
              {active.map((s) => (
                <button key={s.id} onClick={() => navigate(`/presence/live/${s.id}`)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-ink-800/40">
                  <ScanFace className="h-4 w-4 shrink-0 text-brand-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{s.className}</div>
                    <div className="text-xs text-slate-500">{s.roster} on register · started {timeAgo(s.startTime)}</div>
                  </div>
                  <Badge severity="SUCCESS">Live</Badge>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="!p-0">
          <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-slate-900">Recent sessions</h2></div>
          {sessions.isLoading ? (
            <div className="p-5"><Spinner /> Loading…</div>
          ) : recent.length ? (
            <div className="divide-y divide-line">
              {recent.map((s) => (
                <button key={s.id} onClick={() => navigate(`/presence/summary/${s.id}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-ink-800/40">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800">{s.className}</div>
                    <div className="text-xs text-slate-500">{s.date} · {s.roster} students</div>
                  </div>
                  <Badge severity="INFO">{s.status}</Badge>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5"><EmptyState title="No sessions yet" hint="Start attendance for a class to open your first session." /></div>
          )}
        </Card>
      </div>
    </div>
  );
}

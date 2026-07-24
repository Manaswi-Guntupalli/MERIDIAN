import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace, UserX, QrCode, ShieldAlert, Clock, CameraOff, CheckCircle2, Play, Users } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, EmptyState, Spinner } from '@/components/ui';
import { timeAgo, cn } from '@/lib/utils';
import type { MarkResultView, VerificationState } from '@/types';
import { STATE_BADGE } from './shared';

interface ClassRow { id: string; name: string }
interface FeedItem { key: string; label: string; result: MarkResultView; at: string }

export default function Simulator() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [classId, setClassId] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  useEffect(() => { if (!classId && classes.data?.length) setClassId(classes.data[0].id); }, [classes.data, classId]);

  const push = (label: string, result: MarkResultView) => {
    setFeed((f) => [{ key: `${Date.now()}-${Math.random()}`, label, result, at: new Date().toISOString() }, ...f].slice(0, 20));
    qc.invalidateQueries({ queryKey: ['attendance-session'] });
    qc.invalidateQueries({ queryKey: ['presence-events'] });
  };

  const startSession = useMutation({
    mutationFn: async () => (await api.post('/presence/simulate/session', { classId })).data as { sessionId: string; reused: boolean },
    onSuccess: (d) => { setSessionId(d.sessionId); pushToast({ title: d.reused ? 'Reusing active session' : 'Demo session started', severity: 'SUCCESS' }); },
    onError: (e) => pushToast({ title: 'Could not start session', body: apiError(e), severity: 'CRITICAL' }),
  });

  const run = useMutation({
    mutationFn: async (args: { path: string; label: string }) => ({ label: args.label, data: (await api.post(`/presence/simulate/${args.path}`, { sessionId })).data as MarkResultView }),
    onSuccess: ({ label, data }) => push(label, data),
    onError: (e) => pushToast({ title: 'Scenario failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  const ready = !!sessionId;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">Attendance Simulator</div>
            <p className="mt-0.5 text-[0.72rem] leading-relaxed text-slate-500">
              Every button drives the <b className="text-slate-700">real attendance engine</b> — the verification state machine, anti-proxy gate, events and Trust Ledger.
              The only simulated element is the camera pixel: a "capture" is a synthetic face template plus noise (no webcam needed here).
            </p>
          </div>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input !w-auto" disabled={ready}>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {!ready ? (
            <button onClick={() => startSession.mutate()} disabled={startSession.isPending || !classId} className="btn-primary">
              {startSession.isPending ? <Spinner /> : <Play className="h-4 w-4" />} Start session
            </button>
          ) : (
            <button onClick={() => { api.post('/presence/simulate/close', { sessionId }).catch(() => {}); setSessionId(null); }} className="btn-ghost">Close session</button>
          )}
        </div>
      </Card>

      <Card>
        <div className="mb-1 text-sm font-semibold text-slate-900">Run a scenario</div>
        <p className="mb-3 text-xs text-slate-500">{ready ? 'Each fires the real engine against the active session.' : 'Start a session above first.'}</p>
        <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Everyday flow</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Scenario icon={<ScanFace className="h-4 w-4 text-mint-500" />} title="Correct face" desc="A student's face is recognised → marked present." disabled={!ready} onClick={() => run.mutate({ path: 'correct-face', label: 'Correct face' })} />
          <Scenario icon={<QrCode className="h-4 w-4 text-cyan-500" />} title="QR + face" desc="QR scanned and the face matches → present (both factors)." disabled={!ready} onClick={() => run.mutate({ path: 'qr-face', label: 'QR + face' })} />
          <Scenario icon={<QrCode className="h-4 w-4 text-amber-500" />} title="QR only" desc="QR scanned, no face yet → pending; becomes Unverified QR at expiry." disabled={!ready} onClick={() => run.mutate({ path: 'qr-only', label: 'QR only' })} />
          <Scenario icon={<CheckCircle2 className="h-4 w-4 text-brand-500" />} title="No face detected" desc="An empty frame — nothing to mark." disabled={!ready} onClick={() => run.mutate({ path: 'no-face', label: 'No face detected' })} />
        </div>
        <div className="mb-2 mt-5 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Edge cases the engine must catch</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Scenario icon={<ShieldAlert className="h-4 w-4 text-rose-500" />} title="Proxy attempt" desc="QR claims A but the face is B → blocked, admins alerted." disabled={!ready} onClick={() => run.mutate({ path: 'proxy', label: 'Proxy attempt' })} />
          <Scenario icon={<UserX className="h-4 w-4 text-rose-500" />} title="Unknown face" desc="A face nobody enrolled → recognised as no-one, not marked." disabled={!ready} onClick={() => run.mutate({ path: 'unknown-face', label: 'Unknown face' })} />
          <Scenario icon={<Clock className="h-4 w-4 text-amber-500" />} title="Expired session" desc="Forces expiry, then a scan — refused. No mark outside a live session." disabled={!ready} onClick={() => run.mutate({ path: 'expired', label: 'Expired session' })} />
          <Scenario icon={<CameraOff className="h-4 w-4 text-slate-500" />} title="Camera offline" desc="The face service is unreachable — honest degradation, no fake mark." disabled={!ready} onClick={() => run.mutate({ path: 'camera-offline', label: 'Camera offline' })} />
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="h-2 w-2 animate-pulseGlow rounded-full bg-mint-400" />
          <h2 className="font-bold text-slate-900">What happened</h2>
          <span className="ml-auto text-xs text-slate-500">Same events land in Sessions, Activity and dashboards.</span>
        </div>
        <div className="max-h-[26rem] overflow-y-auto p-3 no-scrollbar">
          <AnimatePresence initial={false}>
            {feed.length === 0 ? (
              <EmptyState title="No simulated marks yet" hint="Start a session, then run 'Correct face'." />
            ) : (
              feed.map((f) => {
                const badge = STATE_BADGE[f.result.state as VerificationState] ?? { label: f.result.state, severity: 'INFO' as const };
                return (
                  <motion.div key={f.key} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="mb-2 rounded-xl border border-line bg-ink-800/60 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">{f.label}</span>
                      <span className="text-[0.65rem] text-slate-500">{timeAgo(f.at)}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Users className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 text-sm text-slate-800">{f.result.studentName || '—'}</span>
                      {f.result.face && <span className="text-xs text-slate-500">{Math.round(f.result.face.confidence * 100)}%</span>}
                      <Badge severity={badge.severity}>{badge.label}</Badge>
                    </div>
                    {f.result.reason && <div className={cn('mt-1 text-[0.68rem] leading-snug', f.result.state === 'PROXY_ATTEMPT' ? 'text-rose-600' : 'text-slate-500')}>{f.result.reason}</div>}
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

function Scenario({ icon, title, desc, onClick, disabled }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left transition hover:border-brand-400/50 hover:bg-ink-800/40 disabled:cursor-not-allowed disabled:opacity-45">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-800">{title}</span>
        <span className="block text-[0.7rem] leading-snug text-slate-500">{desc}</span>
      </span>
    </button>
  );
}

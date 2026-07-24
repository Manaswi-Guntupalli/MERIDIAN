import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Users, ShieldCheck, Eye, UserPlus, Activity, AlertTriangle, Loader2, Camera, Play, ShieldAlert } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { useWebcam } from '@/hooks/useWebcam';
import { loadFaceModels, detectAll, detectLandmarksOnly, eyeAspectRatio, BlinkDetector, captureFrameBase64 } from '@/lib/face';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, StatTile, LoadingScreen, EmptyState, Meter, Spinner } from '@/components/ui';
import { cn, initials, timeAgo } from '@/lib/utils';
import { FACE } from '@/constants/theme';
import type { AttendanceSessionView, MarkResultView } from '@/types';

const TABS = [
  { id: 'kiosk', label: 'Live Kiosk', icon: Camera },
  { id: 'enroll', label: 'Enrollment', icon: UserPlus },
  { id: 'insights', label: 'Insights', icon: Activity },
] as const;

export default function FaceRecognition() {
  const [tab, setTab] = useState<'kiosk' | 'enroll' | 'insights'>('kiosk');
  return (
    <div>
      <PageHeader
        overline="Engine 05 · Presence"
        title="Face Recognition Attendance"
        subtitle="The primary attendance method. The camera confirms identity, the session validates the window, and QR is the fallback — images are embedded server-side in memory and never stored."
      />
      <div className="mb-6 inline-flex rounded-xl border border-line p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-900')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'kiosk' && <LiveKiosk />}
      {tab === 'enroll' && <Enrollment />}
      {tab === 'insights' && <Insights />}
    </div>
  );
}

// ─────────────────────────── LIVE KIOSK ───────────────────────────
interface LogEntry { name: string; state: string; confidence: number; at: string; reason?: string }

function LiveKiosk() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const { videoRef, ready, error, start, stop } = useWebcam();
  const [modelsReady, setModelsReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [faces, setFaces] = useState<{ box: { x: number; y: number; width: number; height: number } }[]>([]);
  const [dims, setDims] = useState({ w: 640, h: 480 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [classId, setClassId] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const runFlag = useRef(false);
  const blinkRef = useRef(new BlinkDetector());
  const busyRef = useRef(false);
  const lastMarkRef = useRef(0);

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as { id: string; name: string }[] });
  useEffect(() => { if (!classId && classes.data?.length) setClassId(classes.data[0].id); }, [classes.data, classId]);
  const session = useQuery({
    queryKey: ['attendance-session', sessionId],
    queryFn: async () => (await api.get(`/presence/session/${sessionId}`)).data as AttendanceSessionView,
    enabled: !!sessionId,
    refetchInterval: 4000,
  });

  const startSession = async () => {
    try {
      const existing = (await api.get(`/presence/session/active?classId=${classId}`)).data.session as AttendanceSessionView | null;
      const s = existing ?? ((await api.post('/presence/session/start', { classId })).data as AttendanceSessionView);
      setSessionId(s.id);
    } catch (e) { pushToast({ title: 'Could not open session', body: apiError(e), severity: 'CRITICAL' }); }
  };

  const boot = async () => {
    if (!sessionId) await startSession();
    await loadFaceModels();
    setModelsReady(true);
    await start();
    setRunning(true);
    runFlag.current = true;
  };
  useEffect(() => () => { runFlag.current = false; stop(); }, [stop]);

  // When the session ends (timer expiry or a manual close), stop the camera —
  // no attendance can be captured outside an active session anyway.
  useEffect(() => {
    if (running && session.data && session.data.status !== 'ACTIVE') {
      runFlag.current = false;
      stop();
      setRunning(false);
      pushToast({ title: 'Session ended', body: 'Attendance closed — camera stopped.', severity: 'INFO' });
    }
  }, [session.data, running, stop, pushToast]);

  // Capture the frame and send the IMAGE to the server, which embeds + matches
  // + marks. The browser never holds a face template.
  const submitFrame = async () => {
    if (!videoRef.current || !sessionId || busyRef.current) return;
    if (!blinkRef.current.armed) return; // liveness gate
    if (Date.now() - lastMarkRef.current < 3000) return;
    busyRef.current = true;
    try {
      const image = captureFrameBase64(videoRef.current);
      const result = (await api.post(`/presence/session/${sessionId}/face`, { image })).data as MarkResultView;
      if (result.state === 'PRESENT') {
        lastMarkRef.current = Date.now();
        setLog((l) => [{ name: result.studentName, state: 'PRESENT', confidence: result.face?.confidence ?? 0, at: new Date().toISOString() }, ...l].slice(0, 15));
        pushToast({ title: `${result.studentName} ✓`, body: `Present · ${Math.round((result.face?.confidence ?? 0) * 100)}% match`, severity: 'SUCCESS' });
        qc.invalidateQueries({ queryKey: ['attendance-session', sessionId] });
      } else if (result.state === 'PROXY_ATTEMPT') {
        lastMarkRef.current = Date.now();
        setLog((l) => [{ name: result.studentName, state: 'PROXY_ATTEMPT', confidence: result.face?.confidence ?? 0, at: new Date().toISOString(), reason: result.reason }, ...l].slice(0, 15));
      }
      // ABSENT (no confident match / not on register) is quiet — expected while scanning.
    } catch { /* transient / face service offline — handled by the offline note */ } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    if (!ready || !modelsReady) return;
    let lastShot = 0;
    const loop = async (t: number) => {
      if (!runFlag.current || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState >= 2) {
        setDims({ w: video.videoWidth, h: video.videoHeight });
        const lm = await detectLandmarksOnly(video);
        if (lm) blinkRef.current.update(eyeAspectRatio(lm));
        setLive(blinkRef.current.armed);
        if (t - lastShot > 700) {
          lastShot = t;
          const det = await detectAll(video);
          setFaces(det.map((d) => ({ box: d.box })));
          if (det.length) void submitFrame();
        }
      }
      if (runFlag.current) requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, modelsReady, sessionId]);

  const s = session.data;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card className="!p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input !w-auto !py-1.5 text-xs" disabled={running}>
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {s && <Badge severity={s.status === 'ACTIVE' ? 'SUCCESS' : 'INFO'}>{s.status === 'ACTIVE' ? `${s.counts.present}/${s.counts.total} present` : s.status}</Badge>}
            <span className="text-[0.7rem] text-slate-500">Face marks the student present the instant they’re recognised.</span>
          </div>
          <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
            {faces.map((f, i) => (
              <div key={i} className="absolute rounded-lg border-2 transition-all" style={{ left: `${(f.box.x / dims.w) * 100}%`, top: `${(f.box.y / dims.h) * 100}%`, width: `${(f.box.width / dims.w) * 100}%`, height: `${(f.box.height / dims.h) * 100}%`, borderColor: FACE.known, boxShadow: '0 2px 10px rgba(30,138,99,0.28)' }} />
            ))}
            {running && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <motion.div className="absolute inset-x-0 h-20 bg-gradient-to-b from-cyan-400/15 to-transparent" animate={{ y: ['-10%', '120%'] }} transition={{ repeat: Infinity, duration: 2.6, ease: 'linear' }} />
              </div>
            )}
            {!running && (
              <div className="absolute inset-0 grid place-items-center">
                {error ? <div className="text-center text-sm text-rose-400"><AlertTriangle className="mx-auto mb-2 h-6 w-6" />{error}</div> : <button onClick={boot} className="btn-primary"><Play className="h-4 w-4" /> Start kiosk</button>}
              </div>
            )}
            {running && !modelsReady && <div className="absolute inset-0 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin text-brand-400" /></div>}
            {running && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2">
                <span className="chip"><span className="live-dot" /> {faces.length} face{faces.length === 1 ? '' : 's'}</span>
                <span className={cn('chip', live ? '!border-mint-400/40 !text-mint-400' : '!border-slate-500/30')}><Eye className="h-3 w-3" /> {live ? 'Liveness verified' : 'Blink to verify'}</span>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-mint-400" /> Frames embedded server-side in memory · only vectors compared, never stored</span>
          </div>
        </Card>
      </div>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4"><span className="live-dot" /><h2 className="font-bold text-slate-900">Recognised now</h2></div>
        <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3 no-scrollbar">
          <AnimatePresence initial={false}>
            {log.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">Step in front of the camera and blink to mark attendance.</div>
            ) : log.map((e, i) => (
              <motion.div key={e.at + i} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={cn('rounded-xl border p-3', e.state === 'PROXY_ATTEMPT' ? 'border-rose-400/40 bg-rose-400/[0.06]' : 'border-line bg-ink-800/60')}>
                <div className="flex items-center gap-3">
                  <div className={cn('grid h-9 w-9 place-items-center rounded-lg text-xs font-bold text-white', e.state === 'PROXY_ATTEMPT' ? 'bg-rose-500' : 'bg-brand-600')}>{e.state === 'PROXY_ATTEMPT' ? <ShieldAlert className="h-4 w-4" /> : initials(e.name)}</div>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{e.name}</div><div className="text-xs text-slate-500">{timeAgo(e.at)}</div></div>
                  <Badge severity={e.state === 'PROXY_ATTEMPT' ? 'CRITICAL' : 'SUCCESS'}>{e.state === 'PROXY_ATTEMPT' ? 'Proxy blocked' : 'Present'}</Badge>
                </div>
                {e.reason && <div className="mt-1.5 border-t border-line pt-1.5 text-[0.68rem] text-slate-500">{e.reason}</div>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────── ENROLLMENT ───────────────────────────
function Enrollment() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const canEnroll = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);
  const [enrolling, setEnrolling] = useState<{ type: 'STUDENT' | 'TEACHER'; id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['face', 'enrolled'], queryFn: async () => (await api.get('/face/enrolled')).data as { students: any[]; teachers: any[] } });

  if (isLoading) return <LoadingScreen />;
  const students = (data?.students ?? []).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));

  const Row = ({ p, type }: { p: any; type: 'STUDENT' | 'TEACHER' }) => (
    <div className="surface flex items-center gap-3 p-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-xs font-bold text-white">{initials(p.name)}</div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-500">{type === 'STUDENT' ? `${p.className ?? '—'} · Roll ${p.rollNo}` : p.department}</div></div>
      {p.enrolled ? (
        <div className="flex items-center gap-2"><Badge severity="SUCCESS">{p.faceCount} faces</Badge>{canEnroll && <button onClick={() => setEnrolling({ type, id: p.id, name: p.name })} className="btn-ghost !py-1.5 text-xs">Re-enroll</button>}</div>
      ) : canEnroll ? (
        <button onClick={() => setEnrolling({ type, id: p.id, name: p.name })} className="btn-primary !py-1.5 text-xs"><ScanFace className="h-3.5 w-3.5" /> Enroll face</button>
      ) : <Badge>Not enrolled</Badge>}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="input sm:max-w-xs" />
        <div className="text-sm text-slate-500 sm:ml-auto">{data?.students.filter((s) => s.enrolled).length}/{data?.students.length} students · {data?.teachers.filter((t) => t.enrolled).length}/{data?.teachers.length} staff enrolled</div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div><h3 className="mb-2 font-bold text-slate-900">Teachers</h3><div className="space-y-2">{data?.teachers.map((t) => <Row key={t.id} p={t} type="TEACHER" />)}</div></div>
        <div><h3 className="mb-2 font-bold text-slate-900">Students</h3><div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1 no-scrollbar">{students.length ? students.map((s) => <Row key={s.id} p={s} type="STUDENT" />) : <EmptyState title="No students" />}</div></div>
      </div>
      {enrolling && <EnrollDialog subject={enrolling} onClose={() => setEnrolling(null)} onDone={() => qc.invalidateQueries({ queryKey: ['face'] })} />}
    </div>
  );
}

function EnrollDialog({ subject, onClose, onDone }: { subject: { type: 'STUDENT' | 'TEACHER'; id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { pushToast } = useUI();
  const { videoRef, ready, error, start, stop } = useWebcam();
  const [modelsReady, setModelsReady] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => { await loadFaceModels(); setModelsReady(true); await start(); })(); return () => stop(); }, [start, stop]);

  const capture = () => { if (videoRef.current) setShots((s) => [...s, captureFrameBase64(videoRef.current!)].slice(0, 3)); };

  const save = async () => {
    setSaving(true);
    try {
      const res = (await api.post('/face/enroll', { subjectType: subject.type, subjectId: subject.id, images: shots, consent: true })).data;
      pushToast({ title: 'Face enrolled', body: `${res.stored} templates stored for ${subject.name}`, severity: 'SUCCESS' });
      onDone(); onClose();
    } catch (e) { pushToast({ title: 'Enrollment failed', body: apiError(e), severity: 'CRITICAL' }); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-bold text-slate-900">Enroll {subject.name}</h3>
        <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
          {(!ready || !modelsReady) && <div className="absolute inset-0 grid place-items-center text-slate-400">{error ? <span className="text-rose-400">{error}</span> : <Loader2 className="h-6 w-6 animate-spin text-brand-400" />}</div>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {[0, 1, 2].map((i) => <div key={i} className={cn('h-2 flex-1 rounded-full', shots[i] ? 'bg-mint-500' : 'bg-ink-700')} />)}
        </div>
        <button onClick={capture} disabled={!ready || shots.length >= 3} className="btn-ghost mt-3 w-full text-sm">Capture frame ({shots.length}/3)</button>
        <label className="mt-3 flex items-start gap-2 text-[0.72rem] text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>I confirm consent to store this person's face embedding for attendance (DPDP/GDPR). Only the vector is kept — never the image.</span>
        </label>
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="btn-quiet flex-1 text-sm">Cancel</button>
          <button onClick={save} disabled={!shots.length || !consent || saving} className="btn-primary flex-1 text-sm">{saving ? <Spinner /> : <ScanFace className="h-3.5 w-3.5" />} Enroll</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── INSIGHTS ───────────────────────────
function Insights() {
  const status = useQuery({ queryKey: ['face', 'status'], queryFn: async () => (await api.get('/face/status')).data, refetchInterval: 5000 });
  const unknown = useQuery({ queryKey: ['face', 'unknown'], queryFn: async () => (await api.get('/face/unknown')).data.events as any[] });
  if (status.isLoading) return <LoadingScreen />;
  const s = status.data;
  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Enrollment coverage" value={`${s.coverage}%`} sub={`${s.enrolledStudents}/${s.totalStudents} students`} icon={<Users className="h-4 w-4" />} accent="brand" />
        <StatTile index={1} label="Recognised today" value={s.recognizedToday} sub="via face kiosk" icon={<ScanFace className="h-4 w-4" />} accent="mint" />
        <StatTile index={2} label="Unknown faces" value={s.unknownToday} sub="today" icon={<AlertTriangle className="h-4 w-4" />} accent="amber" />
        <StatTile index={3} label="Proxy attempts" value={s.proxyToday} sub="blocked today" icon={<ShieldAlert className="h-4 w-4" />} accent="rose" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-slate-900">Enrollment coverage</h3>
          <div className="mb-2 flex items-center justify-between text-sm"><span className="text-slate-500">Students with a face profile</span><span className="font-bold text-slate-900">{s.coverage}%</span></div>
          <Meter value={s.coverage} tone={s.coverage >= 80 ? 'mint' : s.coverage >= 40 ? 'brand' : 'amber'} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-line bg-ink-800/60 p-3"><div className="tnum text-2xl font-extrabold text-slate-900">{s.embeddings}</div><div className="label">Total embeddings</div></div>
            <div className="rounded-xl border border-line bg-ink-800/60 p-3"><div className="tnum text-2xl font-extrabold text-slate-900">{s.enrolledTeachers}/{s.totalTeachers}</div><div className="label">Staff enrolled</div></div>
          </div>
          <p className="mt-3 text-[0.7rem] text-slate-500">Model: {s.model}</p>
        </Card>
        <Card className="!p-0">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4"><ShieldAlert className="h-4 w-4 text-rose-400" /><h3 className="font-bold text-slate-900">Unknown / proxy log</h3></div>
          <div className="max-h-72 space-y-2 overflow-y-auto p-3 no-scrollbar">
            {unknown.data?.length ? unknown.data.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-ink-800/60 p-3">
                <span className={cn('grid h-8 w-8 place-items-center rounded-lg', e.kind === 'PROXY' ? 'bg-rose-400/10 text-rose-400' : 'bg-amber-400/10 text-amber-400')}>{e.kind === 'PROXY' ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{e.kind === 'PROXY' ? 'Proxy blocked' : 'Unknown face'}</div><div className="text-xs text-slate-500">{timeAgo(e.createdAt)}{e.note ? ` · ${e.note}` : ''}</div></div>
              </div>
            )) : <div className="py-10 text-center text-sm text-slate-500">No unknown or proxy events. Clean feed. ✓</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

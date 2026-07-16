import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Users, ShieldCheck, Eye, CheckCircle2, UserPlus, Activity, AlertTriangle, Loader2, Camera } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { useWebcam } from '@/hooks/useWebcam';
import { loadFaceModels, detectAll, detectLandmarksOnly, matchDescriptor, eyeAspectRatio, BlinkDetector, type GalleryEntry } from '@/lib/face';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, StatTile, LoadingScreen, EmptyState, Meter } from '@/components/ui';
import FaceEnroll from '@/components/face/FaceEnroll';
import { cn, initials, timeAgo, confColor } from '@/lib/utils';

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
        subtitle="On-device neural embeddings + liveness. Recognises enrolled students in real time — zero raw biometric images ever stored."
      />
      <div className="mb-6 inline-flex rounded-xl border border-white/10 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-brand-gradient text-ink-950' : 'text-slate-400 hover:text-white')}>
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
interface LiveFace {
  box: { x: number; y: number; width: number; height: number };
  name: string;
  known: boolean;
  confidence: number;
  subjectId?: string;
}
interface LogEntry { name: string; confidence: number; status: string; at: string }

function LiveKiosk() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const { videoRef, ready, error, start, stop } = useWebcam();
  const [modelsReady, setModelsReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [faces, setFaces] = useState<LiveFace[]>([]);
  const [live, setLive] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [dims, setDims] = useState({ w: 640, h: 480 });

  const galleryRef = useRef<GalleryEntry[]>([]);
  const runFlag = useRef(false);
  const blinkRef = useRef(new BlinkDetector());
  const markedRef = useRef<Map<string, number>>(new Map());

  const gallery = useQuery({
    queryKey: ['face', 'gallery'],
    queryFn: async () => (await api.get('/face/gallery')).data.gallery as GalleryEntry[],
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => { if (gallery.data) galleryRef.current = gallery.data; }, [gallery.data]);

  const boot = async () => {
    await loadFaceModels();
    setModelsReady(true);
    await start();
    setRunning(true);
    runFlag.current = true;
  };
  useEffect(() => () => { runFlag.current = false; stop(); }, [stop]);

  const markAttendance = async (vector: number[], liveness: boolean) => {
    try {
      const { data } = await api.post('/face/attendance', { vector, liveness });
      if (data.status === 'MARKED' || data.status === 'ALREADY') {
        setLog((l) => [{ name: data.name, confidence: data.confidence, status: data.status, at: new Date().toISOString() }, ...l].slice(0, 15));
        if (data.status === 'MARKED') {
          pushToast({ title: `${data.name} ✓`, body: `Present · ${Math.round(data.confidence * 100)}% match`, severity: 'SUCCESS' });
          qc.invalidateQueries({ queryKey: ['face', 'status'] });
        }
      } else if (data.status === 'SPOOF') {
        pushToast({ title: 'Liveness failed', body: 'Possible photo/video — blink to verify', severity: 'WARNING' });
      }
    } catch { /* ignore transient */ }
  };

  useEffect(() => {
    if (!ready || !modelsReady) return;
    let lastRecog = 0;
    const loop = async (t: number) => {
      if (!runFlag.current || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState >= 2) {
        setDims({ w: video.videoWidth, h: video.videoHeight });

        // Fast blink/liveness pass EVERY frame (landmarks only — cheap).
        const lm = await detectLandmarksOnly(video);
        if (lm) blinkRef.current.update(eyeAspectRatio(lm));
        const armed = blinkRef.current.armed;
        setLive(armed);

        // Heavier recognition pass, throttled.
        if (t - lastRecog > 350) {
          lastRecog = t;
          const detections = await detectAll(video);
          const out: LiveFace[] = detections.map((d) => {
            const m = matchDescriptor(d.descriptor, galleryRef.current);
            const face: LiveFace = { box: d.box, name: m.matched ? m.entry!.name : 'Unknown', known: m.matched, confidence: m.confidence, subjectId: m.entry?.subjectId };
            // Mark known + live faces, once per ~25s.
            if (m.matched && m.entry && blinkRef.current.armed) {
              const lastMark = markedRef.current.get(m.entry.subjectId) ?? 0;
              if (Date.now() - lastMark > 25000) {
                markedRef.current.set(m.entry.subjectId, Date.now());
                markAttendance(d.descriptor, true);
              }
            }
            return face;
          });
          setFaces(out);
        }
      }
      if (runFlag.current) requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, modelsReady]);

  const enrolledCount = gallery.data ? new Set(gallery.data.map((g) => g.subjectId)).size : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card className="!p-3">
          <div className="relative overflow-hidden rounded-xl bg-ink-900" style={{ aspectRatio: '4/3' }}>
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />

            {/* Face overlays (HTML, positioned by % of the video frame) */}
            {faces.map((f, i) => (
              <div
                key={i}
                className="absolute rounded-lg border-2 transition-all"
                style={{
                  left: `${(f.box.x / dims.w) * 100}%`,
                  top: `${(f.box.y / dims.h) * 100}%`,
                  width: `${(f.box.width / dims.w) * 100}%`,
                  height: `${(f.box.height / dims.h) * 100}%`,
                  borderColor: f.known ? (f.confidence > 0.8 ? '#00D084' : '#FFB020') : '#FF4D6D',
                  boxShadow: `0 0 16px ${f.known ? '#00D08455' : '#FF4D6D55'}`,
                }}
              >
                <span
                  className="absolute -top-6 left-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold text-ink-950"
                  style={{ background: f.known ? (f.confidence > 0.8 ? '#00D084' : '#FFB020') : '#FF4D6D' }}
                >
                  {f.name} {f.known ? `· ${Math.round(f.confidence * 100)}%` : ''}
                </span>
              </div>
            ))}

            {/* Identity banner — the "who am I" readout for the closest face */}
            {running && (() => {
              const primary = [...faces].sort((a, b) => b.box.width - a.box.width)[0];
              if (!primary) return null;
              return (
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                  <motion.div
                    key={primary.name}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn('flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold backdrop-blur-md', primary.known ? 'border-mint-400/40 bg-mint-400/15 text-mint-400' : 'border-rose-400/40 bg-rose-400/15 text-rose-400')}
                  >
                    <ScanFace className="h-4 w-4" />
                    {primary.known ? `${primary.name} · ${Math.round(primary.confidence * 100)}%` : 'Unknown face'}
                  </motion.div>
                </div>
              );
            })()}

            {/* scanning radar */}
            {running && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <motion.div className="absolute inset-x-0 h-20 bg-gradient-to-b from-cyan-400/15 to-transparent" animate={{ y: ['-10%', '120%'] }} transition={{ repeat: Infinity, duration: 2.6, ease: 'linear' }} />
              </div>
            )}

            {!running && (
              <div className="absolute inset-0 grid place-items-center">
                {error ? (
                  <div className="text-center text-sm text-rose-400"><AlertTriangle className="mx-auto mb-2 h-6 w-6" />{error}</div>
                ) : (
                  <button onClick={boot} className="btn-primary"><ScanFace className="h-4 w-4" /> Start recognition</button>
                )}
              </div>
            )}
            {running && !modelsReady && (
              <div className="absolute inset-0 grid place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin text-brand-400" /></div>
            )}

            {/* status bar */}
            {running && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2">
                <span className="chip"><span className="live-dot" /> {faces.length} face{faces.length === 1 ? '' : 's'}</span>
                <span className={cn('chip', live ? '!border-mint-400/40 !text-mint-400' : '!border-slate-500/30')}>
                  <Eye className="h-3 w-3" /> {live ? 'Liveness verified' : 'Blink to verify'}
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-mint-400" /> Raw frames discarded in-memory · only vectors compared</span>
            <span>{enrolledCount} enrolled</span>
          </div>
        </Card>
      </div>

      {/* Live recognized log */}
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
          <span className="live-dot" /><h2 className="font-bold text-white">Recognised now</h2>
        </div>
        <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3 no-scrollbar">
          <AnimatePresence initial={false}>
            {log.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">Step in front of the camera and blink to mark attendance.</div>
            ) : log.map((e, i) => (
              <motion.div key={e.at + i} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-gradient text-xs font-bold text-ink-950">{initials(e.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{e.name}</div>
                  <div className="text-xs text-slate-500">{timeAgo(e.at)}</div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <Badge severity={e.status === 'MARKED' ? 'SUCCESS' : 'INFO'}>{e.status === 'MARKED' ? 'Present' : 'Already'}</Badge>
                  <span className={cn('tnum text-[0.6rem]', confColor(e.confidence))}>{Math.round(e.confidence * 100)}%</span>
                </div>
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
    <div className="glass flex items-center gap-3 p-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-xs font-bold text-ink-950">{initials(p.name)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{p.name}</div>
        <div className="text-xs text-slate-500">{type === 'STUDENT' ? `${p.className ?? '—'} · Roll ${p.rollNo}` : p.department}</div>
      </div>
      {p.enrolled ? (
        <div className="flex items-center gap-2">
          <Badge severity="SUCCESS"><CheckCircle2 className="h-3 w-3" /> {p.faceCount} faces</Badge>
          {canEnroll && <button onClick={() => setEnrolling({ type, id: p.id, name: p.name })} className="btn-ghost !py-1.5 text-xs">Re-enroll</button>}
        </div>
      ) : canEnroll ? (
        <button onClick={() => setEnrolling({ type, id: p.id, name: p.name })} className="btn-primary !py-1.5 text-xs"><ScanFace className="h-3.5 w-3.5" /> Enroll face</button>
      ) : (
        <Badge>Not enrolled</Badge>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="input sm:max-w-xs" />
        <div className="text-sm text-slate-500 sm:ml-auto">
          {data?.students.filter((s) => s.enrolled).length}/{data?.students.length} students · {data?.teachers.filter((t) => t.enrolled).length}/{data?.teachers.length} staff enrolled
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-bold text-white">Teachers</h3>
          <div className="space-y-2">{data?.teachers.map((t) => <Row key={t.id} p={t} type="TEACHER" />)}</div>
        </div>
        <div>
          <h3 className="mb-2 font-bold text-white">Students</h3>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1 no-scrollbar">
            {students.length ? students.map((s) => <Row key={s.id} p={s} type="STUDENT" />) : <EmptyState title="No students" />}
          </div>
        </div>
      </div>

      {enrolling && (
        <FaceEnroll
          subjectType={enrolling.type}
          subjectId={enrolling.id}
          name={enrolling.name}
          onClose={() => setEnrolling(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['face'] }); }}
        />
      )}
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
        <StatTile index={3} label="Spoof attempts" value={s.spoofToday} sub="liveness blocked" icon={<ShieldCheck className="h-4 w-4" />} accent="rose" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-white">Enrollment coverage</h3>
          <div className="mb-2 flex items-center justify-between text-sm"><span className="text-slate-400">Students with a face profile</span><span className="font-bold text-white">{s.coverage}%</span></div>
          <Meter value={s.coverage} tone={s.coverage >= 80 ? 'mint' : s.coverage >= 40 ? 'brand' : 'amber'} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><div className="tnum text-2xl font-extrabold text-white">{s.embeddings}</div><div className="label">Total embeddings</div></div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><div className="tnum text-2xl font-extrabold text-white">{s.enrolledTeachers}/{s.totalTeachers}</div><div className="label">Staff enrolled</div></div>
          </div>
        </Card>

        <Card className="!p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4"><AlertTriangle className="h-4 w-4 text-amber-400" /><h3 className="font-bold text-white">Unknown / spoof log</h3></div>
          <div className="max-h-72 space-y-2 overflow-y-auto p-3 no-scrollbar">
            {unknown.data?.length ? unknown.data.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <span className={cn('grid h-8 w-8 place-items-center rounded-lg', e.kind === 'SPOOF' ? 'bg-rose-400/10 text-rose-400' : 'bg-amber-400/10 text-amber-400')}>
                  {e.kind === 'SPOOF' ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div className="flex-1"><div className="text-sm font-semibold text-white">{e.kind === 'SPOOF' ? 'Liveness blocked' : 'Unknown person'}</div><div className="text-xs text-slate-500">{e.cameraId} · {timeAgo(e.createdAt)}</div></div>
                <span className="tnum text-xs text-slate-500">{Math.round(e.confidence * 100)}%</span>
              </div>
            )) : <div className="py-10 text-center text-sm text-slate-500">No unknown or spoof events. Clean feed. ✓</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

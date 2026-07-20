import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Users, ShieldCheck, Eye, CheckCircle2, UserPlus, Activity, AlertTriangle, Loader2, Camera, Nfc, Radio } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { useWebcam } from '@/hooks/useWebcam';
import { useRfidReader } from '@/hooks/useRfidReader';
import type { RFIDCardRow, RFIDReaderRow } from '@/types';
import { loadFaceModels, detectAll, detectLandmarksOnly, eyeAspectRatio, BlinkDetector } from '@/lib/face';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, StatTile, LoadingScreen, EmptyState, Meter } from '@/components/ui';
import FaceEnroll from '@/components/face/FaceEnroll';
import { cn, initials, timeAgo, confColor } from '@/lib/utils';
import { FACE } from '@/constants/theme';

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
interface LiveFace {
  box: { x: number; y: number; width: number; height: number };
  name: string;
  known: boolean;
  confidence: number;
  subjectId?: string;
}
interface LogEntry { name: string; confidence: number; status: string; at: string; note?: string }

const LOG_BADGE: Record<string, { label: string; severity: 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'INFO' }> = {
  MARKED: { label: 'Present', severity: 'SUCCESS' },
  ALREADY: { label: 'Already', severity: 'INFO' },
  VERIFIED: { label: 'Present · fused', severity: 'SUCCESS' },
  LATE: { label: 'Late · fused', severity: 'WARNING' },
  DUPLICATE: { label: 'Duplicate', severity: 'INFO' },
  PROXY: { label: 'Proxy blocked', severity: 'CRITICAL' },
  REJECTED: { label: 'Rejected', severity: 'CRITICAL' },
};

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

  // ── Gate mode: attendance requires the RFID tap AND the live face to
  //    agree. Face-only auto-marking is disabled; the tap is the trigger. ──
  const [mode, setMode] = useState<'FACE' | 'GATE'>('FACE');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [gateReaderId, setGateReaderId] = useState('');
  const [gateCardUid, setGateCardUid] = useState('');
  const [tapBusy, setTapBusy] = useState(false);
  // Latest live descriptor of the PRIMARY (largest) face — what a tap fuses with.
  const latestFaceRef = useRef<{ descriptor: number[]; at: number } | null>(null);

  const readers = useQuery({
    queryKey: ['presence-readers'],
    queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[],
    enabled: mode === 'GATE',
  });
  const cards = useQuery({
    queryKey: ['presence-cards', 'ACTIVE'],
    queryFn: async () => (await api.get('/presence/cards', { params: { status: 'ACTIVE' } })).data.cards as RFIDCardRow[],
    enabled: mode === 'GATE',
  });
  useEffect(() => {
    if (mode === 'GATE' && !gateReaderId && readers.data?.length) setGateReaderId(readers.data[0].id);
  }, [mode, readers.data, gateReaderId]);

  const runFlag = useRef(false);
  const blinkRef = useRef(new BlinkDetector());
  const markedRef = useRef<Map<string, number>>(new Map());

  /** The gate tap: card UID + the face currently in frame → one fusion scan.
   *  The server verifies the live descriptor 1:1 against the CARDHOLDER's
   *  enrolled templates — a mismatch is blocked as PROXY, an un-enrolled
   *  cardholder is rejected (strict), and nothing is marked without both. */
  const fusionTap = async (uid: string) => {
    if (!uid) return;
    const face = latestFaceRef.current;
    if (!running || !face || Date.now() - face.at > 2500) {
      pushToast({ title: 'No face in frame', body: 'The student must be looking at the camera when they tap.', severity: 'WARNING' });
      return;
    }
    if (!blinkRef.current.armed) {
      pushToast({ title: 'Liveness not verified', body: 'Ask them to blink — photos and videos are rejected.', severity: 'WARNING' });
      return;
    }
    setTapBusy(true);
    try {
      const { data } = await api.post('/presence/scan/fusion', {
        readerId: gateReaderId || undefined,
        cardUid: uid,
        vector: face.descriptor,
        strict: true,
      });
      const name = data.student?.name ?? 'Unknown card';
      setLog((l) => [{ name, confidence: data.fusion?.similarity ?? 0, status: data.status, at: new Date().toISOString(), note: data.reason }, ...l].slice(0, 15));
      if (data.status === 'VERIFIED' || data.status === 'LATE') {
        pushToast({ title: `${name} ✓ card + face`, body: `Marked ${data.status === 'LATE' ? 'late' : 'present'} · face verified ${Math.round((data.fusion?.similarity ?? 0) * 100)}%`, severity: data.status === 'LATE' ? 'WARNING' : 'SUCCESS' });
      } else if (data.status === 'PROXY') {
        pushToast({ title: 'Proxy attempt blocked', body: data.reason, severity: 'CRITICAL' });
      } else {
        pushToast({ title: LOG_BADGE[data.status]?.label ?? data.status, body: data.reason ?? '', severity: data.status === 'DUPLICATE' ? 'INFO' : 'WARNING' });
      }
      qc.invalidateQueries({ queryKey: ['presence-events'] });
      qc.invalidateQueries({ queryKey: ['face', 'status'] });
    } catch (e) {
      pushToast({ title: 'Gate scan failed', body: apiError(e), severity: 'CRITICAL' });
    } finally {
      setTapBusy(false);
    }
  };

  // Physical USB/serial reader: a real tag tap fires the fusion scan directly.
  const rfid = useRfidReader((tag) => {
    setGateCardUid(tag);
    void fusionTap(tag);
  });

  // Enrollment coverage only — biometric templates are NEVER sent to the
  // browser. Recognition happens server-side via /face/recognize-batch.
  const status = useQuery({
    queryKey: ['face', 'status'],
    queryFn: async () => (await api.get('/face/status')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

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

        // Heavier recognition pass, throttled. Descriptors go to the server —
        // the enrolled biometric gallery never comes to the browser.
        if (t - lastRecog > 400) {
          lastRecog = t;
          const detections = await detectAll(video);
          // Keep the primary (largest) face's live descriptor for Gate mode —
          // this is what an RFID tap gets fused with.
          const primaryDet = [...detections].sort((a, b) => b.box.width - a.box.width)[0];
          latestFaceRef.current = primaryDet ? { descriptor: Array.from(primaryDet.descriptor), at: Date.now() } : null;
          if (detections.length) {
            try {
              const { data } = await api.post('/face/recognize-batch', {
                vectors: detections.slice(0, 12).map((d) => d.descriptor),
              });
              const out: LiveFace[] = detections.slice(0, 12).map((d, i) => {
                const m = data.results[i];
                // Face-only auto-marking is OFF in Gate mode: there, the card
                // tap + face verification together are the only way in.
                if (m?.matched && blinkRef.current.armed && modeRef.current === 'FACE') {
                  const lastMark = markedRef.current.get(m.subjectId) ?? 0;
                  if (Date.now() - lastMark > 25000) {
                    markedRef.current.set(m.subjectId, Date.now());
                    markAttendance(d.descriptor, true);
                  }
                }
                return {
                  box: d.box,
                  name: m?.matched ? m.name : 'Unknown',
                  known: !!m?.matched,
                  confidence: m?.confidence ?? 0,
                  subjectId: m?.subjectId ?? undefined,
                };
              });
              setFaces(out);
            } catch {
              /* transient network error — keep last frame's labels */
            }
          } else {
            setFaces([]);
          }
        }
      }
      if (runFlag.current) requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, modelsReady]);

  const enrolledCount = status.data?.enrolledStudents ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card className="!p-3">
          {/* Mode rail: face-only kiosk vs the anti-proxy gate */}
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {(['FACE', 'GATE'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn('flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition', mode === m ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800')}
                >
                  {m === 'FACE' ? <ScanFace className="h-3.5 w-3.5" /> : <Nfc className="h-3.5 w-3.5" />}
                  {m === 'FACE' ? 'Face kiosk' : 'Gate mode · RFID + Face'}
                </button>
              ))}
            </div>
            <span className="text-[0.7rem] leading-snug text-slate-500">
              {mode === 'FACE'
                ? 'Recognised + liveness-verified faces are marked automatically.'
                : 'Anti-proxy: the card claims an identity, the live face must confirm it — nobody is marked without both.'}
            </span>
          </div>

          <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
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
                  borderColor: f.known ? (f.confidence > 0.8 ? FACE.known : FACE.low) : FACE.unknown,
                  boxShadow: `0 2px 10px ${f.known ? 'rgba(30,138,99,0.28)' : 'rgba(192,69,59,0.28)'}`,
                }}
              >
                <span
                  className="absolute -top-6 left-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold text-white"
                  style={{ background: f.known ? (f.confidence > 0.8 ? FACE.known : FACE.low) : FACE.unknown }}
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
              <div className="absolute inset-0 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin text-brand-400" /></div>
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
          {/* Gate controls: the tap that triggers fusion */}
          {mode === 'GATE' && (
            <div className="mt-3 rounded-xl border border-line bg-ink-800/40 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[0.68rem] font-medium text-slate-500">Gate (reader)</span>
                  <select value={gateReaderId} onChange={(e) => setGateReaderId(e.target.value)} className="input w-full !py-1.5 text-xs">
                    {readers.data?.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.location}{r.online ? '' : ' (offline)'}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[0.68rem] font-medium text-slate-500">Student card</span>
                  <select value={gateCardUid} onChange={(e) => setGateCardUid(e.target.value)} className="input w-full !py-1.5 text-xs">
                    <option value="">Select a card…</option>
                    {cards.data?.map((c) => <option key={c.id} value={c.uid}>{c.student?.name} · {c.uid}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => fusionTap(gateCardUid)}
                  disabled={!running || !gateCardUid || tapBusy}
                  className="btn-primary !py-2 text-xs"
                  title="The tap: the selected card + whoever is in front of the camera right now"
                >
                  <Nfc className="h-3.5 w-3.5" /> {tapBusy ? 'Verifying…' : 'Tap card at gate'}
                </button>
                <input ref={rfid.inputRef} onKeyDown={rfid.handleKeyDown} className="sr-only" aria-hidden />
                <button
                  type="button"
                  onClick={() => rfid.setArmed((a) => !a)}
                  className={cn('btn-ghost !py-2 text-xs', rfid.armed && 'bg-brand-50 text-brand-700')}
                >
                  <Radio className="h-3.5 w-3.5" /> {rfid.armed ? 'Listening for physical tags…' : 'Use a USB/serial reader'}
                </button>
                <span className="text-[0.68rem] leading-snug text-slate-500">
                  A physical tag tap fires the same verification instantly.
                </span>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-mint-400" /> Raw frames discarded in-memory · only vectors compared</span>
            <span>{enrolledCount} enrolled</span>
          </div>
        </Card>
      </div>

      {/* Live recognized log */}
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="live-dot" /><h2 className="font-bold text-slate-900">Recognised now</h2>
        </div>
        <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3 no-scrollbar">
          <AnimatePresence initial={false}>
            {log.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">
                {mode === 'GATE'
                  ? 'Select a card and tap — the face in frame must match the cardholder.'
                  : 'Step in front of the camera and blink to mark attendance.'}
              </div>
            ) : log.map((e, i) => {
              const badge = LOG_BADGE[e.status] ?? { label: e.status, severity: 'INFO' as const };
              return (
                <motion.div key={e.at + i} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl border border-line bg-ink-800/60 p-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">{initials(e.name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{e.name}</div>
                      <div className="text-xs text-slate-500">{timeAgo(e.at)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <Badge severity={badge.severity}>{badge.label}</Badge>
                      {e.confidence > 0 && <span className={cn('tnum text-[0.6rem]', confColor(e.confidence))}>{Math.round(e.confidence * 100)}%</span>}
                    </div>
                  </div>
                  {e.note && (badge.severity === 'CRITICAL' || badge.severity === 'WARNING') && (
                    <div className="mt-1.5 border-t border-line pt-1.5 text-[0.68rem] leading-snug text-slate-500">{e.note}</div>
                  )}
                </motion.div>
              );
            })}
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
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">{p.name}</div>
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
          <h3 className="mb-2 font-bold text-slate-900">Teachers</h3>
          <div className="space-y-2">{data?.teachers.map((t) => <Row key={t.id} p={t} type="TEACHER" />)}</div>
        </div>
        <div>
          <h3 className="mb-2 font-bold text-slate-900">Students</h3>
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
          <h3 className="mb-3 font-bold text-slate-900">Enrollment coverage</h3>
          <div className="mb-2 flex items-center justify-between text-sm"><span className="text-slate-500">Students with a face profile</span><span className="font-bold text-slate-900">{s.coverage}%</span></div>
          <Meter value={s.coverage} tone={s.coverage >= 80 ? 'mint' : s.coverage >= 40 ? 'brand' : 'amber'} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-line bg-ink-800/60 p-3"><div className="tnum text-2xl font-extrabold text-slate-900">{s.embeddings}</div><div className="label">Total embeddings</div></div>
            <div className="rounded-xl border border-line bg-ink-800/60 p-3"><div className="tnum text-2xl font-extrabold text-slate-900">{s.enrolledTeachers}/{s.totalTeachers}</div><div className="label">Staff enrolled</div></div>
          </div>
        </Card>

        <Card className="!p-0">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4"><AlertTriangle className="h-4 w-4 text-amber-400" /><h3 className="font-bold text-slate-900">Unknown / spoof log</h3></div>
          <div className="max-h-72 space-y-2 overflow-y-auto p-3 no-scrollbar">
            {unknown.data?.length ? unknown.data.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border border-line bg-ink-800/60 p-3">
                <span className={cn('grid h-8 w-8 place-items-center rounded-lg', e.kind === 'SPOOF' ? 'bg-rose-400/10 text-rose-400' : 'bg-amber-400/10 text-amber-400')}>
                  {e.kind === 'SPOOF' ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div className="flex-1"><div className="text-sm font-semibold text-slate-900">{e.kind === 'SPOOF' ? 'Liveness blocked' : 'Unknown person'}</div><div className="text-xs text-slate-500">{e.cameraId} · {timeAgo(e.createdAt)}</div></div>
                <span className="tnum text-xs text-slate-500">{Math.round(e.confidence * 100)}%</span>
              </div>
            )) : <div className="py-10 text-center text-sm text-slate-500">No unknown or spoof events. Clean feed. ✓</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

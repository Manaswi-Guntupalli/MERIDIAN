import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import { Square, Maximize2, Minimize2, ArrowLeft, ScanFace, CheckCircle2, Clock } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Spinner } from '@/components/ui';
import { initials, cn } from '@/lib/utils';
import type { AttendanceSessionView, VerificationState } from '@/types';

// The dedicated, projector-ready Attendance Session screen. Large QR, large
// live countdown, large counts, and a colour-coded live grid — designed to be
// thrown on a classroom projector. Reuses every existing service/endpoint; no
// new attendance logic lives here.

// green = present · yellow = pending/qr · red = proxy/unverified · grey = absent
const TILE: Record<VerificationState, { ring: string; dot: string; label: string }> = {
  PRESENT: { ring: 'border-mint-400/60 bg-mint-400/[0.12]', dot: 'bg-mint-500', label: 'Present' },
  FACE_VERIFIED: { ring: 'border-mint-400/60 bg-mint-400/[0.12]', dot: 'bg-mint-500', label: 'Present' },
  QR_VERIFIED: { ring: 'border-amber-400/60 bg-amber-400/[0.12]', dot: 'bg-amber-500', label: 'Awaiting face' },
  PENDING: { ring: 'border-line bg-ink-800/40', dot: 'bg-slate-500', label: 'Waiting' },
  PROXY_ATTEMPT: { ring: 'border-rose-400/60 bg-rose-400/[0.12]', dot: 'bg-rose-500', label: 'Proxy blocked' },
  UNVERIFIED_QR: { ring: 'border-rose-400/60 bg-rose-400/[0.10]', dot: 'bg-rose-500', label: 'Unverified QR' },
  ABSENT: { ring: 'border-line bg-ink-800/40', dot: 'bg-slate-500', label: 'Absent' },
};

export default function AttendanceSessionLive() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const rootRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  const session = useQuery({
    queryKey: ['attendance-session', sessionId],
    queryFn: async () => (await api.get(`/presence/session/${sessionId}`)).data as AttendanceSessionView,
    enabled: !!sessionId,
    refetchInterval: 4000, // realtime is the primary signal; this is a fallback
  });
  const s = session.data;
  const active = s?.status === 'ACTIVE';

  // ── Smooth 1-second countdown, seeded from the absolute expiry instant.
  //    When it reaches 0, ask the server to sweep (expireIfDue runs on read),
  //    which flips the session to EXPIRED and QR-only rows to UNVERIFIED_QR. ──
  const expiredRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = s ? Math.max(0, Math.round((new Date(s.expiryTime).getTime() - nowTs) / 1000)) : 0;
  useEffect(() => {
    if (active && secondsLeft === 0 && !expiredRef.current) {
      expiredRef.current = true;
      qc.invalidateQueries({ queryKey: ['attendance-session', sessionId] });
    }
    if (secondsLeft > 0) expiredRef.current = false;
  }, [active, secondsLeft, qc, sessionId]);

  const close = useMutation({
    mutationFn: async () => (await api.post(`/presence/session/${sessionId}/close`)).data,
    onSuccess: () => {
      // Leaving fullscreen first, then hand off to the post-session summary.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      qc.invalidateQueries({ queryKey: ['attendance-session', sessionId] });
      navigate(`/presence/summary/${sessionId}`);
    },
    onError: (e) => pushToast({ title: 'Could not close', body: apiError(e), severity: 'CRITICAL' }),
  });

  const toggleFs = useCallback(() => {
    if (!document.fullscreenElement) rootRef.current?.requestFullscreen?.().then(() => setFs(true)).catch(() => {});
    else document.exitFullscreen?.().then(() => setFs(false)).catch(() => {});
  }, []);
  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  if (session.isLoading || !s) {
    return <div className="grid h-[60vh] place-items-center text-slate-500"><Spinner /> Loading session…</div>;
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const urgent = active && secondsLeft <= 30;

  return (
    <div ref={rootRef} className={cn('rounded-2xl bg-surface', fs && 'fixed inset-0 z-[100] overflow-auto p-8')}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {!fs && (
          <button onClick={() => navigate('/presence')} className="btn-quiet !px-2.5" title="Back to Sessions">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold tracking-tight text-slate-900">
            {s.subject ?? 'Attendance'} <span className="text-slate-400">•</span> {s.className}
          </div>
          <div className="mt-0.5 text-sm text-slate-500">{s.teacherName} · {s.date}</div>
        </div>
        <span className={cn('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold', active ? 'bg-mint-400/15 text-mint-600' : 'bg-ink-800 text-slate-500')}>
          <span className={cn('h-2 w-2 rounded-full', active ? 'animate-pulseGlow bg-mint-500' : 'bg-slate-400')} />
          {active ? 'ATTENDANCE ACTIVE' : s.status}
        </span>
        <button onClick={toggleFs} className="btn-ghost !py-2" title="Projector / fullscreen">
          {fs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {fs ? 'Exit' : 'Projector'}
        </button>
        {active && (
          <button onClick={() => close.mutate()} disabled={close.isPending} className="btn-primary !py-2">
            {close.isPending ? <Spinner /> : <Square className="h-4 w-4" />} End attendance
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* Left: QR + countdown + counts */}
        <div className="space-y-5">
          {active && s.qr ? (
            <QrBlock qr={s.qr} />
          ) : (
            <div className="rounded-2xl border border-line bg-ink-800/40 p-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-slate-400" />
              <div className="text-sm font-semibold text-slate-700">Session {s.status.toLowerCase()}</div>
              <div className="mt-1 text-xs text-slate-500">The QR is gone — a photographed code can't be reused.</div>
            </div>
          )}

          {/* Countdown */}
          <div className={cn('rounded-2xl border p-5 text-center transition-colors', urgent ? 'border-rose-400/50 bg-rose-400/[0.06]' : 'border-line bg-ink-800/40')}>
            <div className="flex items-center justify-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">
              <Clock className="h-3.5 w-3.5" /> {active ? 'Attendance closes in' : 'Closed'}
            </div>
            <div className={cn('tnum mt-1 text-6xl font-black tracking-tight', urgent ? 'text-rose-500' : active ? 'text-slate-900' : 'text-slate-400')}>
              {active ? `${mm}:${ss}` : '—'}
            </div>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-3 gap-3">
            <BigStat label="Present" value={`${s.counts.present}/${s.counts.total}`} tone="mint" />
            <BigStat label="Pending" value={s.counts.pending} tone="amber" />
            <BigStat label="Proxy" value={s.counts.proxy} tone="rose" />
          </div>
        </div>

        {/* Right: live student grid */}
        <div className="rounded-2xl border border-line bg-ink-800/20 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-sm font-bold text-slate-900">
            <ScanFace className="h-4 w-4 text-brand-500" /> Live register
            <span className="ml-auto text-[0.7rem] font-normal text-slate-500">green present · yellow pending · red proxy · grey absent</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence initial={false}>
              {s.students.map((st) => {
                const t = TILE[st.state] ?? TILE.PENDING;
                return (
                  <motion.div key={st.studentId} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                    className={cn('flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors', t.ring)}>
                    <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[0.7rem] font-bold text-white', t.dot)}>
                      {initials(st.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{st.name}</div>
                      <div className="text-[0.68rem] text-slate-500">{t.label}{st.faceConfidence ? ` · ${Math.round(st.faceConfidence * 100)}%` : ''}</div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function QrBlock({ qr }: { qr: { sessionId: string; token: string } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The QR encodes a real URL (not raw JSON) so a student's normal phone camera
  // opens Meridian's /scan page directly. window.location.origin means it points
  // at whatever address THIS projector page was opened from — localhost, a LAN
  // IP, or a tunnel — with no hardcoding. The QR carries ONLY { sessionId,
  // token }; the student's identity comes from their own login on /scan.
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const url = `${window.location.origin}/scan?s=${encodeURIComponent(qr.sessionId)}&t=${encodeURIComponent(qr.token)}`;
  useEffect(() => {
    if (canvasRef.current) QRCode.toCanvas(canvasRef.current, url, { width: 300, margin: 1 }).catch(() => {});
  }, [url]);
  return (
    <div className="rounded-2xl border border-line bg-white p-4 text-center">
      <canvas ref={canvasRef} className="mx-auto" />
      <div className="mt-2 text-xs font-medium text-slate-500">Scan with your phone camera to mark attendance</div>
      {isLocal ? (
        <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/[0.08] px-2.5 py-1.5 text-left text-[0.68rem] leading-snug text-amber-700">
          Phones can't reach <b>localhost</b>. Open this projector page using your computer's <b>Network</b> address
          (the <code>http://192.168.x.x:5173</code> URL that <code>npm run dev</code> prints) so the QR points somewhere phones can reach.
        </div>
      ) : (
        <div className="mt-2 text-[0.66rem] text-slate-400">Serving from {host} · phones on the same Wi-Fi can scan this</div>
      )}
    </div>
  );
}

function BigStat({ label, value, tone }: { label: string; value: string | number; tone: 'mint' | 'amber' | 'rose' }) {
  const color = tone === 'mint' ? 'text-mint-600' : tone === 'amber' ? 'text-amber-600' : 'text-rose-600';
  return (
    <div className="rounded-2xl border border-line bg-ink-800/40 p-4 text-center">
      <div className={cn('tnum text-3xl font-black', color)}>{value}</div>
      <div className="mt-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

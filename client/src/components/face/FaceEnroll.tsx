import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { X, Check, ScanFace, ShieldCheck, RotateCcw, Loader2, CheckCircle2, Camera, ArrowRight } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { useWebcam } from '@/hooks/useWebcam';
import { loadFaceModels, detectSingle, estimatePose, classifyPose, assessQuality, type Pose } from '@/lib/face';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { T } from '@/constants/theme';

// Guided enrollment: capture varied poses, quality-gate each frame, build
// 128-D embeddings on-device and store only the vectors.
const STEPS: { pose: Pose; label: string; hint: string; target: number }[] = [
  { pose: 'front', label: 'Look straight', hint: 'Face the camera, neutral expression', target: 5 },
  { pose: 'left', label: 'Turn left', hint: 'Slowly turn your head left', target: 3 },
  { pose: 'right', label: 'Turn right', hint: 'Slowly turn your head right', target: 3 },
  { pose: 'up', label: 'Look up', hint: 'Tilt your chin up slightly', target: 3 },
  { pose: 'down', label: 'Look down', hint: 'Tilt your chin down slightly', target: 3 },
];

interface CapturedEmbedding {
  vector: number[];
  label: string;
  quality: number;
}

export default function FaceEnroll({
  subjectType,
  subjectId,
  name,
  onClose,
  onDone,
}: {
  subjectType: 'STUDENT' | 'TEACHER';
  subjectId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { pushToast } = useUI();
  const navigate = useNavigate();
  const [succeeded, setSucceeded] = useState<number | null>(null);
  const { videoRef, ready, error, start, stop } = useWebcam();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [counts, setCounts] = useState<number[]>(STEPS.map(() => 0));
  const [status, setStatus] = useState('Loading AI models…');
  const [live, setLive] = useState<{ pose: Pose; quality: boolean } | null>(null);
  const embeddingsRef = useRef<CapturedEmbedding[]>([]);
  const runningRef = useRef(true);
  const lastCaptureRef = useRef(0);
  const stepIdxRef = useRef(0);
  const stepEnteredAtRef = useRef(Date.now());
  const baselineSamplesRef = useRef<number[]>([]);
  const baselinePitchRef = useRef<number | null>(null);

  // Keep a ref of the current step + reset its "entered at" timer (for the
  // no-dead-end fallback) whenever the step changes.
  useEffect(() => {
    stepIdxRef.current = stepIdx;
    stepEnteredAtRef.current = Date.now();
  }, [stepIdx]);

  const totalTarget = STEPS.reduce((a, s) => a + s.target, 0);
  const totalCaptured = counts.reduce((a, b) => a + b, 0);
  const done = stepIdx >= STEPS.length;

  const enroll = useMutation({
    mutationFn: async () =>
      (await api.post('/face/enroll', { subjectType, subjectId, embeddings: embeddingsRef.current })).data,
    onSuccess: (res) => {
      pushToast({ title: 'Face enrolled ✓', body: `${res.total} embeddings stored for ${name} — no image kept`, severity: 'SUCCESS' });
      runningRef.current = false;
      stop();
      onDone();
      setSucceeded(res.total);
    },
    onError: (e) => pushToast({ title: 'Enrollment failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  // Boot: load models + camera.
  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadFaceModels();
      if (!mounted) return;
      setModelsReady(true);
      setStatus('Starting camera…');
      await start();
    })();
    return () => {
      mounted = false;
      runningRef.current = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture loop.
  useEffect(() => {
    if (!ready || !modelsReady) return;
    runningRef.current = true;
    setStatus('Position your face in the frame');

    const loop = async () => {
      if (!runningRef.current || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState >= 2) {
        const face = await detectSingle(video);
        drawOverlay(face?.box);
        const curIdx = stepIdxRef.current;
        if (face && curIdx < STEPS.length) {
          const step = STEPS[curIdx];
          const { yaw, pitch } = estimatePose(face.landmarks);
          const q = assessQuality(video, face);

          // Calibrate the person's neutral pitch during the "look straight" step.
          if (step.pose === 'front' && Math.abs(yaw) < 0.15 && q.ok) {
            baselineSamplesRef.current.push(pitch);
            if (baselineSamplesRef.current.length >= 5) {
              const s = [...baselineSamplesRef.current].sort((a, b) => a - b);
              baselinePitchRef.current = s[Math.floor(s.length / 2)];
            }
          }

          const base = baselinePitchRef.current;
          const pose = classifyPose(yaw, pitch, base);
          setLive({ pose, quality: q.ok });

          const satisfied = poseSatisfies(step.pose, yaw, pitch, base);
          // No dead-ends: after 5s on a step, accept any good-quality frame.
          const stuck = Date.now() - stepEnteredAtRef.current > 5000;
          const now = Date.now();
          if ((satisfied || stuck) && q.ok && now - lastCaptureRef.current > 300) {
            lastCaptureRef.current = now;
            embeddingsRef.current.push({ vector: face.descriptor, label: step.pose, quality: Math.round(q.score * 100) / 100 });
            setCounts((c) => {
              const next = [...c];
              next[curIdx] = Math.min(step.target, next[curIdx] + 1);
              return next;
            });
          }
        } else if (!face) {
          setLive(null);
        }
      }
      if (runningRef.current) requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, modelsReady]);

  // Advance steps as targets are met.
  useEffect(() => {
    if (done) return;
    if (counts[stepIdx] >= STEPS[stepIdx].target) {
      if (stepIdx + 1 >= STEPS.length) {
        setStepIdx(STEPS.length);
        runningRef.current = false;
        setStatus('All angles captured — ready to enroll');
      } else {
        setStepIdx((i) => i + 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts]);

  function drawOverlay(box?: { x: number; y: number; width: number; height: number }) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (box) {
      ctx.strokeStyle = T.brand;
      ctx.lineWidth = 3;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      roundRect(ctx, box.x, box.y, box.width, box.height, 14);
      ctx.stroke();
    }
  }

  const reset = () => {
    embeddingsRef.current = [];
    baselineSamplesRef.current = [];
    baselinePitchRef.current = null;
    setCounts(STEPS.map(() => 0));
    setStepIdx(0);
    stepIdxRef.current = 0;
    stepEnteredAtRef.current = Date.now();
    runningRef.current = true;
    lastCaptureRef.current = 0;
  };

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="surface max-h-[92vh] w-full max-w-3xl overflow-y-auto overflow-x-hidden !p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-brand-400" />
            <h2 className="font-bold text-slate-900">Enroll face — {name}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="h-4 w-4" /></button>
        </div>

        {succeeded !== null ? (
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="grid h-16 w-16 place-items-center rounded-2xl bg-mint-400/15 text-mint-400">
              <CheckCircle2 className="h-8 w-8" />
            </motion.span>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{name} is enrolled</h3>
              <p className="mt-1 text-sm text-slate-500">{succeeded} on-device face embeddings stored. Now step in front of the kiosk and it will recognise you.</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-mint-400/20 bg-mint-400/5 px-3 py-2 text-[0.7rem] text-mint-400">
              <ShieldCheck className="h-3.5 w-3.5" /> No photo was saved — only the mathematical vectors.
            </div>
            <div className="mt-2 flex w-full max-w-xs gap-2">
              <button onClick={onClose} className="btn-ghost flex-1">Done</button>
              <button onClick={() => { onClose(); navigate('/face-recognition'); }} className="btn-primary flex-1">
                <Camera className="h-4 w-4" /> Live Kiosk <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* Camera */}
          <div className="relative aspect-[4/3] min-w-0 overflow-hidden bg-slate-900">
            <video ref={videoRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" muted playsInline />
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
            {/* scanning radar */}
            {!done && ready && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <motion.div className="absolute inset-x-0 h-24 bg-gradient-to-b from-cyan-400/20 to-transparent" animate={{ y: ['-20%', '120%'] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }} />
              </div>
            )}
            {(!ready || !modelsReady) && (
              <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                <div className="flex flex-col items-center gap-2"><Loader2 className="h-6 w-6 animate-spin text-brand-400" />{error ?? status}</div>
              </div>
            )}
            {live && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2">
                <span className={cn('chip', live.quality ? '!border-mint-400/40 !text-mint-400' : '!border-amber-400/40 !text-amber-400')}>
                  {live.quality ? 'Good quality' : 'Adjust position'}
                </span>
                <span className="chip">pose: {live.pose}</span>
              </div>
            )}
          </div>

          {/* Guidance */}
          <div className="min-w-0 p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="label">Capture guide</span>
              <span className="tnum text-xs text-slate-500">{totalCaptured}/{totalTarget}</span>
            </div>
            <div className="space-y-2">
              {STEPS.map((s, i) => {
                const complete = counts[i] >= s.target;
                const active = i === stepIdx && !done;
                return (
                  <div key={s.pose} className={cn('flex items-center gap-3 rounded-xl border p-2.5 transition', active ? 'border-brand-400/40 bg-brand-500/10' : complete ? 'border-mint-400/30 bg-mint-400/5' : 'border-line')}>
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold', complete ? 'bg-mint-400/20 text-mint-400' : active ? 'bg-brand-500/20 text-brand-400' : 'bg-ink-800 text-slate-500')}>
                      {complete ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-semibold', active || complete ? 'text-slate-900' : 'text-slate-500')}>{s.label}</div>
                      {active && <div className="text-[0.7rem] text-slate-500">{s.hint}</div>}
                    </div>
                    <span className="tnum text-[0.7rem] text-slate-500">{counts[i]}/{s.target}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-1.5 rounded-lg border border-mint-400/20 bg-mint-400/5 px-3 py-2 text-[0.7rem] text-mint-400">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Only 128-D vectors are stored — never a photo.
            </div>

            <AnimatePresence>
              {done && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex gap-2">
                  <button onClick={reset} className="btn-ghost flex-1 !py-2 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Redo</button>
                  <button onClick={() => enroll.mutate()} disabled={enroll.isPending} className="btn-primary flex-1 !py-2">
                    {enroll.isPending ? <Spinner /> : <>Enroll {embeddingsRef.current.length} embeddings</>}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        )}
      </motion.div>
    </div>
  );
}

// A frame satisfies a step when its classified pose matches the target
// (front additionally requires a well-centred yaw so it stays distinct).
function poseSatisfies(target: Pose, yaw: number, pitch: number, baseline: number | null): boolean {
  const pose = classifyPose(yaw, pitch, baseline);
  if (target === 'front') return pose === 'front' && Math.abs(yaw) < 0.13;
  return pose === target;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

import { useSearchParams, useLocation, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ScanFace, CheckCircle2, ShieldAlert, AlertTriangle, Clock, LogOut } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Spinner, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { AttendanceSessionView, MarkResultView } from '@/types';

// Student QR entry flow. The projected session QR encodes
//   <origin>/scan?s=<sessionId>&t=<token>
// so a student's phone camera opens THIS page directly. The student signs in
// (identity comes entirely from their JWT — the QR never carries who they are),
// then taps once to mark. Marking reuses the existing POST /presence/session/:id/qr
// endpoint verbatim: QR alone → QR_VERIFIED, and the classroom face camera or
// session expiry take it from there. No attendance logic lives here.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid min-h-screen place-items-center p-5"
      style={{
        background:
          'radial-gradient(80% 60% at 100% 0%, rgba(147,197,253,0.30), transparent 60%),' +
          'radial-gradient(80% 60% at 0% 100%, rgba(134,239,172,0.28), transparent 60%),' +
          'linear-gradient(160deg, #ffffff 40%, #f3f6ff 100%)',
      }}
    >
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand-700 text-white">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M7 23V10l5 7 4-9 4 9 5-7v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div className="font-display text-sm font-semibold tracking-tight text-slate-900">Meridian</div>
            <div className="text-[0.6rem] uppercase tracking-[0.16em] text-slate-400">Attendance</div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-xl shadow-slate-900/[0.04]">{children}</div>
      </motion.div>
    </div>
  );
}

export default function ScanAttendance() {
  const [params] = useSearchParams();
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const authLoading = useAuth((s) => s.loading);
  const logout = useAuth((s) => s.logout);
  const sessionId = params.get('s') ?? '';
  const token = params.get('t') ?? '';

  // Only the class's currently-active session is student-readable; we match it
  // to the scanned id so we show the right class (and degrade to a plain card
  // if it can't be resolved — the mark still targets the scanned session).
  const session = useQuery({
    queryKey: ['scan-active-session', sessionId],
    queryFn: async () => (await api.get('/presence/session/active')).data.session as AttendanceSessionView | null,
    enabled: !!user && !!sessionId,
  });

  const mark = useMutation({
    mutationFn: async () => (await api.post(`/presence/session/${sessionId}/qr`, { token })).data as MarkResultView,
  });

  // ── Gates (all hooks above, so order is stable) ──
  if (authLoading) {
    return <Shell><div className="flex items-center justify-center gap-2 py-6 text-slate-500"><Spinner /> Loading…</div></Shell>;
  }
  if (!user) {
    // Not signed in → go to login, then return straight back to this scan URL.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!sessionId || !token) {
    return (
      <Shell>
        <Failure icon={<AlertTriangle className="h-7 w-7 text-amber-500" />} title="Invalid attendance QR"
          body="This link is missing its session details. Ask your teacher to re-display the session QR, then scan it again." />
      </Shell>
    );
  }

  const matched = session.data && session.data.id === sessionId ? session.data : null;
  const result = mark.data;

  return (
    <Shell>
      {/* Header */}
      <div className="mb-4 text-center">
        <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600"><ScanFace className="h-6 w-6" /></div>
        <h1 className="text-lg font-bold text-slate-900">Attendance Session</h1>
      </div>

      {/* Session details */}
      <div className="rounded-xl border border-line bg-canvas p-4 text-center">
        {matched ? (
          <>
            <div className="text-2xl font-extrabold tracking-tight text-slate-900">{matched.className}</div>
            {matched.subject && <div className="text-sm font-medium text-slate-600">{matched.subject}</div>}
            <div className="mt-0.5 text-xs text-slate-500">Teacher: {matched.teacherName}</div>
            <div className="mt-3"><Badge severity="SUCCESS"><span className="live-dot mr-1" /> Active</Badge></div>
          </>
        ) : session.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-slate-500"><Spinner /> Finding session…</div>
        ) : (
          <div className="text-sm text-slate-500">Ready to mark your attendance for this session.</div>
        )}
      </div>

      {/* Action / result */}
      <div className="mt-5">
        {result ? (
          <ResultCard result={result} />
        ) : mark.isError ? (
          <>
            <Failure icon={<AlertTriangle className="h-7 w-7 text-rose-500" />} title="Couldn't mark attendance" body={apiError(mark.error)} />
            <button onClick={() => mark.mutate()} className="btn-ghost mt-3 w-full">Try again</button>
          </>
        ) : (
          <button onClick={() => mark.mutate()} disabled={mark.isPending} className="btn-primary w-full !py-3 text-base">
            {mark.isPending ? <Spinner /> : <CheckCircle2 className="h-5 w-5" />} Mark My Attendance
          </button>
        )}
      </div>

      {/* Signed-in footer */}
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-[0.7rem] text-slate-400">
        <span>Signed in as <span className="font-semibold text-slate-600">{user.name}</span></span>
        <button onClick={() => logout()} className="inline-flex items-center gap-1 hover:text-slate-600" title="Not you? Sign out">
          <LogOut className="h-3 w-3" /> Not you?
        </button>
      </div>
    </Shell>
  );
}

function ResultCard({ result }: { result: MarkResultView }) {
  // The engine's states, shown honestly to the student.
  if (result.state === 'QR_VERIFIED') {
    return (
      <Success title="Attendance recorded"
        body="Now show your face to the classroom camera to complete it. If you don't, it will show as Unverified QR when the session ends." />
    );
  }
  if (result.state === 'PRESENT') {
    return <Success title="You're marked present" body={result.reason ?? 'Both factors confirmed — you\'re all set.'} />;
  }
  if (result.state === 'PROXY_ATTEMPT') {
    return (
      <Failure icon={<ShieldAlert className="h-7 w-7 text-rose-500" />} title="Attendance blocked"
        body={result.reason ?? 'The face did not match this account. This was flagged to staff.'} />
    );
  }
  return (
    <Failure icon={<Clock className="h-7 w-7 text-amber-500" />} title="Not marked"
      body={result.reason ?? 'This attendance could not be recorded.'} />
  );
}

function Success({ title, body }: { title: string; body: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-mint-400/40 bg-mint-400/[0.08] p-5 text-center">
      <CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-mint-500" />
      <div className="text-base font-bold text-slate-900">{title}</div>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-slate-600">{body}</p>
    </motion.div>
  );
}

function Failure({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-canvas p-5 text-center')}>
      <div className="mx-auto mb-2">{icon}</div>
      <div className="text-base font-bold text-slate-900">{title}</div>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

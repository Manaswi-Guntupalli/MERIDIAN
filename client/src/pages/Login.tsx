import { useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { ArrowRight, ShieldCheck } from 'lucide-react';

const DEMO = [
  { role: 'Principal', email: 'principal@meridian.school', accent: 'from-brand-500 to-cyan-400' },
  { role: 'Admin', email: 'admin@meridian.school', accent: 'from-cyan-400 to-mint-400' },
  { role: 'Teacher', email: 'teacher@meridian.school', accent: 'from-amber-400 to-rose-400' },
  { role: 'Student', email: 'student@meridian.school', accent: 'from-mint-400 to-cyan-400' },
  { role: 'Parent', email: 'parent@meridian.school', accent: 'from-brand-500 to-brand-400' },
  { role: 'Super Admin', email: 'super@meridian.school', accent: 'from-rose-400 to-amber-400' },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Where to go after signing in: back to wherever RequireAuth (or the /scan
  // page) redirected from, else the dashboard. Lets a scanned attendance link
  // survive the login round-trip.
  const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  const redirectTo = from ? `${from.pathname}${from.search ?? ''}` : '/';
  const [email, setEmail] = useState('principal@meridian.school');
  const [password, setPassword] = useState('meridian123');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  if (user) return <Navigate to={redirectTo} replace />;

  const submit = async (e?: React.FormEvent, overrideEmail?: string) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Demo tiles sign in with the seeded demo password; the form uses what
      // was actually typed. (An earlier version hardcoded the demo password
      // for BOTH paths — real credentials were silently ignored.)
      await login(overrideEmail ?? email, overrideEmail ? 'meridian123' : password, rememberMe);
      navigate(redirectTo);
    } catch (err) {
      setError(apiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      {/* Left — editorial brand panel. Deep teal field, serif voice. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-700 p-12 lg:flex">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-white/12 text-white ring-1 ring-inset ring-white/20">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <path d="M7 23V10l5 7 4-9 4 9 5-7v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="font-display text-base font-semibold tracking-tight text-white">Meridian</div>
            <div className="text-[0.62rem] uppercase tracking-[0.18em] text-white/55">School Operating System</div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, ease: [0.16, 1, 0.3, 1] }} className="relative max-w-lg">
          <h1 className="font-display text-[2.7rem] font-medium leading-[1.1] tracking-[-0.02em] text-white">
            Every decision,
            <br />
            <span className="italic text-white/70">explained.</span>
          </h1>
          <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/65">
            One source of truth for the whole school. Every automated action is explainable, reversible and
            audited — so staff can trust it, and get their week back.
          </p>

          <dl className="mt-10 grid max-w-sm grid-cols-3 gap-6">
            {[
              { k: '13 hrs', v: 'saved per staff, weekly' },
              { k: '0', v: 'face images stored' },
              { k: '100%', v: 'AI actions audited' },
            ].map((s, i) => (
              <motion.div key={s.k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.07 }}>
                <dt className="font-display text-xl font-semibold text-white">{s.k}</dt>
                <dd className="mt-1 text-[0.7rem] leading-snug text-white/50">{s.v}</dd>
              </motion.div>
            ))}
          </dl>
        </motion.div>

        <div className="relative flex items-center gap-2 text-xs text-white/45">
          <ShieldCheck className="h-3.5 w-3.5" /> Built for schools, held to their standards
        </div>
      </div>

      {/* Right — auth. A soft pastel wash, strongest at the right edge and
          fading out before it reaches the form so inputs stay crisp. */}
      <div
        className="relative flex items-center justify-center overflow-hidden p-6 sm:p-12"
        style={{
          background: [
            'radial-gradient(90% 70% at 100% 12%, rgba(147,197,253,0.40), transparent 62%)',
            'radial-gradient(85% 75% at 100% 88%, rgba(249,168,212,0.42), transparent 64%)',
            'radial-gradient(60% 55% at 88% 50%, rgba(196,181,253,0.28), transparent 70%)',
            'linear-gradient(115deg, #ffffff 42%, #f3f6ff 74%, #fdf0f7 100%)',
          ].join(', '),
        }}
      >
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-xl font-extrabold text-slate-900">MERIDIAN</div>
            <div className="text-xs text-slate-500">School Operating System</div>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to your command center.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
            <div>
              <label className="label mb-1.5 block">Password</label>
              <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
            </div>
            <div className="flex items-center justify-between text-[0.76rem]">
              <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-line accent-brand-600"
                />
                Remember me for 7 days
              </label>
              <button type="button" onClick={() => setShowRecovery((v) => !v)} className="font-medium text-brand-600 hover:underline">
                Forgot password?
              </button>
            </div>
            {showRecovery && (
              <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-[0.74rem] leading-relaxed text-slate-500">
                Ask your school office to reset it from <b>Users &amp; Access</b> — you'll receive a temporary
                password that works exactly once, then you choose your own. Locked accounts unlock the same way
                (or automatically after 15 minutes).
              </div>
            )}
            {error && <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</div>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? <Spinner /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          <div className="mt-8">
            <div className="mb-3 text-center text-[0.7rem] uppercase tracking-[0.16em] text-slate-400">One-tap demo roles</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => submit(undefined, d.email)}
                  disabled={loading}
                  className="surface surface-hover flex items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700"
                >
                  <span className={`h-2 w-2 rounded-full bg-gradient-to-br ${d.accent}`} />
                  {d.role}
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[0.7rem] text-slate-400">Password for all demo accounts: meridian123</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

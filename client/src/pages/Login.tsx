import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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
  const [email, setEmail] = useState('principal@meridian.school');
  const [password, setPassword] = useState('meridian123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e?: React.FormEvent, overrideEmail?: string) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(overrideEmail ?? email, 'meridian123');
      navigate('/');
    } catch (err) {
      setError(apiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      {/* Left — brand story */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-70" />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient text-ink-950">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M7 23V10l5 7 4-9 4 9 5-7v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-tight text-white">MERIDIAN</div>
            <div className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-500">School Operating System</div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="relative">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white">
            The <span className="gradient-text">trust-first</span> operating system for schools.
          </h1>
          <p className="mt-4 max-w-md text-slate-400">
            Five engines, one source of truth. Every automated action is explainable, reversible and audited —
            so you can automate everything, because you can undo anything.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {['Lumen', 'Kairos', 'Pulse', 'Foresight'].map((e, i) => (
              <motion.div key={e} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.06 }} className="glass px-3 py-2.5 text-center text-xs font-semibold text-slate-300">
                {e}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <div className="relative flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-mint-400" /> 100% of AI actions reversible &amp; audited · 0 raw biometric images stored
        </div>
      </div>

      {/* Right — auth */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-xl font-extrabold text-white">MERIDIAN</div>
            <div className="text-xs text-slate-500">School Operating System</div>
          </div>
          <h2 className="text-2xl font-bold text-white">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-400">Sign in to your command center.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
            <div>
              <label className="label mb-1.5 block">Password</label>
              <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
            </div>
            {error && <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? <Spinner /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          <div className="mt-8">
            <div className="mb-3 text-center text-[0.7rem] uppercase tracking-[0.16em] text-slate-600">One-tap demo roles</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => submit(undefined, d.email)}
                  disabled={loading}
                  className="glass glass-hover flex items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-200"
                >
                  <span className={`h-2 w-2 rounded-full bg-gradient-to-br ${d.accent}`} />
                  {d.role}
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[0.7rem] text-slate-600">Password for all demo accounts: meridian123</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

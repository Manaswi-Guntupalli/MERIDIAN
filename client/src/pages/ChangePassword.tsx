import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The forced first-login screen. A temp-credential holder lands here and can
 * go NOWHERE else — the server enforces it (every other endpoint returns 428),
 * this screen is just the polite face of that rule.
 */
export default function ChangePassword() {
  const user = useAuth((s) => s.user);
  const changePassword = useAuth((s) => s.changePassword);
  const logout = useAuth((s) => s.logout);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength =
    next.length >= 12 && /[A-Z]/.test(next) && /\d/.test(next) ? 'strong'
    : next.length >= 8 ? 'okay'
    : next.length > 0 ? 'too short'
    : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      // user.mustChangePassword flips false in the store; App re-renders into
      // the real app with no navigation needed.
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="surface w-full max-w-md !rounded-2xl p-8"
      >
        <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold text-slate-900">Set your own password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          Welcome, <span className="font-semibold text-slate-700">{user?.name}</span>. You signed in with a temporary
          password — choose your own before continuing. Nothing else unlocks until you do.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3.5">
          <div>
            <label className="label mb-1.5 block">Temporary password</label>
            <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="input" autoFocus />
          </div>
          <div>
            <label className="label mb-1.5 block">New password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="input pr-10"
                placeholder="At least 8 characters"
              />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {strength && (
              <div className={cn('mt-1 text-[0.7rem] font-medium', strength === 'strong' ? 'text-mint-500' : strength === 'okay' ? 'text-amber-500' : 'text-rose-400')}>
                {strength === 'strong' ? '✓ Strong password' : strength === 'okay' ? 'Okay — longer with capitals and digits is stronger' : 'Too short — 8 characters minimum'}
              </div>
            )}
          </div>
          <div>
            <label className="label mb-1.5 block">Confirm new password</label>
            <input type={show ? 'text' : 'password'} required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" />
          </div>

          {error && <div className="rounded-lg bg-rose-400/[0.08] px-3 py-2 text-[0.8rem] text-rose-500">{error}</div>}

          <button type="submit" disabled={busy || next.length < 8} className="btn-primary w-full">
            {busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Set password &amp; continue
          </button>
        </form>

        <button onClick={logout} className="btn-quiet mt-3 w-full text-xs">
          Sign out instead
        </button>
        <p className="mt-4 text-center text-[0.68rem] leading-relaxed text-slate-400">
          Changing your password signs out every other device holding the temporary one.
        </p>
      </motion.div>
    </div>
  );
}

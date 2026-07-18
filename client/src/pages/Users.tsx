import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Copy, Eye, KeyRound, Lock, LogOut, Search, ShieldCheck, ShieldOff, Unlock, UserCog, Users as UsersIcon, X,
} from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Badge, Card, LoadingScreen, Spinner, StatTile } from '@/components/ui';
import { cn, initials, roleLabel } from '@/lib/utils';
import type { ManagedUser, Role } from '@/types';

const ROLE_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Everyone' },
  { key: 'ADMIN', label: 'Admins' },
  { key: 'TEACHER', label: 'Teachers' },
  { key: 'STUDENT', label: 'Students' },
  { key: 'PARENT', label: 'Parents' },
];

const ROLE_TONE: Record<string, string> = {
  SUPER_ADMIN: 'bg-slate-900 text-white',
  PRINCIPAL: 'bg-brand-600 text-white',
  ADMIN: 'bg-cyan-400/15 text-cyan-600',
  TEACHER: 'bg-mint-400/15 text-mint-600',
  STUDENT: 'bg-amber-400/15 text-amber-600',
  PARENT: 'bg-coral-400/15 text-coral-500',
};

export default function Users() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const impersonate = useAuth((s) => s.impersonate);
  const { pushToast } = useUI();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [tempCred, setTempCred] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  const users = useQuery({
    queryKey: ['users', role],
    queryFn: async () => (await api.get('/users', { params: role ? { role } : {} })).data.users as ManagedUser[],
  });

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => (await api.post(`/users/${id}/${action}`)).data,
    onSuccess: (data, { action }) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (action === 'reset-password') {
        setTempCred(data);
      } else {
        pushToast({ title: 'Done ✓', body: `Action "${action.replace(/-/g, ' ')}" applied.`, severity: 'SUCCESS' });
      }
    },
    onError: (e) => pushToast({ title: 'Blocked', body: apiError(e), severity: 'WARNING' }),
  });

  const startImpersonation = async (u: ManagedUser) => {
    try {
      await impersonate(u.id);
      pushToast({ title: `Viewing as ${u.name}`, body: 'You see exactly what they see. Use the banner to exit.', severity: 'INFO' });
    } catch (e) {
      pushToast({ title: 'Impersonation blocked', body: apiError(e), severity: 'WARNING' });
    }
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = users.data ?? [];
    if (!needle) return all;
    return all.filter((u) => (u.name + ' ' + u.email + ' ' + (u.detail ?? '')).toLowerCase().includes(needle));
  }, [users.data, q]);

  const counts = useMemo(() => {
    const all = users.data ?? [];
    return {
      total: all.length,
      active: all.filter((u) => u.active).length,
      locked: all.filter((u) => u.locked).length,
      pending: all.filter((u) => u.mustChangePassword).length,
    };
  }, [users.data]);

  return (
    <div>
      <PageHeader
        overline="Trust Core · Identity"
        title="Users & access"
        subtitle="Every account in the school: who can sign in, when they last did, and the controls to reset, lock and revoke. Every action lands in the Trust ledger."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Accounts" icon={<UsersIcon className="h-4 w-4" />} value={counts.total} sub="in this school" />
        <StatTile index={1} label="Active" accent="mint" icon={<ShieldCheck className="h-4 w-4" />} value={counts.active} sub={`${counts.total - counts.active} deactivated`} />
        <StatTile index={2} label="Locked" accent="rose" icon={<Lock className="h-4 w-4" />} value={counts.locked} sub="failed login protection" />
        <StatTile index={3} label="Awaiting first login" accent="amber" icon={<KeyRound className="h-4 w-4" />} value={counts.pending} sub="temp password not yet rotated" />
      </div>

      <Card className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setRole(f.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold transition',
                role === f.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line text-slate-500 hover:text-slate-900',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 sm:max-w-xs sm:ml-auto">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, class…" className="w-full bg-transparent py-2 text-[0.8rem] outline-none placeholder:text-slate-400" />
        </div>
      </Card>

      {users.isLoading ? (
        <LoadingScreen />
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.82rem]">
              <thead>
                <tr className="border-b border-line text-[0.66rem] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="hidden px-3 py-2.5 font-semibold md:table-cell">Detail</th>
                  <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Last sign-in</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {list.map((u) => (
                  <tr key={u.id} className={cn('transition-colors hover:bg-ink-800/40', !u.active && 'opacity-55')}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-ink-800 text-[0.62rem] font-bold text-slate-600">
                          {initials(u.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-900">{u.name}{u.id === me?.id && <span className="ml-1.5 text-[0.62rem] font-normal text-slate-400">(you)</span>}</div>
                          <div className="truncate text-[0.7rem] text-slate-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[0.64rem] font-bold', ROLE_TONE[u.role] ?? 'bg-ink-800 text-slate-600')}>
                        {roleLabel[u.role as Role] ?? u.role}
                      </span>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-3 py-2.5 text-[0.74rem] text-slate-500 md:table-cell">{u.detail ?? '—'}</td>
                    <td className="hidden px-3 py-2.5 text-[0.72rem] text-slate-500 lg:table-cell">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : <span className="text-slate-300">never</span>}
                      {u.lastLoginIp && <span className="tnum ml-1 text-slate-300">· {u.lastLoginIp.replace('::ffff:', '')}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.locked ? <Badge severity="CRITICAL">Locked</Badge>
                        : !u.active ? <Badge severity="INFO">Deactivated</Badge>
                        : u.mustChangePassword ? <Badge severity="WARNING">Temp password</Badge>
                        : <Badge severity="SUCCESS">Active</Badge>}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.manageable ? (
                        <div className="flex items-center justify-end gap-0.5">
                          {me?.role === 'SUPER_ADMIN' && u.active && (
                            <button onClick={() => startImpersonation(u)} className="btn-quiet !px-1.5 !py-1" title={`View Meridian as ${u.name}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => act.mutate({ id: u.id, action: 'reset-password' })} disabled={act.isPending} className="btn-quiet !px-1.5 !py-1" title="Reset password (issues a temporary one)">
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          {u.locked && (
                            <button onClick={() => act.mutate({ id: u.id, action: 'unlock' })} className="btn-quiet !px-1.5 !py-1" title="Unlock account">
                              <Unlock className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => act.mutate({ id: u.id, action: 'logout-all' })} className="btn-quiet !px-1.5 !py-1" title="Sign out of all devices">
                            <LogOut className="h-3.5 w-3.5" />
                          </button>
                          {u.active ? (
                            <button
                              onClick={() => window.confirm(`Deactivate ${u.name}? They are signed out everywhere immediately.`) && act.mutate({ id: u.id, action: 'deactivate' })}
                              className="btn-quiet !px-1.5 !py-1 !text-rose-400 hover:!bg-rose-400/[0.08]"
                              title="Deactivate account"
                            >
                              <ShieldOff className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => act.mutate({ id: u.id, action: 'activate' })} className="btn-quiet !px-1.5 !py-1 !text-mint-500" title="Reactivate account">
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-end pr-1" title={u.id === me?.id ? 'Manage your own account from Settings' : 'Outside your management scope'}>
                          <UserCog className="h-3.5 w-3.5 text-slate-300" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">No accounts match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Temp password — shown exactly once */}
      <AnimatePresence>
        {tempCred && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/30 px-4 backdrop-blur-sm"
            onClick={() => setTempCred(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              className="surface w-full max-w-sm !rounded-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/15 text-amber-500"><KeyRound className="h-4.5 w-4.5" /></div>
                <button onClick={() => setTempCred(null)} className="btn-quiet !px-1.5"><X className="h-4 w-4" /></button>
              </div>
              <h2 className="mt-3 font-display text-lg font-semibold text-slate-900">Temporary password issued</h2>
              <p className="mt-1 text-[0.8rem] leading-relaxed text-slate-500">
                Hand this to <span className="font-semibold text-slate-700">{tempCred.name}</span>. It is shown <b>only this once</b> —
                Meridian stores no copy. They must replace it at first sign-in.
              </p>
              <div className="mt-4 space-y-2">
                <CredentialLine label="Email" value={tempCred.email} />
                <CredentialLine label="Temporary password" value={tempCred.tempPassword} mono />
              </div>
              <button onClick={() => setTempCred(null)} className="btn-primary mt-5 w-full">Done — I've passed it on</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {act.isPending && <div className="fixed bottom-6 right-6 z-50"><Spinner /></div>}
    </div>
  );
}

export function CredentialLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const { pushToast } = useUI();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className={cn('truncate text-[0.82rem] text-slate-900', mono && 'font-mono font-semibold tracking-wide')}>{value}</div>
      </div>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value);
          pushToast({ title: 'Copied', body: `${label} copied to clipboard.`, severity: 'INFO' });
        }}
        className="btn-quiet !px-1.5 !py-1"
        title="Copy"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

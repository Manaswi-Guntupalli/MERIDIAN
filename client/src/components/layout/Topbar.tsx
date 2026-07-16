import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, LogOut, ShieldAlert, Menu } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { initials, roleLabel } from '@/lib/utils';
import { Badge } from '@/components/ui';

export default function Topbar({ onMenu }: { onMenu?: () => void }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const setPalette = useUI((s) => s.setPalette);
  const navigate = useNavigate();

  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as { unread: number },
    refetchInterval: 20000,
  });

  const isStaff = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-ink-950/70 px-4 backdrop-blur-xl lg:px-6">
      <button onClick={onMenu} className="btn-ghost !px-2 !py-2 lg:hidden">
        <Menu className="h-4 w-4" />
      </button>

      <button
        onClick={() => setPalette(true)}
        className="group flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-ink-850/60 px-3 py-2 text-sm text-slate-500 transition hover:border-white/20 md:max-w-md"
      >
        <Search className="h-4 w-4" />
        <span>Search or run a command…</span>
        <kbd className="ml-auto hidden rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-400 md:inline">
          ⌘K
        </kbd>
      </button>

      <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-[0.7rem] font-medium text-slate-400 md:inline-flex" title="AI engines are running">
        <span className="live-dot" /> AI online
      </span>

      {isStaff && (
        <button onClick={() => navigate('/emergency')} className="btn-ghost !border-rose-400/30 !text-rose-400 hover:!bg-rose-500/10" title="Emergency mode">
          <ShieldAlert className="h-4 w-4" />
          <span className="hidden sm:inline">Emergency</span>
        </button>
      )}

      <button onClick={() => navigate('/notifications')} className="relative btn-ghost !px-2.5">
        <Bell className="h-4 w-4" />
        {notif && notif.unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[0.6rem] font-bold text-white">
            {notif.unread}
          </span>
        )}
      </button>

      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] py-1.5 pl-1.5 pr-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-xs font-bold text-ink-950">
          {user ? initials(user.name) : '…'}
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-xs font-semibold text-white">{user?.name}</div>
          <div className="text-[0.65rem] text-slate-500">{user ? roleLabel[user.role] : ''}</div>
        </div>
        <button onClick={logout} className="ml-1 text-slate-500 transition hover:text-rose-400" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

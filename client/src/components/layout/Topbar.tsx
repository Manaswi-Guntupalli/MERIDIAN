import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Bell, LogOut, ShieldAlert, Menu, ChevronDown, UserRound, PanelLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { initials, roleLabel } from '@/lib/utils';

export default function Topbar({ onMenu }: { onMenu?: () => void }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const setPalette = useUI((s) => s.setPalette);
  const railed = useUI((s) => s.railed);
  const toggleRail = useUI((s) => s.toggleRail);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as { unread: number },
    refetchInterval: 20000,
  });

  // Dismiss the profile menu on outside click / Escape (a11y).
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const isStaff = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-7">
      {/* Mobile: open the drawer */}
      <button onClick={onMenu} className="btn-quiet -ml-1 !px-2 lg:hidden" aria-label="Open navigation">
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {/* Desktop: the ONE sidebar toggle. Always visible in both states so the
          rail can never trap you with no way back. */}
      <button
        onClick={toggleRail}
        className="btn-quiet -ml-1 hidden !px-2 lg:inline-flex"
        title={railed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={railed}
      >
        <PanelLeft className="h-[17px] w-[17px]" strokeWidth={1.9} />
      </button>

      {/* Search — the ⌘K entry point */}
      <button
        onClick={() => setPalette(true)}
        className="group flex h-9 flex-1 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-left text-[0.82rem] text-slate-400 shadow-xs transition hover:border-ink-600 md:max-w-[340px]"
      >
        <Search className="h-[15px] w-[15px]" strokeWidth={2} />
        <span className="flex-1">Search or jump to…</span>
        <kbd className="hidden rounded border border-line bg-ink-800 px-1.5 py-px font-mono text-[0.65rem] text-slate-400 md:inline">⌘K</kbd>
      </button>

      <div className="flex-1" />

      {isStaff && (
        <button onClick={() => navigate('/emergency')} className="btn-quiet !text-rose-400 hover:!bg-rose-400/[0.08]" title="Emergency">
          <ShieldAlert className="h-[17px] w-[17px]" strokeWidth={1.9} />
          <span className="hidden text-[0.8rem] sm:inline">Emergency</span>
        </button>
      )}

      <button onClick={() => navigate('/notifications')} className="btn-quiet relative !px-2" aria-label="Notifications">
        <Bell className="h-[17px] w-[17px]" strokeWidth={1.9} />
        {notif && notif.unread > 0 && (
          <span className="absolute right-1 top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-coral-400 px-1 text-[0.58rem] font-bold text-white">
            {notif.unread > 9 ? '9+' : notif.unread}
          </span>
        )}
      </button>

      {/* Profile */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenu((v) => !v)}
          className="flex items-center gap-2 rounded-[9px] py-1 pl-1 pr-1.5 transition hover:bg-ink-800"
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-brand-600 text-[0.65rem] font-bold text-white">
            {user ? initials(user.name) : '··'}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-[0.78rem] font-semibold text-slate-800">{user?.name}</span>
            <span className="block text-[0.63rem] text-slate-400">{user ? roleLabel[user.role] : ''}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>

        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg"
              role="menu"
            >
              <div className="border-b border-line px-3 py-2.5">
                <div className="truncate text-[0.82rem] font-semibold text-slate-900">{user?.name}</div>
                <div className="truncate text-[0.7rem] text-slate-400">{user?.email}</div>
              </div>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8rem] text-slate-600 hover:bg-ink-800" role="menuitem">
                <UserRound className="h-4 w-4 text-slate-400" strokeWidth={1.9} /> {user ? roleLabel[user.role] : ''}
              </button>
              <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8rem] text-rose-400 hover:bg-rose-400/[0.07]" role="menuitem">
                <LogOut className="h-4 w-4" strokeWidth={1.9} /> Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

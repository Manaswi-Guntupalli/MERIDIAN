import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelLeft } from 'lucide-react';
import { navFor } from '@/constants/nav';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { cn } from '@/lib/utils';

/** Hover tooltip used by the rail — same treatment ChatGPT gives its sidebar. */
function Tip({ label, side = 'right' }: { label: string; side?: 'right' | 'bottom' }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[0.7rem] font-medium text-white opacity-0 shadow-md transition-opacity group-hover:block group-hover:opacity-100',
        side === 'right' ? 'left-[calc(100%+10px)] top-1/2 -translate-y-1/2' : 'right-0 top-[calc(100%+8px)]',
      )}
    >
      {label}
    </span>
  );
}

/**
 * Navigation: quiet by default, precise when active.
 * ChatGPT-style sidebar: the collapse toggle lives IN the sidebar header.
 * Expanded → toggle at the top-right ("Close sidebar"). Collapsed → a 64px
 * icon rail where hovering the logo morphs it into the "Open sidebar" button.
 * Ctrl/⌘+B toggles from anywhere. State persisted across sessions.
 */
export default function Sidebar({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  const user = useAuth((s) => s.user);
  const railedPref = useUI((s) => s.railed);
  const toggleRail = useUI((s) => s.toggleRail);
  // The mobile drawer is always full-width — a rail there would be pointless.
  const railed = mobile ? false : railedPref;

  useEffect(() => {
    if (mobile) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile, toggleRail]);

  if (!user) return null;
  const items = navFor(user.role);
  const groups = [...new Set(items.map((i) => i.group))];

  const logoMark = (
    <svg width="17" height="17" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M7 23V10l5 7 4-9 4 9 5-7v13" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <motion.aside
      animate={{ width: railed ? 64 : 248 }}
      initial={false}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-surface"
    >
      {/* Header — wordmark + the sidebar's own toggle */}
      {railed ? (
        <div className="flex justify-center pb-5 pt-6">
          {/* Collapsed: the logo IS the toggle — hover swaps it for the
              open-sidebar glyph, exactly like ChatGPT's rail. */}
          <button onClick={toggleRail} aria-label="Open sidebar" className="group relative h-8 w-8">
            <span className="absolute inset-0 grid place-items-center rounded-[9px] bg-brand-600 text-white transition-opacity duration-100 group-hover:opacity-0">
              {logoMark}
            </span>
            <span className="absolute inset-0 grid place-items-center rounded-[9px] text-slate-500 opacity-0 transition-all duration-100 group-hover:bg-ink-800 group-hover:opacity-100">
              <PanelLeft className="h-[17px] w-[17px]" strokeWidth={1.9} />
            </span>
            <Tip label="Open sidebar" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 pb-5 pt-6">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-600 text-white">{logoMark}</div>
          <AnimatePresence initial={false}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="min-w-0 flex-1 leading-tight"
            >
              <div className="font-display text-[0.95rem] font-semibold tracking-tight text-slate-900">Meridian</div>
              <div className="truncate text-[0.62rem] text-slate-400">{user.school?.name ?? 'School OS'}</div>
            </motion.div>
          </AnimatePresence>
          {!mobile && (
            <button
              onClick={toggleRail}
              aria-label="Close sidebar"
              className="group relative grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-slate-400 transition hover:bg-ink-800 hover:text-slate-600"
            >
              <PanelLeft className="h-[17px] w-[17px]" strokeWidth={1.9} />
              <Tip label="Close sidebar" side="bottom" />
            </button>
          )}
        </div>
      )}

      <nav className={cn('no-scrollbar flex-1 overflow-y-auto pb-4', railed ? 'px-2' : 'px-3')}>
        {groups.map((group) => (
          <div key={group} className="mb-5">
            {railed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-line" aria-hidden />
            ) : (
              <div className="px-2.5 pb-1.5 text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-400">{group}</div>
            )}
            <div className="space-y-px">
              {items
                .filter((i) => i.group === group)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center rounded-[8px] text-[0.83rem] transition-colors duration-150',
                        railed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-[7px]',
                        isActive ? 'font-semibold text-brand-700' : 'font-medium text-slate-500 hover:bg-ink-800 hover:text-slate-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="nav-active"
                            className="absolute inset-0 -z-10 rounded-[8px] bg-brand-50"
                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          />
                        )}
                        {isActive && !railed && <span className="absolute -left-3 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r-full bg-brand-600" />}
                        <item.icon
                          className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')}
                          strokeWidth={1.9}
                        />
                        {!railed && <span className="truncate">{item.label}</span>}

                        {/* Tooltip when collapsed */}
                        {railed && <Tip label={item.label} />}
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-line py-3', railed ? 'grid place-items-center px-2' : 'px-4')}>
        {railed ? (
          <span className="live-dot" title="All systems normal" />
        ) : (
          <div className="flex items-center gap-1.5 text-[0.66rem] text-slate-400">
            <span className="live-dot" />
            <span>All systems normal</span>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

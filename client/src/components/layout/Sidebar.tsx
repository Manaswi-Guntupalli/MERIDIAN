import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { navFor } from '@/constants/nav';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  const items = navFor(user.role);
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-ink-950">
          <Logo />
        </div>
        <div>
          <div className="text-sm font-extrabold tracking-tight text-white">MERIDIAN</div>
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500">School OS</div>
        </div>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            <div className="px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-600">{group}</div>
            <div className="space-y-0.5">
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
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                        isActive ? 'text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="nav-active"
                            className="absolute inset-0 -z-10 rounded-xl border border-brand-400/30 bg-brand-500/10"
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                          />
                        )}
                        <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-brand-400')} />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3 text-[0.65rem] text-slate-600">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulseGlow rounded-full bg-mint-400" />
          Offline-first · event-sourced
        </div>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
      <path d="M7 23V10l5 7 4-9 4 9 5-7v13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

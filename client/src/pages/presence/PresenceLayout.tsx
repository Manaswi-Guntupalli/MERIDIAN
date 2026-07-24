import { NavLink, Outlet } from 'react-router-dom';
import { Moon } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { useSchoolStatus } from '@/hooks/useSchoolStatus';
import PageHeader from '@/components/PageHeader';

const TABS = [
  { to: '/presence', label: 'Sessions', end: true, admin: false },
  { to: '/presence/kiosk', label: 'Kiosk', end: false, admin: false },
  { to: '/presence/enrollment', label: 'Enrollment', end: false, admin: true },
  { to: '/presence/activity', label: 'Activity', end: false, admin: false },
  { to: '/presence/analytics', label: 'Analytics', end: false, admin: false },
  { to: '/presence/insights', label: 'Insights', end: false, admin: false },
  { to: '/presence/simulator', label: 'Simulator', end: false, admin: true },
];

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'];

export default function PresenceLayout() {
  const user = useAuth((s) => s.user);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const school = useSchoolStatus();

  return (
    <div>
      <PageHeader
        overline="Engine 05 · Presence"
        title="Presence"
        subtitle="Face-recognition attendance with a session QR fallback. Every mark flows through one engine — explainable, auditable and reversible like the rest of Meridian."
      />

      {/* Live attendance is time-bound — when school is out of session, say so
          plainly. Nothing is disabled: history and analytics stay available,
          and the Simulator still works for demos. */}
      {!school.inSession && school.phase !== 'LOADING' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-ink-800/40 px-4 py-3">
          <Moon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-xs leading-relaxed text-slate-500">
            <b className="text-slate-700">School is out of session ({school.label.toLowerCase()}).</b> Live attendance capture is idle — {school.detail.toLowerCase()}.
            History &amp; analytics remain fully available, and the Simulator still runs for demos and testing.
          </p>
        </div>
      )}

      <div className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-line pb-px">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'relative whitespace-nowrap px-3.5 py-2.5 text-[0.83rem] font-semibold transition-colors',
                isActive ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800',
              )
            }
          >
            {({ isActive }) => (
              <>
                {t.label}
                {isActive && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-brand-600" />}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

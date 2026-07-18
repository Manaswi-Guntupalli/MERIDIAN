import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';

const TABS = [
  { to: '/presence', label: 'Overview', end: true, admin: false },
  { to: '/presence/activity', label: 'Activity', end: false, admin: false },
  { to: '/presence/analytics', label: 'Analytics', end: false, admin: false },
  { to: '/presence/manage', label: 'Manage', end: false, admin: true },
  { to: '/presence/simulator', label: 'Simulator', end: false, admin: true },
];

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'];

export default function PresenceLayout() {
  const user = useAuth((s) => s.user);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const tabs = TABS.filter((t) => !t.admin || isAdmin);

  return (
    <div>
      <PageHeader
        overline="Engine 05 · Presence"
        title="Presence"
        subtitle="Event-driven attendance — RFID, QR, manual and face recognition all flow through one pipeline, the single source of truth for the rest of Meridian."
      />
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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, History, LayoutDashboard } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import PageHeader from '@/components/PageHeader';
import { Badge, LoadingScreen } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { KOverview } from './kairos/types';
import OverviewTab from './kairos/OverviewTab';
import TimetableTab from './kairos/TimetableTab';
import HistoryTab from './kairos/HistoryTab';

type Tab = 'overview' | 'timetable' | 'history';

/**
 * Kairos — the school's timetable, run like a product:
 * Overview (status & actions) · Timetable (the grid) · History (versions).
 * Three pages, no solver jargon; the intelligence stays behind the "Why?".
 */
export default function Kairos() {
  const user = useAuth((s) => s.user)!;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);
  const isPrincipal = ['SUPER_ADMIN', 'PRINCIPAL'].includes(user.role);
  const [tab, setTab] = useState<Tab>(isAdmin ? 'overview' : 'timetable');
  const [ttView, setTtView] = useState<'draft' | 'live'>('live');

  const overview = useQuery({
    queryKey: ['kairos-overview'],
    queryFn: async () => (await api.get('/timetable/overview')).data as KOverview,
    enabled: isAdmin || user.role === 'TEACHER',
  });

  const active = overview.data?.active;
  const tabs: { key: Tab; label: string; icon: typeof LayoutDashboard; show: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, show: isAdmin || user.role === 'TEACHER' },
    { key: 'timetable', label: 'Timetable', icon: CalendarClock, show: true },
    { key: 'history', label: 'History', icon: History, show: isAdmin || user.role === 'TEACHER' },
  ];

  return (
    <div>
      <PageHeader
        overline="Engine 02 · Kairos"
        title="Timetable"
        subtitle="Generate, review, publish — and always know why every lesson is where it is."
        actions={
          active ? (
            <div className="flex items-center gap-2">
              <Badge severity="SUCCESS">v{active.version} live</Badge>
              <Badge>Health {active.score}/100</Badge>
            </div>
          ) : undefined
        }
      />

      {/* Three pages, one quiet tab rail */}
      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors',
              tab === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-400 hover:text-slate-700',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' &&
        (overview.isLoading || !overview.data ? (
          <LoadingScreen label="Checking timetable status…" />
        ) : (
          <OverviewTab
            overview={overview.data}
            isAdmin={isAdmin}
            isPrincipal={isPrincipal}
            onGoToTimetable={(v) => {
              setTtView(v);
              setTab('timetable');
            }}
          />
        ))}
      {tab === 'timetable' && <TimetableTab isAdmin={isAdmin} view={ttView} onViewChange={setTtView} />}
      {tab === 'history' && <HistoryTab isPrincipal={isPrincipal} />}
    </div>
  );
}

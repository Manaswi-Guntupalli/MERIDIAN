import { useQuery } from '@tanstack/react-query';
import { UserCheck, Clock, UserX, Building2, Radio, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, StatTile, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { timeAgo, initials, cn } from '@/lib/utils';
import type { AttendanceEventRow, PresenceTodaySummary, RFIDReaderRow } from '@/types';
import { EVENT_BADGE, directionLabel } from './shared';

export default function PresenceOverview() {
  const today = useQuery({
    queryKey: ['presence-analytics', 'today'],
    queryFn: async () => (await api.get('/presence/analytics/today')).data as PresenceTodaySummary,
    refetchInterval: 30_000,
  });
  const occupancy = useQuery({
    queryKey: ['presence-analytics', 'occupancy'],
    queryFn: async () => (await api.get('/presence/analytics/occupancy')).data as { onCampus: number; entries: number; exits: number },
    refetchInterval: 30_000,
  });
  const readers = useQuery({
    queryKey: ['presence-readers'],
    queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[],
    refetchInterval: 30_000,
  });
  const feed = useQuery({
    queryKey: ['presence-events', 'overview'],
    queryFn: async () => (await api.get('/presence/events', { params: { limit: 12 } })).data.events as AttendanceEventRow[],
    refetchInterval: 15_000,
  });

  if (today.isLoading) return <LoadingScreen />;
  const t = today.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Present" value={t?.present ?? 0} icon={<UserCheck className="h-4 w-4" />} accent="mint" index={0} />
        <StatTile label="Late" value={t?.late ?? 0} icon={<Clock className="h-4 w-4" />} accent="amber" index={1} />
        <StatTile label="Absent / unmarked" value={t?.absent ?? 0} icon={<UserX className="h-4 w-4" />} accent="rose" index={2} />
        <StatTile label="On campus now" value={occupancy.data?.onCampus ?? '—'} icon={<Building2 className="h-4 w-4" />} accent="cyan" index={3} />
        <StatTile
          label="Readers online"
          value={`${t?.readersOnline ?? 0}/${(t?.readersOnline ?? 0) + (t?.readersOffline ?? 0)}`}
          icon={<Radio className="h-4 w-4" />}
          accent="brand"
          index={4}
        />
        <StatTile label="Unknown cards" value={t?.unknownCards ?? 0} icon={<ShieldAlert className="h-4 w-4" />} accent="rose" index={5} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="!p-0 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <span className="h-2 w-2 animate-pulseGlow rounded-full bg-mint-400" />
            <h2 className="font-bold text-slate-900">Live event feed</h2>
          </div>
          <div className="max-h-[26rem] overflow-y-auto no-scrollbar p-3">
            {feed.isLoading ? (
              <LoadingScreen />
            ) : feed.data?.length ? (
              feed.data.map((e) => {
                const badge = EVENT_BADGE[e.verificationStatus];
                return (
                  <div key={e.id} className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-ink-800/60 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
                      {e.student ? initials(e.student.name) : '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{e.student?.name ?? 'Unknown card'}</div>
                      <div className="truncate text-xs text-slate-500">
                        {e.reader?.location ?? 'No reader'} · {directionLabel(e.direction)} · {timeAgo(e.timestamp)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge severity={badge.severity}>{badge.label}</Badge>
                      <span className="text-[0.6rem] text-slate-500">{e.source}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState title="No scans yet today" hint="Run the Simulator to generate live activity." />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-slate-900">Reader health</h2>
          <div className="space-y-2">
            {readers.isLoading ? (
              <LoadingScreen />
            ) : readers.data?.length ? (
              readers.data.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-800/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
                    <div className="truncate text-xs text-slate-500">{r.location}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn('flex items-center gap-1 text-xs font-semibold', r.online ? 'text-mint-500' : 'text-rose-500')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', r.online ? 'bg-mint-400' : 'bg-rose-400')} />
                      {r.online ? 'Online' : 'Offline'}
                    </span>
                    <span className="text-[0.65rem] text-slate-500">{r.lastHeartbeat ? timeAgo(r.lastHeartbeat) : 'never'}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No readers configured" hint="Add one under Readers." />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Clock, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { timeAgo } from '@/lib/utils';
import type { AttendanceEventRow, EventItem } from '@/types';
import { EVENT_BADGE, directionLabel, StudentPicker } from './shared';

export default function PresenceHistory() {
  const [params, setParams] = useSearchParams();
  const [studentId, setStudentId] = useState(params.get('studentId') ?? '');

  useEffect(() => {
    if (studentId) setParams({ studentId }, { replace: true });
  }, [studentId, setParams]);

  const history = useQuery({
    queryKey: ['presence-history', studentId],
    queryFn: async () => (await api.get(`/presence/history/${studentId}`)).data as { student: { id: string; name: string; rollNo: number }; events: AttendanceEventRow[]; trail: EventItem[] },
    enabled: !!studentId,
  });

  const lateCount = history.data?.events.filter((e) => e.late).length ?? 0;
  const entryCount = history.data?.events.filter((e) => e.direction === 'ENTRY' || e.direction === 'REENTRY').length ?? 0;
  const exitCount = history.data?.events.filter((e) => e.direction === 'EXIT').length ?? 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <div className="min-w-[16rem] flex-1"><StudentPicker value={studentId} onChange={setStudentId} /></div>
        {history.data && (
          <div className="flex gap-4 text-xs text-slate-500">
            <span><b className="text-slate-800">{entryCount}</b> entries</span>
            <span><b className="text-slate-800">{exitCount}</b> exits</span>
            <span><b className="text-amber-600">{lateCount}</b> late</span>
          </div>
        )}
      </Card>

      {!studentId ? (
        <EmptyState title="Select a student" hint="Their full entry/exit/late/manual-override timeline appears here." />
      ) : history.isLoading ? (
        <LoadingScreen />
      ) : history.data?.events.length ? (
        <div className="grid gap-2">
          {history.data.events.map((e) => {
            const badge = EVENT_BADGE[e.verificationStatus];
            const wasReverted = history.data!.trail.some((t) => t.aggregateId === e.id && t.reverted);
            return (
              <Card key={e.id} className="flex items-center gap-3 !py-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-800 text-slate-500">
                  {e.direction === 'EXIT' ? <ArrowRightLeft className="h-4 w-4 rotate-180" /> : e.late ? <Clock className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {directionLabel(e.direction)} · {e.source}
                    {e.source === 'MANUAL' && <span className="ml-1.5 text-xs font-normal text-cyan-600">manual override</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {new Date(e.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {timeAgo(e.timestamp)}
                    {e.reader ? ` · ${e.reader.location}` : ''}
                  </div>
                </div>
                {e.late && e.lateMinutes != null && <Badge severity="WARNING">{e.lateMinutes}m late</Badge>}
                {wasReverted && <Badge severity="INFO"><Undo2 className="h-3 w-3" /> reverted</Badge>}
                <Badge severity={badge.severity}>{badge.label}</Badge>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No attendance events yet" />
      )}
    </div>
  );
}

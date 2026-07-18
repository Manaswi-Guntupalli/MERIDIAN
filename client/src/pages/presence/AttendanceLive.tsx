import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck2, LogOut } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { timeAgo } from '@/lib/utils';
import type { AttendanceEventRow, RFIDReaderRow } from '@/types';
import { EVENT_BADGE, directionLabel, StudentPicker } from './shared';

const STATUS_FILTERS = ['ALL', 'VERIFIED', 'LATE', 'DUPLICATE', 'UNKNOWN', 'REJECTED'] as const;

export default function PresenceAttendanceLive() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  // Deep links can pre-filter the feed: ?status=UNKNOWN (notification links)
  // or the legacy ?filter=unknown form.
  const [params] = useSearchParams();
  const urlStatus = (params.get('status') ?? (params.get('filter') === 'unknown' ? 'UNKNOWN' : '')).toUpperCase();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>(
    (STATUS_FILTERS as readonly string[]).includes(urlStatus) ? (urlStatus as (typeof STATUS_FILTERS)[number]) : 'ALL',
  );
  const [readerId, setReaderId] = useState('');
  const [manualStudent, setManualStudent] = useState('');

  const readers = useQuery({ queryKey: ['presence-readers'], queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[] });
  const events = useQuery({
    queryKey: ['presence-events', 'live', status, readerId],
    queryFn: async () =>
      (
        await api.get('/presence/events', {
          params: { limit: 100, ...(status !== 'ALL' ? { status } : {}), ...(readerId ? { readerId } : {}) },
        })
      ).data.events as AttendanceEventRow[],
    refetchInterval: 10_000,
  });

  const manual = useMutation({
    mutationFn: async (direction: 'ENTRY' | 'EXIT') => (await api.post('/presence/scan', { source: 'MANUAL', studentId: manualStudent, direction })).data,
    onSuccess: (res) => {
      pushToast({ title: res.status === 'LATE' ? 'Marked late' : 'Marked', body: `${res.student?.name ?? 'Student'} — ${directionLabel(res.direction)}`, severity: res.status === 'LATE' ? 'WARNING' : 'SUCCESS' });
      setManualStudent('');
      qc.invalidateQueries({ queryKey: ['presence-events'] });
      qc.invalidateQueries({ queryKey: ['presence-analytics'] });
    },
    onError: (e) => pushToast({ title: 'Manual correction failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Manual correction</span>
          <StudentPicker value={manualStudent} onChange={setManualStudent} />
        </div>
        <button disabled={!manualStudent || manual.isPending} onClick={() => manual.mutate('ENTRY')} className="btn-primary !py-2 text-xs"><UserCheck2 className="h-3.5 w-3.5" /> Mark entry</button>
        <button disabled={!manualStudent || manual.isPending} onClick={() => manual.mutate('EXIT')} className="btn-ghost !py-2 text-xs"><LogOut className="h-3.5 w-3.5" /> Mark exit</button>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input w-40">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>)}
        </select>
        <select value={readerId} onChange={(e) => setReaderId(e.target.value)} className="input w-48">
          <option value="">All readers</option>
          {readers.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span className="text-xs text-slate-500">{events.data?.length ?? 0} events</span>
      </div>

      {events.isLoading ? (
        <LoadingScreen />
      ) : events.data?.length ? (
        <div className="grid gap-2">
          {events.data.map((e) => {
            const badge = EVENT_BADGE[e.verificationStatus];
            return (
              <Card key={e.id} className="flex items-center gap-3 !py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{e.student?.name ?? 'Unknown card'}{e.student ? ` · Roll ${e.student.rollNo}` : ''}</div>
                  <div className="truncate text-xs text-slate-500">
                    {e.reader?.location ?? (e.source === 'MANUAL' ? 'Manual' : e.source === 'CV' ? 'Face kiosk' : 'No reader')} · {directionLabel(e.direction)} · {e.source} · {timeAgo(e.timestamp)}
                    {e.notes && e.verificationStatus !== 'VERIFIED' && e.verificationStatus !== 'LATE' ? ` — ${e.notes}` : ''}
                  </div>
                </div>
                {e.late && e.lateMinutes != null && <Badge severity="WARNING">{e.lateMinutes}m late</Badge>}
                <Badge severity={badge.severity}>{badge.label}</Badge>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No events match these filters" />
      )}
    </div>
  );
}

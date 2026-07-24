import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { timeAgo } from '@/lib/utils';
import type { AttendanceEventRow } from '@/types';
import { EVENT_BADGE, METHOD_LABEL } from './shared';

const STATUS_FILTERS = ['ALL', 'VERIFIED', 'LATE', 'PROXY', 'UNVERIFIED_QR', 'DUPLICATE'] as const;

export default function PresenceActivity() {
  const [params] = useSearchParams();
  const urlStatus = (params.get('status') ?? '').toUpperCase();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>(
    (STATUS_FILTERS as readonly string[]).includes(urlStatus) ? (urlStatus as (typeof STATUS_FILTERS)[number]) : 'ALL',
  );
  const [source, setSource] = useState('');

  const events = useQuery({
    queryKey: ['presence-events', status, source],
    queryFn: async () =>
      (await api.get('/presence/events', { params: { limit: 100, ...(status !== 'ALL' ? { status } : {}), ...(source ? { source } : {}) } })).data.events as AttendanceEventRow[],
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_FILTERS)[number])} className="input w-44">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s.replace('_', ' ')}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="input w-36">
          <option value="">All methods</option>
          <option value="FACE">Face</option>
          <option value="QR">QR</option>
          <option value="MANUAL">Manual</option>
        </select>
        <span className="text-xs text-slate-500">{events.data?.length ?? 0} events</span>
      </div>

      {events.isLoading ? (
        <LoadingScreen />
      ) : events.data?.length ? (
        <div className="grid gap-2">
          {events.data.map((e) => {
            const badge = EVENT_BADGE[e.verificationStatus] ?? { label: e.verificationStatus, severity: 'INFO' as const };
            return (
              <Card key={e.id} className="flex items-center gap-3 !py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{e.student?.name ?? 'Unknown'}{e.student ? ` · Roll ${e.student.rollNo}` : ''}</div>
                  <div className="truncate text-xs text-slate-500">
                    {e.session?.class?.name ?? e.student?.class?.name ?? '—'} · {METHOD_LABEL[e.source] ?? e.source} · {timeAgo(e.timestamp)}
                    {e.faceConfidence ? ` · ${Math.round(e.faceConfidence * 100)}%` : ''}
                    {e.notes && (e.verificationStatus === 'PROXY' || e.verificationStatus === 'REJECTED') ? ` — ${e.notes}` : ''}
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

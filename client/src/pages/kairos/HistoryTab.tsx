import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, GitCompareArrows, History, RotateCcw, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Badge, Card, EmptyState, LoadingScreen, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import TimetableGrid from './TimetableGrid';
import type { KTimetable, KTimetableMeta, KVersionCompare } from './types';

/**
 * Version history: every publish is a version. View any of them, compare two
 * side by side, and — for the principal — restore a previous one in a single
 * transactional swap.
 */
export default function HistoryTab({ isPrincipal }: { isPrincipal: boolean }) {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [viewing, setViewing] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [confirmRollback, setConfirmRollback] = useState<KTimetableMeta | null>(null);

  const versions = useQuery({
    queryKey: ['kairos-versions'],
    queryFn: async () => (await api.get('/timetable/versions')).data.versions as KTimetableMeta[],
  });

  const viewed = useQuery({
    queryKey: ['kairos-version', viewing],
    queryFn: async () => (await api.get(`/timetable/versions/${viewing}`)).data.timetable as KTimetable,
    enabled: !!viewing,
  });

  const diff = useQuery({
    queryKey: ['kairos-compare', ...compare],
    queryFn: async () =>
      (await api.get('/timetable/versions/compare', { params: { a: compare[0], b: compare[1] } })).data as KVersionCompare,
    enabled: compare.length === 2,
  });

  const rollback = useMutation({
    mutationFn: async (id: string) => (await api.post(`/timetable/versions/${id}/rollback`)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['kairos-versions'] });
      qc.invalidateQueries({ queryKey: ['kairos-live'] });
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      setConfirmRollback(null);
      pushToast({ title: `Restored v${res.timetable.version}`, body: 'The school is now running on this version.', severity: 'SUCCESS' });
    },
    onError: (err) => pushToast({ title: 'Rollback failed', body: apiError(err), severity: 'CRITICAL' }),
  });

  const toggleCompare = (id: string) =>
    setCompare((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id]));

  if (versions.isLoading) return <LoadingScreen label="Loading history…" />;
  if (!versions.data?.length)
    return <EmptyState icon={<History className="h-8 w-8" />} title="No versions yet" hint="Publish a timetable to start its history." />;

  const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Select two versions to compare them.</p>
        {compare.length === 2 && (
          <button onClick={() => setCompare([])} className="btn-ghost text-xs"><X className="h-3.5 w-3.5" /> Clear selection</button>
        )}
      </div>

      <div className="space-y-2.5">
        {versions.data.map((v) => (
          <Card key={v.id} className={cn('!py-3.5 transition-colors', compare.includes(v.id) && '!border-brand-500/40')}>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={compare.includes(v.id)}
                  onChange={() => toggleCompare(v.id)}
                  className="h-3.5 w-3.5 accent-[#0E7C6B]"
                  aria-label={`Select v${v.version} for comparison`}
                />
                <span className="font-display text-lg font-semibold text-slate-900">v{v.version}</span>
              </label>
              {v.active ? <Badge severity="SUCCESS">Live</Badge> : <Badge>Archived</Badge>}
              <span className="text-xs text-slate-500">Health {v.score}/100</span>
              <span className="hidden text-xs text-slate-400 sm:inline">
                Published by <span className="font-semibold text-slate-600">{v.publishedByName ?? '—'}</span> · {fmt(v.publishedAt)}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => setViewing(viewing === v.id ? null : v.id)} className="btn-ghost text-xs">
                  <Eye className="h-3.5 w-3.5" /> {viewing === v.id ? 'Hide' : 'View'}
                </button>
                {isPrincipal && !v.active && (
                  <button onClick={() => setConfirmRollback(v)} className="btn-ghost text-xs !text-amber-500">
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </button>
                )}
              </div>
            </div>

            {viewing === v.id && (
              <div className="mt-4">
                {viewed.isLoading || !viewed.data ? (
                  <LoadingScreen label="Loading version…" />
                ) : (
                  <VersionPreview timetable={viewed.data} />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Comparison result */}
      {compare.length === 2 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-brand-400" />
            <h2 className="font-bold text-slate-900">
              {diff.data ? `v${diff.data.a.version} → v${diff.data.b.version}` : 'Comparing…'}
            </h2>
            {diff.data && (
              <span className="text-xs text-slate-400">
                {diff.data.changeCount === 0 ? 'Identical' : `${diff.data.changeCount} change(s) · ${diff.data.unchanged} unchanged`}
              </span>
            )}
          </div>
          {diff.isLoading ? (
            <Spinner />
          ) : diff.data && diff.data.changes.length > 0 ? (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {diff.data.changes.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink-800/40 px-3 py-2 text-xs">
                  <Badge>{c.className}</Badge>
                  <span className="text-slate-400">Day {c.day + 1} · P{c.period + 1}</span>
                  <span className={cn('font-medium', c.from ? 'text-slate-600' : 'text-slate-300')}>{c.from ?? 'free'}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span className={cn('font-semibold', c.to ? 'text-mint-500' : 'text-rose-400')}>{c.to ?? 'free'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">These versions are identical.</p>
          )}
        </Card>
      )}

      {/* Rollback confirmation */}
      {confirmRollback && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setConfirmRollback(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">Restore v{confirmRollback.version}?</h2>
            <p className="mt-2 text-sm text-slate-500">
              The whole school switches to this version immediately — dashboards, attendance and the digital twin included. The current
              version stays in history, so you can switch back any time.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmRollback(null)} className="btn-ghost">Cancel</button>
              <button onClick={() => rollback.mutate(confirmRollback.id)} disabled={rollback.isPending} className="btn-primary">
                {rollback.isPending ? <Spinner /> : <><RotateCcw className="h-4 w-4" /> Restore</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only mini view of a version, one class at a time. */
function VersionPreview({ timetable }: { timetable: KTimetable }) {
  const classes = [...new Map(timetable.slots.map((s) => [s.classId, s.className])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  return (
    <div className="space-y-3">
      <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input w-36">
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <TimetableGrid timetable={timetable} mode="class" entityId={classId} compact />
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  HeartPulse,
  History,
  Send,
  Settings2,
  Sparkles,
  UserX,
  Wand2,
} from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Badge, Card, Meter, Spinner, StatTile } from '@/components/ui';
import { cn, timeAgo } from '@/lib/utils';
import type { KIssue, KOverview } from './types';
import SetupDrawer from './SetupDrawer';
import CoverDialog from './CoverDialog';

/**
 * The Kairos landing page: where the timetable stands, whether the school is
 * ready to generate, and the one-line pipeline from draft to published.
 * No solver jargon — just status, health and next actions.
 */
export default function OverviewTab({
  overview,
  isAdmin,
  isPrincipal,
  onGoToTimetable,
}: {
  overview: KOverview;
  isAdmin: boolean;
  isPrincipal: boolean;
  onGoToTimetable: (view: 'draft' | 'live') => void;
}) {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [setupOpen, setSetupOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [blockers, setBlockers] = useState<KIssue[] | null>(null);

  const { active, draft, issues, setup, versions } = overview;
  const blockerCount = issues.filter((i) => i.severity === 'BLOCKER').length;
  const health = (draft ?? active)?.health;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['kairos-overview'] });
    qc.invalidateQueries({ queryKey: ['kairos-draft'] });
    qc.invalidateQueries({ queryKey: ['kairos-live'] });
    qc.invalidateQueries({ queryKey: ['kairos-versions'] });
  };

  const generate = useMutation({
    mutationFn: async (keepLocks: boolean) => (await api.post('/timetable/generate', { keepLocks })).data,
    onSuccess: (res) => {
      refresh();
      setBlockers(null);
      pushToast({
        title: 'Draft ready for review',
        body: `Health ${res.timetable.score}/100 · generated in ${(res.timetable.solveMs / 1000).toFixed(1)}s`,
        severity: 'SUCCESS',
      });
      onGoToTimetable('draft');
    },
    onError: (err: any) => {
      const iss = err?.response?.data?.issues as KIssue[] | undefined;
      if (iss) {
        setBlockers(iss.filter((i) => i.severity === 'BLOCKER'));
        pushToast({ title: 'Cannot generate yet', body: 'Fix the blockers listed below first.', severity: 'WARNING' });
      } else pushToast({ title: 'Generation failed', body: apiError(err), severity: 'CRITICAL' });
    },
  });

  const approve = useMutation({
    mutationFn: async () => (await api.post('/timetable/draft/approve')).data,
    onSuccess: () => {
      refresh();
      pushToast({ title: 'Draft approved', body: 'It can now be published.', severity: 'SUCCESS' });
    },
    onError: (err) => pushToast({ title: 'Approval failed', body: apiError(err), severity: 'CRITICAL' }),
  });

  const publish = useMutation({
    mutationFn: async () => (await api.post('/timetable/draft/publish')).data,
    onSuccess: (res) => {
      refresh();
      pushToast({
        title: `Timetable v${res.timetable.version} is live`,
        body: 'Every dashboard now follows the new schedule.',
        severity: 'SUCCESS',
      });
    },
    onError: (err) => pushToast({ title: 'Publish failed', body: apiError(err), severity: 'CRITICAL' }),
  });

  const discard = useMutation({
    mutationFn: async () => (await api.delete('/timetable/draft')).data,
    onSuccess: () => {
      refresh();
      pushToast({ title: 'Draft discarded', body: 'The live timetable is untouched.', severity: 'INFO' });
    },
  });

  // Pipeline stage: 0 setup → 1 generate → 2 review → 3 approve → 4 publish
  const stage = draft ? (draft.status === 'APPROVED' ? 3 : 2) : blockerCount ? 0 : 1;

  return (
    <div className="space-y-6">
      {/* Status tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          label="Live timetable"
          value={active ? `v${active.version}` : '—'}
          sub={active ? `Published by ${active.publishedByName ?? '—'} · ${active.publishedAt ? timeAgo(active.publishedAt) : ''}` : 'Nothing published yet'}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatTile
          index={1}
          label="Health score"
          value={active || draft ? `${(draft ?? active)!.score}` : '—'}
          sub={draft ? 'of the current draft' : active ? 'of the live timetable' : 'Generate to see health'}
          icon={<HeartPulse className="h-4 w-4" />}
          accent={((draft ?? active)?.score ?? 0) >= 85 ? 'mint' : ((draft ?? active)?.score ?? 0) >= 70 ? 'amber' : 'rose'}
        />
        <StatTile
          index={2}
          label="Checks"
          value={blockerCount ? `${blockerCount} blocker${blockerCount > 1 ? 's' : ''}` : issues.length ? `${issues.length} notice${issues.length > 1 ? 's' : ''}` : 'All clear'}
          sub={blockerCount ? 'Must be fixed before generating' : 'Ready to generate'}
          icon={blockerCount ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          accent={blockerCount ? 'rose' : 'mint'}
        />
        <StatTile
          index={3}
          label="School week"
          value={`${setup.workingDays}d × ${setup.periodsPerDay}`}
          sub={`${setup.classesWithPlan}/${setup.classesTotal} classes planned · ${setup.teachers} teachers · ${setup.labs} labs`}
          icon={<Settings2 className="h-4 w-4" />}
          accent="cyan"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Publish pipeline */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">From draft to live</h2>
              {draft && <Badge severity={draft.status === 'APPROVED' ? 'SUCCESS' : 'INFO'}>{draft.status === 'APPROVED' ? 'Approved — ready to publish' : 'Draft in review'}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {['Generate', 'Review & adjust', 'Approve', 'Publish'].map((step, i) => (
                <div key={step} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1 font-semibold',
                      i + 1 <= stage
                        ? 'border-mint-400/30 bg-mint-400/10 text-mint-500'
                        : i === stage
                          ? 'border-brand-500/40 bg-brand-50 text-brand-600'
                          : 'border-line text-slate-400',
                    )}
                  >
                    {i + 1 <= stage ? '✓ ' : ''}{step}
                  </span>
                  {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isAdmin && (
                <button onClick={() => generate.mutate(!!draft)} disabled={generate.isPending} className="btn-primary">
                  {generate.isPending ? <Spinner /> : <><Wand2 className="h-4 w-4" /> {draft ? 'Regenerate (keeps locked slots)' : 'Generate draft'}</>}
                </button>
              )}
              {draft && (
                <button onClick={() => onGoToTimetable('draft')} className="btn-ghost">
                  Review draft
                </button>
              )}
              {draft && isPrincipal && draft.status !== 'APPROVED' && (
                <button onClick={() => approve.mutate()} disabled={approve.isPending} className="btn-ghost !text-mint-500">
                  {approve.isPending ? <Spinner /> : <><CheckCircle2 className="h-4 w-4" /> Approve</>}
                </button>
              )}
              {draft && isPrincipal && draft.status === 'APPROVED' && (
                <button onClick={() => publish.mutate()} disabled={publish.isPending} className="btn-primary !bg-mint-500 hover:!bg-mint-400">
                  {publish.isPending ? <Spinner /> : <><Send className="h-4 w-4" /> Publish</>}
                </button>
              )}
              {draft && isAdmin && (
                <button onClick={() => discard.mutate()} disabled={discard.isPending} className="btn-ghost !text-rose-400">
                  Discard draft
                </button>
              )}
            </div>
            {draft && !isPrincipal && draft.status !== 'APPROVED' && (
              <p className="mt-3 text-xs text-slate-400">The principal approves and publishes; you can keep refining the draft until then.</p>
            )}
          </Card>

          {/* Pre-flight checks */}
          <Card>
            <h2 className="mb-3 font-bold text-slate-900">Pre-flight checks</h2>
            {(blockers ?? issues).length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <CheckCircle2 className="h-4 w-4 text-mint-400" />
                Everything needed for a full timetable is in place.
              </div>
            ) : (
              <div className="space-y-2.5">
                {(blockers ?? issues).map((i, idx) => (
                  <div key={idx} className={cn('rounded-xl border p-3', i.severity === 'BLOCKER' ? 'border-rose-400/25 bg-rose-500/[0.04]' : 'border-amber-400/25 bg-amber-400/[0.05]')}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', i.severity === 'BLOCKER' ? 'text-rose-400' : 'text-amber-400')} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{i.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{i.detail}</div>
                        {i.fix && <div className="mt-1 text-xs font-medium text-brand-500">→ {i.fix}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Health detail of the timetable being worked on */}
          {health && (health.unplaced.length > 0 || health.warnings.length > 0) && (
            <Card>
              <h2 className="mb-3 font-bold text-slate-900">Needs attention</h2>
              <div className="space-y-2.5">
                {health.unplaced.map((u, i) => (
                  <div key={`u-${i}`} className="rounded-xl border border-rose-400/25 bg-rose-500/[0.04] p-3">
                    <div className="text-sm font-semibold text-slate-800">
                      {u.className} · {u.subjectName} — {u.count} period{u.count > 1 ? 's' : ''} unscheduled
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{u.cause}</div>
                    {u.fixes.map((f, j) => (
                      <div key={j} className="mt-1 text-xs"><span className="font-semibold text-mint-500">{f.label}</span><span className="text-slate-500"> · {f.detail}</span></div>
                    ))}
                  </div>
                ))}
                {health.warnings.map((w, i) => (
                  <div key={`w-${i}`} className="flex items-start gap-2 text-xs text-slate-500">
                    <span className="mt-0.5 text-amber-400">•</span> {w}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Health breakdown */}
          {health && (
            <Card>
              <h2 className="mb-3 font-bold text-slate-900">Health</h2>
              {(
                [
                  ['Coverage', health.breakdown.placement, 'Every planned period on the grid'],
                  ['Balance', health.breakdown.balance, 'Spread, gaps and heavy-subject timing'],
                  ['Staff comfort', health.breakdown.preferences, 'Preferred free periods honoured'],
                ] as const
              ).map(([label, value, hint]) => (
                <div key={label} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">{label}</span>
                    <span className="tnum text-slate-400">{value}/100</span>
                  </div>
                  <Meter value={value} tone={value >= 85 ? 'mint' : value >= 70 ? 'brand' : 'amber'} />
                  <div className="mt-1 text-[0.65rem] text-slate-400">{hint}</div>
                </div>
              ))}
            </Card>
          )}

          {/* Emergency cover */}
          {isAdmin && (
            <Card>
              <h2 className="mb-2 font-bold text-slate-900">Day-to-day</h2>
              <p className="mb-3 text-xs text-slate-500">A teacher out today? Kairos re-covers only the affected periods — the timetable itself doesn't change.</p>
              <button onClick={() => setCoverOpen(true)} className="btn-ghost w-full justify-center !border !border-line">
                <UserX className="h-4 w-4" /> Arrange cover
              </button>
            </Card>
          )}

          {/* Setup */}
          {isAdmin && (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">Setup</h2>
                <Badge>{setup.academicYear}</Badge>
              </div>
              <div className="space-y-1 text-xs text-slate-500">
                <div>School day starts {setup.dayStart} · {setup.periodMinutes}-minute periods</div>
                <div>{setup.classesWithPlan} of {setup.classesTotal} classes have a curriculum</div>
              </div>
              <button onClick={() => setSetupOpen(true)} className="btn-ghost mt-3 w-full justify-center !border !border-line">
                <Settings2 className="h-4 w-4" /> Open setup
              </button>
            </Card>
          )}

          {/* Recent versions */}
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              <h2 className="font-bold text-slate-900">Recent versions</h2>
            </div>
            {versions.length === 0 ? (
              <p className="text-xs text-slate-400">Publishing creates version history you can compare and restore.</p>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">v{v.version}</span>
                    <span className="text-slate-400">{v.publishedByName ?? '—'}</span>
                    {v.active ? <Badge severity="SUCCESS">Live</Badge> : <span className="text-slate-300">{v.publishedAt ? timeAgo(v.publishedAt) : ''}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* The promise */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-dashed border-line p-4 text-xs text-slate-400">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
            Kairos never breaks a hard rule — no double-booked teachers, rooms or classes, no unqualified assignments. When something can't fit, it tells you why instead.
          </div>
        </div>
      </div>

      {setupOpen && <SetupDrawer onClose={() => setSetupOpen(false)} />}
      {coverOpen && <CoverDialog onClose={() => setCoverOpen(false)} />}
    </div>
  );
}

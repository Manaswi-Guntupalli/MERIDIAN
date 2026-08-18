import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import {
  GraduationCap, Users, CalendarCheck, Wallet, Activity, ArrowUpRight,
  AlertTriangle, CalendarClock, Sparkles, RefreshCw, ChevronLeft, ChevronRight,
  Clock, DoorOpen, User as UserIcon, Bell, UserX,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { StatTile, Card, Badge, Meter, LoadingScreen, EmptyState, ConfidenceRing } from '@/components/ui';
import HealthGauge, { HealthGaugePlaceholder } from '@/components/HealthGauge';
import { inr, pct, severityColor, cn, confColor, timeAgo, firstName } from '@/lib/utils';
import { useSchoolStatus } from '@/hooks/useSchoolStatus';
import { T, CHART } from '@/constants/theme';
import { DUR, EASE_OUT, fadeUp } from '@/constants/motion';
import type { DashboardStats } from '@/types';

// ── Intelligence engine payload (mirrors the Python service's response;
//    the client only DISPLAYS these values — it computes nothing) ──
interface Evidence { label: string; value: string | number; detail?: string }
interface IntelConfidence { value: number; explanation: string; components: Record<string, number | string> }
interface IntelInsight {
  id: string; module: string; severity: string; title: string;
  evidence: Evidence[]; confidence: IntelConfidence;
  affected: { count: number; entities: string[] };
  reason: string; expectedImpact: string; timestamp: string;
  trace: { model?: string; window?: unknown; dataSources?: string[]; engineVersion?: string } & Record<string, unknown>;
}
interface IntelRecommendation {
  id: string; title: string; detail: string; severity: string; priorityScore: number;
  priorityBreakdown: Record<string, number | string>; affectedCount: number;
  estimatedEffortMins: number; action: { label: string; to: string }; insightId?: string;
}
interface IntelAnomaly { kind: string; entity: string; description?: string; anomaly_score: number; features: Record<string, number>; model: string; n_observations: number }
interface Forecast {
  available: boolean; prediction?: number; interval80?: number[]; interval95?: number[];
  interval95_upper?: number; model?: string; note?: string; reason?: string; caveat?: string | null;
}
interface IntelPayload {
  meta: { computedAt: string; anchorDate: string; engineVersion: string; llmPolished: boolean };
  healthScore: {
    overall: number | null; weights: Record<string, number>; method: string;
    categories: Record<string, { score: number | null; formula: string; window?: string; weight: number; contribution: number | null }>;
  };
  insights: IntelInsight[];
  recommendations: IntelRecommendation[];
  anomalies: IntelAnomaly[];
  forecasts: { attendanceTomorrow: Forecast; substituteDemand: Forecast; feeCollections: Forecast; documentReviewLoad: Forecast };
}
interface IntelResponse { engine: 'online' | 'offline'; payload?: IntelPayload; error?: string }

export default function Dashboard() {
  const user = useAuth((s) => s.user)!;
  if (['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role)) return <StaffDashboard />;
  if (user.role === 'TEACHER') return <TeacherDashboard />;
  return <FamilyDashboard />;
}

// Teacher dashboard — scoped to their classes and today's teaching schedule.
function TeacherDashboard() {
  const user = useAuth((s) => s.user)!;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['teacher-dashboard'], queryFn: async () => (await api.get('/dashboard/teacher')).data });
  const notif = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data });

  if (isLoading) return <LoadingScreen label="Loading your classes…" />;
  if (isError || !data) return <DashboardError onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader overline={`${greeting()}, ${firstName(user.name)}`} title="Teacher Dashboard" subtitle="Your classes and today's schedule. Mark attendance in a tap." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Classes led" value={data.classesLed.length} icon={<GraduationCap className="h-4 w-4" />} accent="brand" />
        <StatTile index={1} label="Students reached" value={data.studentsReached} icon={<Users className="h-4 w-4" />} accent="cyan" />
        <StatTile index={2} label="Today's periods" value={data.todaySlots.length} icon={<Clock className="h-4 w-4" />} accent="mint" />
        <StatTile index={3} label="Weekly load" value={`${data.weeklyHours}/${data.maxHours}h`} icon={<CalendarClock className="h-4 w-4" />} accent={data.weeklyHours >= data.maxHours - 1 ? 'rose' : 'amber'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-slate-900">Today's schedule</h2></div>
            {data.todaySlots.length ? (
              <div className="space-y-2">
                {data.todaySlots.map((s: any) => (
                  <motion.div key={s.period} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${s.color}44`, background: `${s.color}12` }}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: s.color }}>P{s.period + 1}</span>
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{s.subject} · {s.className}</div>{s.room && <div className="text-xs text-slate-500">{s.room}</div>}</div>
                    <Link to={`/attendance?classId=${s.classId}`} className="btn-ghost !py-1.5 text-xs"><CalendarCheck className="h-3.5 w-3.5" /> Attendance</Link>
                  </motion.div>
                ))}
              </div>
            ) : (
              <EmptyState title="No classes scheduled today" hint="Check the timetable for the week ahead." />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-bold text-slate-900">My classes</h2>
            {data.classesLed.length ? (
              <div className="space-y-2">
                {data.classesLed.map((c: any) => (
                  <Link key={c.id} to={`/attendance?classId=${c.id}`} className="flex items-center justify-between rounded-xl border border-line bg-ink-800/60 px-3 py-2.5 text-sm surface-hover">
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    <Badge>{c.students} students</Badge>
                  </Link>
                ))}
              </div>
            ) : <div className="text-sm text-slate-500">You aren't a class teacher this term.</div>}
          </Card>
          <Card>
            <h2 className="mb-3 font-bold text-slate-900">Updates</h2>
            {notif.data?.notifications?.length ? (
              <div className="space-y-2">
                {notif.data.notifications.slice(0, 4).map((n: any) => (
                  <div key={n.id} className={`rounded-xl border p-3 ${severityColor[n.severity]}`}><div className="text-sm font-semibold text-slate-900">{n.title}</div><div className="text-xs text-slate-600/90">{n.body}</div></div>
                ))}
              </div>
            ) : <div className="text-sm text-slate-500">No updates.</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Recommendations the server can EXECUTE in one click, not just point at.
// Keyed by the engine's recommendation id; the endpoint performs the real
// operation (cascade, reminders, outreach) and reports what it did.
const EXECUTABLE: Record<string, { kind: string; label: string }> = {
  'act-cover': { kind: 'assign-cover', label: 'Auto-assign cover' },
  'act-fees': { kind: 'fee-reminders', label: 'Send reminders' },
  'act-at-risk': { kind: 'at-risk-outreach', label: 'Message families' },
};

function StaffDashboard() {
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const school = useSchoolStatus();
  const [recomputing, setRecomputing] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const stats = useQuery({ queryKey: ['stats'], queryFn: async () => (await api.get('/dashboard/stats')).data as DashboardStats });
  const intel = useQuery({
    queryKey: ['intelligence'],
    queryFn: async () => (await api.get('/dashboard/intelligence')).data as IntelResponse,
    refetchInterval: 120_000,
  });

  // Bypasses the server-side cache so an admin who just changed data (fees,
  // attendance, …) sees the recomputed evidence immediately.
  const recompute = async () => {
    setRecomputing(true);
    try {
      const { data } = await api.get('/dashboard/intelligence', { params: { fresh: 1 } });
      qc.setQueryData(['intelligence'], data);
      qc.invalidateQueries({ queryKey: ['stats'] });
    } finally {
      setRecomputing(false);
    }
  };

  // One-click resolve: run the real operation, then recompute so the
  // recommendation disappears BECAUSE the data changed — the live proof.
  const execute = async (recId: string) => {
    const ex = EXECUTABLE[recId];
    if (!ex) return;
    setExecuting(recId);
    try {
      const { data } = await api.post('/actions/execute', { kind: ex.kind });
      pushToast({ title: 'Done', body: data.summary, severity: 'SUCCESS' });
      await recompute();
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      pushToast({ title: 'Action failed', body: apiError(e), severity: 'CRITICAL' });
    } finally {
      setExecuting(null);
    }
  };
  const trend = useQuery({
    queryKey: ['attendance', 'trend'],
    queryFn: async () =>
      (await api.get('/attendance/trend')).data as {
        series: { date: string; rate: number; marked: number; coverage: number; partial: boolean }[];
      },
  });

  // Only block on the fast stats call — the hero, KPIs and trend render
  // instantly. The intelligence panels (the ~2s Python pass) fill in with
  // their own loading state so the landing page never sits on a spinner.
  if (stats.isLoading) return <LoadingScreen label="Booting operations center…" />;
  if (stats.isError || !stats.data) return <DashboardError onRetry={() => stats.refetch()} />;
  const s = stats.data;
  const intelLoading = intel.isLoading;
  const pl = intel.data?.engine === 'online' ? intel.data.payload : undefined;
  const criticalCount = pl ? pl.insights.filter((i) => i.severity === 'CRITICAL' || i.severity === 'WARNING').length : 0;
  // Only days where most of the school was marked are comparable on a trend
  // line; a day mid-roll-call would otherwise plot as a crash to 0%.
  const completedSeries = (trend.data?.series ?? []).filter((d) => !d.partial);
  const partialToday = (trend.data?.series ?? []).some((d) => d.partial);

  return (
    <div>
      <PageHeader
        overline={`${greeting()}, ${firstName(user.name)}`}
        title="Operations Command Center"
        subtitle="One question, always answered: what should you do next? The system surfaces it — you don't hunt for it."
        actions={
          <Link to="/copilot" className="btn-primary">
            <Sparkles className="h-4 w-4" /> Ask Copilot
          </Link>
        }
      />

      {/* ── Hero band: one feature panel, deliberately NOT another equal card.
             The health figure is the largest thing on the page; the KPI rail
             sits beneath it as a hairline-divided strip. ── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.slow, ease: EASE_OUT }}
        className="surface-lead overflow-hidden"
      >
        <div className="grid gap-8 p-7 lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)] lg:gap-10 lg:p-9">
          <div className="flex items-center gap-7">
            {/* One owner for this number. A category that abstains for want of
                data is left out entirely rather than shown as a low bar. */}
            {pl && pl.healthScore.overall != null ? (
              <HealthGauge
                value={pl.healthScore.overall}
                subs={Object.entries(pl.healthScore.categories)
                  .filter(([, c]) => c.score != null)
                  .sort((a, b) => b[1].weight - a[1].weight)
                  .map(([name, c]) => ({
                    label: name[0].toUpperCase() + name.slice(1),
                    value: Math.round(c.score!),
                    // Hover states the period — no category is a single-day figure.
                    hint: c.window ? `${c.window} — ${c.formula}` : c.formula,
                  }))}
              />
            ) : (
              <HealthGaugePlaceholder state={intelLoading ? 'loading' : pl ? 'nodata' : 'offline'} />
            )}
          </div>

          <div className="flex flex-col justify-center border-line lg:border-l lg:pl-10">
            {school.phase !== 'LOADING' && (
              <div className="mb-2 flex items-center gap-1.5 text-[0.72rem] font-medium text-slate-400">
                <span className={cn('h-1.5 w-1.5 rounded-full', school.tone === 'mint' ? 'bg-mint-400' : school.tone === 'cyan' ? 'bg-cyan-400' : school.tone === 'amber' ? 'bg-amber-400' : 'bg-slate-300', school.inSession && 'animate-pulseGlow')} />
                {school.label} · {school.detail}
              </div>
            )}
            <div className="mb-1 flex items-center gap-2">
              <span className="eyebrow">Right now</span>
              {intelLoading ? (
                <Badge severity="INFO">analyzing…</Badge>
              ) : pl ? (
                <Badge severity={criticalCount ? 'WARNING' : 'SUCCESS'}>{criticalCount ? `${criticalCount} need action` : 'All clear'}</Badge>
              ) : (
                <Badge severity="WARNING">engine offline</Badge>
              )}
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              {intelLoading ? 'Analyzing operations…' : !pl ? 'Basic view' : criticalCount ? `${criticalCount} thing${criticalCount > 1 ? 's' : ''} to look at` : 'Nothing needs you'}
            </h2>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-slate-500">
              {intelLoading
                ? 'The intelligence engine is scoring today’s data — insights appear in a moment.'
                : !pl
                  ? 'The intelligence engine is unreachable — no insights are shown rather than showing invented ones.'
                  : criticalCount
                    ? 'Ranked below by computed priority — every number traces back to database records.'
                    : 'Attendance, fees and staffing are all within normal range today.'}
            </p>
            {pl && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[0.72rem] text-slate-400">
                <span>Health = {pl.healthScore.method.replace('overall = ', '')} · computed {timeAgo(pl.meta.computedAt)} · engine v{pl.meta.engineVersion}</span>
                <button
                  onClick={recompute}
                  disabled={recomputing}
                  className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                  title="Bypass the 30s cache and recompute from the database now"
                >
                  <RefreshCw className={cn('h-3 w-3', recomputing && 'animate-spin-slow')} /> {recomputing ? 'Recomputing…' : 'Recompute'}
                </button>
              </p>
            )}
            <Link to="/copilot" className="mt-4 inline-flex w-fit items-center gap-1.5 text-[0.82rem] font-semibold text-brand-600 hover:text-brand-700">
              Ask Copilot about today <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* KPI rail — a strip, not four more cards. Sits in a well so it
            visibly supports the health panel instead of rivalling it. */}
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line bg-ink-800/30 lg:grid-cols-4">
          {/* Was "Admin hours saved" — ledger actions x an invented 8 minutes
              each, presented as a measured saving. Classes left uncovered is a
              fact about how the school is running right now. */}
          <Kpi
            icon={<UserX className="h-3.5 w-3.5" />}
            tone={s.uncoveredToday ? 'text-amber-400' : 'text-mint-400'}
            label="Uncovered classes"
            value={s.uncoveredToday || 'None'}
            sub={s.uncoveredToday ? 'no accepted substitute yet' : 'every absence is covered'}
          />
          {/* Mid roll-call, "% of marked" masquerading as school attendance
              contradicts the health gauge — show progress until the day is
              representatively marked, then the real rate. */}
          <Kpi
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
            tone={s.today.inProgress ? 'text-amber-400' : 'text-mint-400'}
            label={s.today.inProgress ? 'Roll-call today' : 'Attendance today'}
            value={s.today.marked ? (s.today.inProgress ? `${s.today.marked}/${s.students}` : pct(s.today.rate)) : '—'}
            sub={
              s.today.marked
                ? s.today.inProgress
                  ? `${pct(s.today.rate)} of marked present · in progress`
                  : `${s.today.marked}/${s.students} marked`
                : 'Roll-call not started'
            }
          />
          <Kpi icon={<Wallet className="h-3.5 w-3.5" />} tone="text-amber-400" label="Outstanding fees" value={inr(s.outstanding)} sub={`${s.overdueCount} accounts`} />
          <Kpi icon={<GraduationCap className="h-3.5 w-3.5" />} tone="text-cyan-400" label="Students" value={s.students} sub={`${s.classes} classes`} />
        </div>
      </motion.section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Recommended actions — ranked by the engine's computed priority */}
        <div className="lg:col-span-2">
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-400" />
                <h2 className="font-bold text-slate-900">Recommended actions</h2>
              </div>
              {intelLoading ? (
                <span className="text-[0.7rem] text-slate-400">scoring…</span>
              ) : pl ? (
                <span className="flex items-center gap-1.5 text-[0.7rem] text-slate-500">
                  <span className="live-dot" /> ranked by impact × urgency × confidence
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[0.7rem] text-amber-600"><AlertTriangle className="h-3 w-3" /> engine offline</span>
              )}
            </div>
            {intelLoading ? (
              <PanelLoading rows={3} />
            ) : !pl ? (
              <EngineOffline error={intel.data?.error} />
            ) : pl.recommendations.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No actions recommended — nothing crossed the evidence thresholds.</div>
            ) : (
              <div className="divide-y divide-line">
                {pl.recommendations.map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="px-5 py-4">
                    <div className="flex items-start gap-4">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[0.68rem] font-bold ${severityColor[r.severity]}`}>
                        #{i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{r.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{r.detail}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.68rem] text-slate-400">
                          <span>priority <b className="tnum text-slate-600">{r.priorityScore}</b></span>
                          <span>affects <b className="tnum text-slate-600">{r.affectedCount}</b></span>
                          <span>~<b className="tnum text-slate-600">{r.estimatedEffortMins}m</b> effort (estimate)</span>
                          <span className={confColor(Number(r.priorityBreakdown.confidence) || 0)}>
                            conf <b className="tnum">{Math.round((Number(r.priorityBreakdown.confidence) || 0) * 100)}%</b>
                          </span>
                        </div>
                        <details className="mt-1.5">
                          <summary className="cursor-pointer list-none text-[0.7rem] font-semibold text-brand-600 hover:text-brand-700">Why this rank?</summary>
                          <div className="mt-1.5 rounded-lg border border-line bg-ink-800/40 px-3 py-2 text-[0.7rem] leading-relaxed text-slate-500">
                            {String(r.priorityBreakdown.formula)} = <b className="text-slate-700">{r.priorityScore}</b>
                            <span className="block">
                              impact {r.priorityBreakdown.businessImpact} · urgency {r.priorityBreakdown.urgency} · confidence {r.priorityBreakdown.confidence} ·
                              affected {r.priorityBreakdown.affectedFactor} · risk {r.priorityBreakdown.operationalRisk}
                            </span>
                          </div>
                        </details>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {EXECUTABLE[r.id] && (
                          <button
                            onClick={() => execute(r.id)}
                            disabled={executing !== null}
                            className="btn-primary !py-1.5 text-xs"
                            title="Performs the operation now — audited, and reflected in the next recompute"
                          >
                            {executing === r.id ? 'Working…' : EXECUTABLE[r.id].label}
                          </button>
                        )}
                        <Link to={r.action.to} className="btn-ghost !py-1.5 text-xs">
                          {r.action.label} <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </Card>

          {/* Forecasts — every prediction carries its interval and model */}
          {pl && (
            <Card className="mt-6 !p-0">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="font-bold text-slate-900">Forecasts</h2>
                <span className="text-[0.7rem] text-slate-500">prediction intervals, not point promises</span>
              </div>
              <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:[&>*:nth-child(3)]:border-t sm:[&>*:nth-child(4)]:border-t">
                <ForecastCell label="Attendance tomorrow" f={pl.forecasts.attendanceTomorrow} fmt={(v) => pct(v * 100)} intervalFmt={(v) => pct(v * 100)} />
                <ForecastCell label="Substitute demand / day" f={pl.forecasts.substituteDemand} fmt={(v) => String(v)} intervalFmt={(v) => String(v)} />
                <ForecastCell label="Expected fee recovery" f={pl.forecasts.feeCollections} fmt={(v) => inr(v)} intervalFmt={(v) => inr(v)} />
                <ForecastCell label="Document review load" f={pl.forecasts.documentReviewLoad} fmt={(v) => String(v)} intervalFmt={(v) => String(v)} />
              </div>
            </Card>
          )}

          {/* Attendance trend — only fully-marked days are comparable */}
          <Card className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Attendance trend</h2>
              <div className="flex items-center gap-2">
                {partialToday && <Badge severity="WARNING">today still in roll-call</Badge>}
                <Badge severity="INFO">completed days</Badge>
              </div>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={completedSeries}>
                  <defs>
                    <linearGradient id="att" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.brand} stopOpacity={0.14} />
                      <stop offset="100%" stopColor={T.brand} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: CHART.axis, fontSize: 11 }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                  {/* Domain follows the data — a hard-coded floor would clip a real dip. */}
                  <YAxis domain={['dataMin - 6', 100]} tick={{ fill: CHART.axis, fontSize: 11 }} width={30} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART.tooltip} cursor={{ stroke: T.line }} />
                  <Area type="monotone" dataKey="rate" stroke={T.brand} strokeWidth={2.5} fill="url(#att)" dot={false} activeDot={{ r: 4, fill: T.brand, strokeWidth: 2, stroke: T.surface }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Evidence feed — insights with computed confidence and full traces */}
        <div className="space-y-6">
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-brand-400" />
                <h2 className="font-bold text-slate-900">Evidence feed</h2>
              </div>
              {pl && <span className="text-[0.7rem] text-slate-500">as of {pl.meta.anchorDate}</span>}
            </div>
            {intelLoading ? <PanelLoading rows={3} /> : !pl ? <EngineOffline error={intel.data?.error} /> : <InsightSlider insights={pl.insights} />}
          </Card>

          {/* Only shown when there's something genuinely unusual to report —
              an empty "nothing anomalous" panel is just noise. */}
          {pl && pl.anomalies.length > 0 && (
            <Card className="!p-0">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="font-bold text-slate-900">Unusual patterns</h2>
                <span className="text-[0.7rem] text-slate-500">flagged by IsolationForest</span>
              </div>
              <div className="divide-y divide-line">
                {pl.anomalies.map((a) => (
                  <details key={`${a.kind}-${a.entity}`} className="group px-5 py-3">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{a.entity}</span>
                        <span className="mt-0.5 block text-[0.72rem] leading-snug text-slate-500">{a.description ?? a.kind.replaceAll('_', ' ').toLowerCase()}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[0.62rem] font-bold text-amber-600" title="Anomaly score (0–100): how far outside the normal pattern this sits">
                        {Math.round(a.anomaly_score * 100)}
                      </span>
                    </summary>
                    <div className="mt-1.5 rounded-lg border border-line bg-ink-800/40 px-3 py-2 text-[0.68rem] leading-relaxed text-slate-500">
                      <b className="text-slate-600">Signals:</b>{' '}
                      {Object.entries(a.features).map(([k, v]) => `${k.replaceAll('_', ' ')} ${typeof v === 'number' ? +Number(v).toFixed(2) : v}`).join(' · ')}
                      <span className="mt-0.5 block"><b className="text-slate-600">Model:</b> {a.model} · scored against {a.n_observations} observations</span>
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Evidence feed as a one-at-a-time slider: prev/next, dots, keyboard, and a
 *  wrap-around index. Each slide is the full insight card (evidence, computed
 *  confidence, and the "Why am I seeing this?" trace). */
function InsightSlider({ insights }: { insights: IntelInsight[] }) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  if (insights.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">No insights crossed the evidence thresholds.</div>;
  }
  const n = insights.length;
  const go = (delta: number) => {
    setDir(delta);
    setIdx((c) => (c + delta + n) % n);
  };
  const ins = insights[idx];

  return (
    <div>
      <div className="relative overflow-hidden px-4 pt-4" tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); }}>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={ins.id}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`rounded-xl border p-3.5 ${severityColor[ins.severity]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{ins.title}</div>
              <span className={cn('tnum shrink-0 text-[0.65rem] font-bold', confColor(ins.confidence.value / 100))}>{ins.confidence.value}%</span>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-600/90">{ins.reason}</div>
            <div className="mt-2 space-y-0.5">
              {ins.evidence.slice(0, 4).map((e) => (
                <div key={e.label} className="flex items-baseline justify-between gap-2 text-[0.7rem]">
                  <span className="truncate text-slate-500">{e.label}</span>
                  <span className="tnum shrink-0 font-semibold text-slate-700">
                    {e.value}
                    {e.detail && <span className="ml-1 font-normal text-slate-400">({e.detail})</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2"><Meter value={ins.confidence.value} tone={ins.severity === 'WARNING' || ins.severity === 'CRITICAL' ? 'amber' : ins.severity === 'SUCCESS' ? 'mint' : 'brand'} /></div>
            <details className="mt-2">
              <summary className="cursor-pointer list-none text-[0.7rem] font-semibold text-brand-600 hover:text-brand-700">Why am I seeing this?</summary>
              <div className="mt-1.5 space-y-1 rounded-lg border border-line bg-white/50 px-3 py-2 text-[0.7rem] leading-relaxed text-slate-500">
                <div><b className="text-slate-600">Model:</b> {ins.trace.model ?? '—'}</div>
                <div><b className="text-slate-600">Data:</b> {(ins.trace.dataSources as string[] | undefined)?.join(', ') ?? '—'} · window {typeof ins.trace.window === 'string' ? ins.trace.window : JSON.stringify(ins.trace.window)}</div>
                <div><b className="text-slate-600">Confidence:</b> {ins.confidence.explanation}</div>
                <div><b className="text-slate-600">Expected impact:</b> {ins.expectedImpact}</div>
              </div>
            </details>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls: arrows + dots. One insight at a time keeps the panel calm. */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => go(-1)} aria-label="Previous insight" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-slate-500 transition hover:bg-ink-800 hover:text-slate-800">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5">
          {insights.map((it, i) => (
            <button
              key={it.id}
              onClick={() => { setDir(i > idx ? 1 : -1); setIdx(i); }}
              aria-label={`Go to insight ${i + 1}`}
              className={cn('h-1.5 rounded-full transition-all', i === idx ? 'w-4 bg-brand-500' : 'w-1.5 bg-line hover:bg-slate-300')}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="tnum text-[0.68rem] text-slate-400">{idx + 1}/{n}</span>
          <button onClick={() => go(1)} aria-label="Next insight" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-slate-500 transition hover:bg-ink-800 hover:text-slate-800">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Full-page graceful error — a failed data load should never white-screen
 *  the landing page in front of a judge. Offers a one-click retry. */
function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="max-w-sm text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-400/10 text-amber-500"><AlertTriangle className="h-6 w-6" /></div>
        <h2 className="font-bold text-slate-900">Couldn’t load the dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">The server didn’t respond. Check that it’s running, then try again.</p>
        <button onClick={onRetry} className="btn-primary mx-auto mt-4"><RefreshCw className="h-4 w-4" /> Retry</button>
      </Card>
    </div>
  );
}

/** Skeleton rows while the intelligence engine scores — keeps the panel's
 *  height stable so the dashboard never jumps when results land. */
function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="shimmer rounded-xl border border-line p-3.5">
          <div className="mb-2 h-3 w-2/3 rounded bg-ink-800" />
          <div className="mb-2 h-2.5 w-full rounded bg-ink-800/70" />
          <div className="h-2.5 w-1/2 rounded bg-ink-800/70" />
        </div>
      ))}
    </div>
  );
}

/** Honest empty state — the dashboard never substitutes local guesses. */
function EngineOffline({ error }: { error?: string }) {
  return (
    <div className="px-5 py-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" /> Intelligence engine offline</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Insights, confidence scores and rankings are computed by the Python engine — nothing is invented in the browser.
        Start it with <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.7rem] text-slate-700">npm run intelligence</code> and this panel fills in.
        {error && <span className="mt-1 block text-slate-400">({error})</span>}
      </p>
    </div>
  );
}

/** One forecast cell: value + interval + the model that produced it. */
function ForecastCell({ label, f, fmt, intervalFmt }: { label: string; f: Forecast; fmt: (v: number) => string; intervalFmt: (v: number) => string }) {
  const interval = f.interval80 ?? f.interval95;
  return (
    <div className="px-5 py-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</div>
      {f.available && f.prediction != null ? (
        <>
          <div className="tnum mt-1.5 font-display text-[1.35rem] font-semibold leading-none text-slate-900">{fmt(f.prediction)}</div>
          <div className="mt-1 text-[0.7rem] text-slate-500">
            {interval
              ? `${f.interval80 ? '80%' : '95%'} interval ${intervalFmt(interval[0])} – ${intervalFmt(interval[1])}`
              : f.interval95_upper != null
                ? `95% upper bound ${intervalFmt(f.interval95_upper)}`
                : f.note ?? ''}
          </div>
          <div className="mt-0.5 truncate text-[0.65rem] text-slate-400" title={`${f.model ?? ''}${f.caveat ? ` — ${f.caveat}` : ''}`}>{f.model}{f.caveat ? ' *' : ''}</div>
        </>
      ) : (
        <div className="mt-1.5 text-xs text-slate-500">{f.reason ?? 'Not available'}</div>
      )}
    </div>
  );
}

/** A cell in the hero's KPI rail — flat, hairline-separated, no card chrome. */
function Kpi({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="px-5 py-4 transition-colors hover:bg-ink-800/50">
      <div className="flex items-center gap-1.5">
        <span className={cn('shrink-0', tone)}>{icon}</span>
        <span className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</span>
      </div>
      <div className="tnum mt-1.5 font-display text-[1.45rem] font-semibold leading-none text-slate-900">{value}</div>
      <div className="mt-1 truncate text-[0.7rem] text-slate-400">{sub}</div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// Self-service dashboard for students & parents.
interface MeCard {
  id: string;
  name: string;
  rollNo: number;
  className: string | null;
  classTeacher: string | null;
  room: string | null;
  attendanceRate: number;
  todayStatus: string;
  attendanceHistory: { date: string; status: string }[];
  outstanding: number;
  fees: { id: string; title: string; due: number; amount: number; status: string; dueDate: string }[];
  timetableToday: { period: number; subject: string; color: string; teacher: string; room: string | null }[];
}

function FamilyDashboard() {
  const user = useAuth((s) => s.user)!;
  const isParent = user.role === 'PARENT';
  const [childIdx, setChildIdx] = useState(0);

  const me = useQuery({ queryKey: ['me-dashboard'], queryFn: async () => (await api.get('/dashboard/me')).data as { role: string; cards: MeCard[] } });
  const notif = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data });

  if (me.isLoading) return <LoadingScreen label="Loading your dashboard…" />;
  if (me.isError) return <DashboardError onRetry={() => me.refetch()} />;

  const cards = me.data?.cards ?? [];
  const card = cards[childIdx];

  return (
    <div>
      <PageHeader
        overline={`${greeting()}, ${firstName(user.name)}`}
        title={isParent ? 'Family Dashboard' : 'My Dashboard'}
        subtitle={isParent ? "Everything about your children's school day, in one place." : 'Your attendance, timetable and fees — always up to date.'}
      />

      {/* Parent child selector */}
      {isParent && cards.length > 1 && (
        <div className="mb-5 inline-flex flex-wrap gap-2 rounded-xl border border-line p-1">
          {cards.map((c, i) => (
            <button key={c.id} onClick={() => setChildIdx(i)} className={cn('rounded-lg px-4 py-2 text-sm font-semibold transition', i === childIdx ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-900')}>
              {firstName(c.name)} · {c.className ?? '—'}
            </button>
          ))}
        </div>
      )}

      {!card ? (
        <EmptyState icon={<GraduationCap className="h-8 w-8" />} title={isParent ? 'No linked children yet' : 'No student record linked'} hint="Ask the school office to link your account." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Snapshot */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="col-span-2 flex items-center gap-4 sm:col-span-1">
                <ConfidenceRing value={card.attendanceRate / 100} size={52} />
                <div>
                  <div className="label">Attendance</div>
                  <div className="text-lg font-extrabold text-slate-900">{card.attendanceRate}%</div>
                </div>
              </Card>
              <StatTile index={1} label="Today" value={<StatusBadge status={card.todayStatus} />} accent="cyan" icon={<CalendarCheck className="h-4 w-4" />} />
              <StatTile index={2} label="Fees due" value={inr(card.outstanding)} accent={card.outstanding > 0 ? 'amber' : 'mint'} icon={<Wallet className="h-4 w-4" />} />
              <StatTile index={3} label="Class" value={card.className ?? '—'} sub={card.room ?? ''} accent="brand" icon={<DoorOpen className="h-4 w-4" />} />
            </div>

            {/* Today's timetable */}
            <Card>
              <div className="mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-slate-900">Today's timetable</h2></div>
              {card.timetableToday.length ? (
                <div className="space-y-2">
                  {card.timetableToday.map((s) => (
                    <motion.div key={s.period} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${s.color}44`, background: `${s.color}12` }}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: s.color }}>P{s.period + 1}</span>
                      <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{s.subject}</div><div className="text-xs text-slate-500">{s.teacher}</div></div>
                      {s.room && <Badge>{s.room}</Badge>}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No classes scheduled today" hint="Enjoy the day off — or check the full timetable." />
              )}
            </Card>

            {/* Attendance history */}
            <Card>
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-slate-900">Attendance history</h2><Badge severity={card.attendanceRate >= 90 ? 'SUCCESS' : card.attendanceRate >= 75 ? 'INFO' : 'WARNING'}>last {card.attendanceHistory.length} days</Badge></div>
              <Meter value={card.attendanceRate} tone={card.attendanceRate >= 90 ? 'mint' : card.attendanceRate >= 75 ? 'brand' : 'amber'} />
              <div className="mt-4 flex flex-wrap gap-1.5">
                {card.attendanceHistory.slice().reverse().map((a, i) => (
                  <span key={i} title={`${a.date}: ${a.status}`} className={cn('h-6 w-6 rounded-md', a.status === 'PRESENT' ? 'bg-mint-400/70' : a.status === 'LATE' ? 'bg-amber-400/70' : a.status === 'LEAVE' ? 'bg-cyan-400/50' : 'bg-rose-400/70')} />
                ))}
              </div>
            </Card>
          </div>

          {/* Sidebar: teacher, fees, updates */}
          <div className="space-y-6">
            <Card>
              <div className="mb-3 flex items-center gap-2"><UserIcon className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-slate-900">Class teacher</h2></div>
              <div className="text-sm text-slate-600">{card.classTeacher ?? 'Not assigned'}</div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-amber-400" /><h2 className="font-bold text-slate-900">Fees</h2></div>
              {card.fees.length ? (
                <div className="space-y-2">
                  {card.fees.map((f) => (
                    <div key={f.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-800/60 px-3 py-2.5 text-sm">
                      <div><div className="font-medium text-slate-900">{f.title}</div><div className="text-xs text-slate-500">Due {f.dueDate}</div></div>
                      <div className="text-right"><div className="font-semibold text-slate-900">{inr(f.due)}</div><Badge severity={f.status === 'PAID' ? 'SUCCESS' : f.status === 'OVERDUE' ? 'CRITICAL' : 'WARNING'}>{f.status}</Badge></div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-sm text-slate-500">No fee records.</div>}
            </Card>

            <Card>
              <div className="mb-3 flex items-center gap-2"><Bell className="h-4 w-4 text-cyan-400" /><h2 className="font-bold text-slate-900">Recent updates</h2></div>
              {notif.data?.notifications?.length ? (
                <div className="space-y-2">
                  {notif.data.notifications.slice(0, 5).map((n: any) => (
                    <div key={n.id} className={`rounded-xl border p-3 ${severityColor[n.severity]}`}>
                      <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                      <div className="text-xs text-slate-600/90">{n.body}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-sm text-slate-500">No updates yet.</div>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { PRESENT: 'SUCCESS', LATE: 'WARNING', ABSENT: 'CRITICAL', LEAVE: 'INFO', UNMARKED: 'INFO' };
  return <Badge severity={map[status] ?? 'INFO'}>{status === 'UNMARKED' ? 'Not marked' : status}</Badge>;
}

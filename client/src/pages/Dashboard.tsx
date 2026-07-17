import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  GraduationCap, Users, CalendarCheck, Wallet, Activity, ArrowUpRight,
  AlertTriangle, Flame, FileScan, CalendarClock, CheckCircle2, Sparkles,
  Clock, DoorOpen, User as UserIcon, Bell,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import PageHeader from '@/components/PageHeader';
import { StatTile, Card, Badge, Meter, LoadingScreen, EmptyState, ConfidenceRing } from '@/components/ui';
import HealthGauge from '@/components/HealthGauge';
import { inr, pct, severityColor, cn, confColor } from '@/lib/utils';
import { T, CHART } from '@/constants/theme';
import type { DashboardStats, Alert, Insight } from '@/types';

const alertIcon: Record<string, any> = {
  bottleneck: Flame, fees: Wallet, docs: FileScan, timetable: CalendarClock, attendance: CheckCircle2,
};

export default function Dashboard() {
  const user = useAuth((s) => s.user)!;
  if (['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role)) return <StaffDashboard />;
  if (user.role === 'TEACHER') return <TeacherDashboard />;
  return <FamilyDashboard />;
}

// Teacher dashboard — scoped to their classes and today's teaching schedule.
function TeacherDashboard() {
  const user = useAuth((s) => s.user)!;
  const { data, isLoading } = useQuery({ queryKey: ['teacher-dashboard'], queryFn: async () => (await api.get('/dashboard/teacher')).data });
  const notif = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data });

  if (isLoading) return <LoadingScreen label="Loading your classes…" />;

  return (
    <div>
      <PageHeader overline={`${greeting()}, ${user.name.split(' ')[0]}`} title="Teacher Dashboard" subtitle="Your classes and today's schedule. Mark attendance in a tap." />

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

function StaffDashboard() {
  const user = useAuth((s) => s.user)!;
  const stats = useQuery({ queryKey: ['stats'], queryFn: async () => (await api.get('/dashboard/stats')).data as DashboardStats });
  const cc = useQuery({ queryKey: ['command-center'], queryFn: async () => (await api.get('/dashboard/command-center')).data as { alerts: Alert[] } });
  const insights = useQuery({ queryKey: ['insights'], queryFn: async () => (await api.get('/dashboard/insights')).data as { insights: Insight[] } });
  const trend = useQuery({
    queryKey: ['attendance', 'trend'],
    queryFn: async () =>
      (await api.get('/attendance/trend')).data as {
        series: { date: string; rate: number; marked: number; coverage: number; partial: boolean }[];
      },
  });

  if (stats.isLoading) return <LoadingScreen label="Booting operations center…" />;
  const s = stats.data!;
  const criticalCount = cc.data?.alerts.filter((a) => a.severity !== 'SUCCESS').length ?? 0;
  // Only days where most of the school was marked are comparable on a trend
  // line; a day mid-roll-call would otherwise plot as a crash to 0%.
  const completedSeries = (trend.data?.series ?? []).filter((d) => !d.partial);
  const partialToday = (trend.data?.series ?? []).some((d) => d.partial);

  return (
    <div>
      <PageHeader
        overline={`${greeting()}, ${user.name.split(' ')[0]}`}
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
      <section className="surface overflow-hidden">
        <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)] lg:p-7">
          <div className="flex items-center gap-7">
            <HealthGauge
              value={s.health}
              subs={[
                { label: 'Attendance', value: s.healthBreakdown.attendance },
                { label: 'Finance', value: s.healthBreakdown.finance },
                { label: 'People', value: s.healthBreakdown.people },
                { label: 'Operations', value: s.healthBreakdown.operations },
              ]}
            />
          </div>

          <div className="flex flex-col justify-center border-line lg:border-l lg:pl-8">
            <div className="mb-1 flex items-center gap-2">
              <span className="eyebrow">Right now</span>
              <Badge severity={criticalCount ? 'WARNING' : 'SUCCESS'}>{criticalCount ? `${criticalCount} need action` : 'All clear'}</Badge>
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              {criticalCount ? `${criticalCount} thing${criticalCount > 1 ? 's' : ''} to look at` : 'Nothing needs you'}
            </h2>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-slate-500">
              {criticalCount
                ? 'Ranked below by impact — each one comes with a suggested fix.'
                : 'Attendance, fees and staffing are all within normal range today.'}
            </p>
            <Link to="/copilot" className="mt-4 inline-flex w-fit items-center gap-1.5 text-[0.82rem] font-semibold text-brand-600 hover:text-brand-700">
              Ask Copilot about today <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* KPI rail — a strip, not four more cards */}
        <div className="grid grid-cols-2 divide-x divide-line border-t border-line lg:grid-cols-4">
          <Kpi icon={<Clock className="h-3.5 w-3.5" />} tone="text-brand-500" label="Admin hours saved" value={`${s.timeSavedHours}h`} sub={`${s.automatedActions} automated actions`} />
          <Kpi
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
            tone={s.today.inProgress ? 'text-amber-400' : 'text-mint-400'}
            label="Attendance today"
            value={s.today.marked ? pct(s.today.rate) : '—'}
            sub={
              s.today.marked
                ? `${s.today.marked}/${s.students} marked${s.today.inProgress ? ' · roll-call in progress' : ''}`
                : 'Roll-call not started'
            }
          />
          <Kpi icon={<Wallet className="h-3.5 w-3.5" />} tone="text-amber-400" label="Outstanding fees" value={inr(s.outstanding)} sub={`${s.overdueCount} accounts`} />
          <Kpi icon={<GraduationCap className="h-3.5 w-3.5" />} tone="text-cyan-400" label="Students" value={s.students} sub={`${s.classes} classes`} />
        </div>
      </section>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Recommended actions */}
        <div className="lg:col-span-2">
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-400" />
                <h2 className="font-bold text-slate-900">Recommended actions</h2>
              </div>
              <span className="flex items-center gap-1.5 text-[0.7rem] text-slate-500"><span className="live-dot" /> AI online · anomaly-ranked</span>
            </div>
            <div className="divide-y divide-line">
              {cc.data?.alerts.map((a, i) => {
                const Icon = alertIcon[a.icon] ?? AlertTriangle;
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-start gap-4 px-5 py-4">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${severityColor[a.severity]}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{a.title}</div>
                      {a.recommendation && <div className="mt-0.5 text-xs text-brand-400">→ {a.recommendation}</div>}
                      <div className="mt-0.5 truncate text-xs text-slate-500">{a.detail}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {a.confidence != null && <span className={cn('tnum text-[0.65rem] font-bold', confColor(a.confidence))}>{Math.round(a.confidence * 100)}%</span>}
                      {a.action && (
                        <Link to={a.action.to} className="btn-ghost !py-1.5 text-xs">
                          {a.action.label} <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </Card>

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

        {/* AI Insight Feed */}
        <div>
          <Card className="!p-0">
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <Sparkles className="h-4 w-4 text-brand-400" />
              <h2 className="font-bold text-slate-900">AI Insight Feed</h2>
            </div>
            <div className="space-y-3 p-4">
              {insights.data?.insights.map((ins, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={`rounded-xl border p-3.5 ${severityColor[ins.severity]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{ins.title}</div>
                    <span className="tnum shrink-0 text-[0.65rem] font-bold">{ins.confidence}%</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600/90">{ins.cause}</div>
                  <div className="mt-2"><Meter value={ins.confidence} tone={ins.severity === 'WARNING' ? 'amber' : ins.severity === 'SUCCESS' ? 'mint' : 'brand'} /></div>
                </motion.div>
              ))}
            </div>
          </Card>
        </div>
      </div>
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

  const cards = me.data?.cards ?? [];
  const card = cards[childIdx];

  return (
    <div>
      <PageHeader
        overline={`${greeting()}, ${user.name.split(' ')[0]}`}
        title={isParent ? 'Family Dashboard' : 'My Dashboard'}
        subtitle={isParent ? "Everything about your children's school day, in one place." : 'Your attendance, timetable and fees — always up to date.'}
      />

      {/* Parent child selector */}
      {isParent && cards.length > 1 && (
        <div className="mb-5 inline-flex flex-wrap gap-2 rounded-xl border border-line p-1">
          {cards.map((c, i) => (
            <button key={c.id} onClick={() => setChildIdx(i)} className={cn('rounded-lg px-4 py-2 text-sm font-semibold transition', i === childIdx ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-900')}>
              {c.name.split(' ')[0]} · {c.className ?? '—'}
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

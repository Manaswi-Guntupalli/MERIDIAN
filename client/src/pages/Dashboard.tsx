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
            <div className="mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">Today's schedule</h2></div>
            {data.todaySlots.length ? (
              <div className="space-y-2">
                {data.todaySlots.map((s: any) => (
                  <motion.div key={s.period} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${s.color}44`, background: `${s.color}12` }}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-ink-950" style={{ background: s.color }}>P{s.period + 1}</span>
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{s.subject} · {s.className}</div>{s.room && <div className="text-xs text-slate-400">{s.room}</div>}</div>
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
            <h2 className="mb-3 font-bold text-white">My classes</h2>
            {data.classesLed.length ? (
              <div className="space-y-2">
                {data.classesLed.map((c: any) => (
                  <Link key={c.id} to={`/attendance?classId=${c.id}`} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm glass-hover">
                    <span className="font-semibold text-white">{c.name}</span>
                    <Badge>{c.students} students</Badge>
                  </Link>
                ))}
              </div>
            ) : <div className="text-sm text-slate-500">You aren't a class teacher this term.</div>}
          </Card>
          <Card>
            <h2 className="mb-3 font-bold text-white">Updates</h2>
            {notif.data?.notifications?.length ? (
              <div className="space-y-2">
                {notif.data.notifications.slice(0, 4).map((n: any) => (
                  <div key={n.id} className={`rounded-xl border p-3 ${severityColor[n.severity]}`}><div className="text-sm font-semibold text-white">{n.title}</div><div className="text-xs text-slate-300/90">{n.body}</div></div>
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
  const trend = useQuery({ queryKey: ['attendance', 'trend'], queryFn: async () => (await api.get('/attendance/trend')).data as { series: { date: string; rate: number }[] } });

  if (stats.isLoading) return <LoadingScreen label="Booting operations center…" />;
  const s = stats.data!;
  const criticalCount = cc.data?.alerts.filter((a) => a.severity !== 'SUCCESS').length ?? 0;

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

      {/* Hero: Operational Health + live KPIs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">Operational Health</h2></div>
            <Badge severity={criticalCount ? 'WARNING' : 'SUCCESS'}>{criticalCount ? `${criticalCount} to action` : 'All clear'}</Badge>
          </div>
          <HealthGauge
            value={s.health}
            subs={[
              { label: 'Attendance', value: s.healthBreakdown.attendance },
              { label: 'Finance', value: s.healthBreakdown.finance },
              { label: 'People', value: s.healthBreakdown.people },
              { label: 'Operations', value: s.healthBreakdown.operations },
            ]}
          />
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <KpiRow icon={<Clock className="h-4 w-4" />} accent="text-brand-400" label="Admin hours saved" value={`${s.timeSavedHours}h`} sub={`${s.automatedActions} automated actions`} />
          <KpiRow icon={<CalendarCheck className="h-4 w-4" />} accent="text-mint-400" label="Attendance today" value={pct(s.attendanceRate)} sub={`${s.present}/${s.totalMarked} present`} />
          <KpiRow icon={<Wallet className="h-4 w-4" />} accent="text-amber-400" label="Outstanding fees" value={inr(s.outstanding)} sub={`${s.overdueCount} accounts`} />
          <KpiRow icon={<GraduationCap className="h-4 w-4" />} accent="text-cyan-400" label="Students" value={s.students} sub={`${s.classes} classes`} />
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Recommended actions */}
        <div className="lg:col-span-2">
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-400" />
                <h2 className="font-bold text-white">Recommended actions</h2>
              </div>
              <span className="flex items-center gap-1.5 text-[0.7rem] text-slate-500"><span className="live-dot" /> AI online · anomaly-ranked</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {cc.data?.alerts.map((a, i) => {
                const Icon = alertIcon[a.icon] ?? AlertTriangle;
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-start gap-4 px-5 py-4">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${severityColor[a.severity]}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white">{a.title}</div>
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

          {/* Attendance trend */}
          <Card className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-white">Attendance trend</h2>
              <Badge severity="INFO">14 days</Badge>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data?.series ?? []}>
                  <defs>
                    <linearGradient id="att" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00E5FF" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#00E5FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis domain={[70, 100]} tick={{ fill: '#64748b', fontSize: 11 }} width={28} />
                  <Tooltip contentStyle={{ background: '#0E0E12', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }} />
                  <Area type="monotone" dataKey="rate" stroke="#00E5FF" strokeWidth={2} fill="url(#att)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* AI Insight Feed */}
        <div>
          <Card className="!p-0">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
              <Sparkles className="h-4 w-4 text-brand-400" />
              <h2 className="font-bold text-white">AI Insight Feed</h2>
            </div>
            <div className="space-y-3 p-4">
              {insights.data?.insights.map((ins, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={`rounded-xl border p-3.5 ${severityColor[ins.severity]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-white">{ins.title}</div>
                    <span className="tnum shrink-0 text-[0.65rem] font-bold">{ins.confidence}%</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-300/90">{ins.cause}</div>
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

function KpiRow({ icon, accent, label, value, sub }: { icon: React.ReactNode; accent: string; label: string; value: React.ReactNode; sub: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass glass-hover flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]', accent)}>{icon}</span>
      <div className="min-w-0">
        <div className="label">{label}</div>
        <div className="tnum text-xl font-extrabold text-white">{value}</div>
        <div className="truncate text-[0.7rem] text-slate-500">{sub}</div>
      </div>
    </motion.div>
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
        <div className="mb-5 inline-flex flex-wrap gap-2 rounded-xl border border-white/10 p-1">
          {cards.map((c, i) => (
            <button key={c.id} onClick={() => setChildIdx(i)} className={cn('rounded-lg px-4 py-2 text-sm font-semibold transition', i === childIdx ? 'bg-brand-gradient text-ink-950' : 'text-slate-400 hover:text-white')}>
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
                  <div className="text-lg font-extrabold text-white">{card.attendanceRate}%</div>
                </div>
              </Card>
              <StatTile index={1} label="Today" value={<StatusBadge status={card.todayStatus} />} accent="cyan" icon={<CalendarCheck className="h-4 w-4" />} />
              <StatTile index={2} label="Fees due" value={inr(card.outstanding)} accent={card.outstanding > 0 ? 'amber' : 'mint'} icon={<Wallet className="h-4 w-4" />} />
              <StatTile index={3} label="Class" value={card.className ?? '—'} sub={card.room ?? ''} accent="brand" icon={<DoorOpen className="h-4 w-4" />} />
            </div>

            {/* Today's timetable */}
            <Card>
              <div className="mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">Today's timetable</h2></div>
              {card.timetableToday.length ? (
                <div className="space-y-2">
                  {card.timetableToday.map((s) => (
                    <motion.div key={s.period} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${s.color}44`, background: `${s.color}12` }}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-ink-950" style={{ background: s.color }}>P{s.period + 1}</span>
                      <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{s.subject}</div><div className="text-xs text-slate-400">{s.teacher}</div></div>
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
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-white">Attendance history</h2><Badge severity={card.attendanceRate >= 90 ? 'SUCCESS' : card.attendanceRate >= 75 ? 'INFO' : 'WARNING'}>last {card.attendanceHistory.length} days</Badge></div>
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
              <div className="mb-3 flex items-center gap-2"><UserIcon className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">Class teacher</h2></div>
              <div className="text-sm text-slate-300">{card.classTeacher ?? 'Not assigned'}</div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4 text-amber-400" /><h2 className="font-bold text-white">Fees</h2></div>
              {card.fees.length ? (
                <div className="space-y-2">
                  {card.fees.map((f) => (
                    <div key={f.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm">
                      <div><div className="font-medium text-white">{f.title}</div><div className="text-xs text-slate-500">Due {f.dueDate}</div></div>
                      <div className="text-right"><div className="font-semibold text-white">{inr(f.due)}</div><Badge severity={f.status === 'PAID' ? 'SUCCESS' : f.status === 'OVERDUE' ? 'CRITICAL' : 'WARNING'}>{f.status}</Badge></div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-sm text-slate-500">No fee records.</div>}
            </Card>

            <Card>
              <div className="mb-3 flex items-center gap-2"><Bell className="h-4 w-4 text-cyan-400" /><h2 className="font-bold text-white">Recent updates</h2></div>
              {notif.data?.notifications?.length ? (
                <div className="space-y-2">
                  {notif.data.notifications.slice(0, 5).map((n: any) => (
                    <div key={n.id} className={`rounded-xl border p-3 ${severityColor[n.severity]}`}>
                      <div className="text-sm font-semibold text-white">{n.title}</div>
                      <div className="text-xs text-slate-300/90">{n.body}</div>
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

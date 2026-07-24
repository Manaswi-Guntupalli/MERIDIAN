import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { api } from '@/lib/api';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { T, CHART } from '@/constants/theme';

type Range = 'daily' | 'weekly' | 'monthly';

export default function PresenceAnalytics() {
  const [range, setRange] = useState<Range>('daily');

  const trend = useQuery({
    queryKey: ['presence-analytics', 'trend', range],
    queryFn: async () => (await api.get(`/presence/analytics/trend/${range}`)).data.series as { date: string; present: number; late: number; absent: number; rate: number }[],
  });
  const peak = useQuery({
    queryKey: ['presence-analytics', 'peak-entry-time'],
    queryFn: async () => (await api.get('/presence/analytics/peak-entry-time')).data as { histogram: { hour: number; count: number }[]; peakHour: number },
  });
  const methods = useQuery({
    queryKey: ['presence-analytics', 'method-breakdown'],
    queryFn: async () => (await api.get('/presence/analytics/method-breakdown')).data as { face: number; qr: number; manual: number; proxyAttempts: number; unverifiedQr: number },
  });
  const lateStudents = useQuery({
    queryKey: ['presence-analytics', 'late-students'],
    queryFn: async () => (await api.get('/presence/analytics/late-students')).data.students as { studentId: string; name: string; rollNo: number; className?: string; count: number; totalMinutes: number }[],
  });
  const absences = useQuery({
    queryKey: ['presence-analytics', 'frequent-absences'],
    queryFn: async () => (await api.get('/presence/analytics/frequent-absences')).data.students as { studentId: string; name: string; rollNo: number; className?: string; count: number }[],
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Attendance trend</h2>
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {(['daily', 'weekly', 'monthly'] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition ${range === r ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56">
          {trend.isLoading ? (
            <LoadingScreen />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.data}>
                <defs>
                  <linearGradient id="presenceRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={T.brand} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={T.brand} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: CHART.axis, fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: CHART.axis, fontSize: 11 }} width={30} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={CHART.tooltip} cursor={{ stroke: T.line }} formatter={(v: number) => [`${v}%`, 'Present + late']} />
                <Area type="monotone" dataKey="rate" stroke={T.brand} strokeWidth={2.5} fill="url(#presenceRate)" dot={false} activeDot={{ r: 4, fill: T.brand, strokeWidth: 2, stroke: T.surface }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Peak entry time</h2>
            {peak.data && <Badge severity="INFO">{formatHour(peak.data.peakHour)}</Badge>}
          </div>
          <div className="h-48">
            {peak.isLoading ? (
              <LoadingScreen />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peak.data?.histogram}>
                  <CartesianGrid strokeDasharray="2 4" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={formatHour} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} width={26} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART.tooltip} cursor={{ fill: T.well }} labelFormatter={(h: number) => formatHour(h)} />
                  <Bar dataKey="count" fill={T.cyan} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-slate-900">Capture method · integrity</h2>
          {methods.isLoading ? (
            <LoadingScreen />
          ) : methods.data ? (
            <div className="space-y-3">
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ name: 'Face', v: methods.data.face }, { name: 'QR', v: methods.data.qr }, { name: 'Manual', v: methods.data.manual }]} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={CHART.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: CHART.axis, fontSize: 11 }} width={60} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={CHART.tooltip} cursor={{ fill: T.well }} />
                    <Bar dataKey="v" fill={T.brand} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-2">
                <Badge severity={methods.data.proxyAttempts > 0 ? 'CRITICAL' : 'SUCCESS'}>{methods.data.proxyAttempts} proxy blocked</Badge>
                <Badge severity={methods.data.unverifiedQr > 0 ? 'WARNING' : 'INFO'}>{methods.data.unverifiedQr} unverified QR</Badge>
              </div>
            </div>
          ) : (
            <EmptyState title="No attendance captured yet" />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-bold text-slate-900">Late students</h2>
          {lateStudents.data?.length ? (
            <div className="space-y-1.5">
              {lateStudents.data.map((s) => (
                <div key={s.studentId} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-ink-800/60">
                  <span className="text-slate-800">{s.name} <span className="text-xs text-slate-500">{s.className ? `· ${s.className}` : ''}</span></span>
                  <Badge severity="WARNING">{s.count}× · {s.totalMinutes}m total</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No late arrivals in range" />
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-slate-900">Frequent absences</h2>
          {absences.data?.length ? (
            <div className="space-y-1.5">
              {absences.data.map((s) => (
                <div key={s.studentId} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-ink-800/60">
                  <span className="text-slate-800">{s.name} <span className="text-xs text-slate-500">{s.className ? `· ${s.className}` : ''}</span></span>
                  <Badge severity="CRITICAL">{s.count}× absent</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No absence patterns in range" />
          )}
        </Card>
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${period}`;
}

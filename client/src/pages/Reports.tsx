import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileBarChart, Printer, CheckCircle2, TrendingUp, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, StatTile } from '@/components/ui';
import { inr } from '@/lib/utils';

export default function Reports() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report'],
    queryFn: async () => (await api.get('/reports/summary')).data,
  }) as any;

  if (isLoading) return <LoadingScreen label="Generating report…" />;
  const m = data.metrics;

  return (
    <div>
      <PageHeader
        overline="Trust Core"
        title="AI-generated reports"
        subtitle="One click assembles live figures into an executive summary with recommendations — grounded, never guessed."
        actions={
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="btn-ghost"><Sparkles className="h-4 w-4" /> Regenerate</button>
            <button onClick={() => window.print()} className="btn-primary"><Printer className="h-4 w-4" /> Export</button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Students" value={m.students} accent="cyan" />
        <StatTile index={1} label="Attendance" value={`${m.attendanceRate}%`} accent="mint" />
        <StatTile index={2} label="Collected" value={inr(m.collected)} accent="brand" />
        <StatTile index={3} label="Outstanding" value={inr(m.outstanding)} accent="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2"><FileBarChart className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-white">{data.title}</h2><Badge className="ml-auto">{new Date(data.generatedAt).toLocaleString()}</Badge></div>
          <p className="text-sm leading-relaxed text-slate-300">{data.narrative}</p>

          <div className="mt-6">
            <div className="label mb-2">Recommendations</div>
            <div className="space-y-2">
              {data.recommendations.map((r: string, i: number) => (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-sm text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-400" /> {r}
                </motion.div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" /><h2 className="font-bold text-white">Forecast highlights</h2></div>
          <div className="space-y-3">
            {data.predictions.map((p: any, i: number) => (
              <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-sm text-slate-200">{p.label}</div>
                <div className="mt-1 text-[0.65rem] font-semibold text-slate-500">{Math.round(p.confidence * 100)}% confidence</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

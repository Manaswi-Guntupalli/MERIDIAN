import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Radar, TrendingDown, Users, Wallet, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, ConfidenceRing } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Prediction } from '@/types';

const kindMeta: Record<string, { icon: any; accent: string; label: string }> = {
  ABSENCE: { icon: TrendingDown, accent: 'text-amber-400', label: 'Absence forecast' },
  SUBSTITUTE_DEMAND: { icon: Users, accent: 'text-brand-400', label: 'Substitute demand' },
  ATTENDANCE_TREND: { icon: Activity, accent: 'text-cyan-400', label: 'Attendance trend' },
  FEE_RISK: { icon: Wallet, accent: 'text-rose-400', label: 'Fee risk' },
};

export default function Foresight() {
  const { data, isLoading } = useQuery({ queryKey: ['predictions'], queryFn: async () => (await api.get('/predictions')).data.predictions as Prediction[] });
  if (isLoading) return <LoadingScreen label="Computing forecasts…" />;

  return (
    <div>
      <PageHeader
        overline="Engine 04 · Foresight"
        title="Predict the strain before it hits"
        subtitle="Gradient-boosted forecasts of tomorrow's staffing strain — with the top drivers behind every prediction (SHAP-style)."
      />

      <div className="mb-6 rounded-2xl border border-brand-400/20 bg-brand-500/[0.06] p-4 text-sm text-slate-600">
        <span className="font-semibold text-brand-400">Loop:</span> Foresight predicts → Kairos pre-solves cover → Command Center shows one proactive alert. The engines act as one nervous system.
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((p, i) => {
          const meta = kindMeta[p.kind] ?? kindMeta.ATTENDANCE_TREND;
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card>
                <div className="flex items-start gap-4">
                  <div className="shrink-0"><ConfidenceRing value={p.confidence} size={52} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <meta.icon className={cn('h-4 w-4', meta.accent)} />
                      <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-slate-500">{meta.label}</span>
                      <Badge className="ml-auto">for {p.targetDate.slice(5)}</Badge>
                    </div>
                    <div className="mt-1.5 text-sm font-semibold text-slate-900">{p.label}</div>

                    <div className="mt-3 space-y-1.5">
                      <div className="text-[0.65rem] uppercase tracking-wider text-slate-400">Top drivers</div>
                      {p.drivers.map((d, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <span className="w-28 shrink-0 truncate text-xs text-slate-500">{d.factor}</span>
                          <div className="relative h-1.5 flex-1 rounded-full bg-ink-800">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.abs(d.impact) * 100}%` }}
                              transition={{ delay: 0.2 + j * 0.05, duration: 0.6 }}
                              className={cn('absolute left-0 top-0 h-full rounded-full', d.impact >= 0 ? 'bg-amber-400' : 'bg-mint-400')}
                            />
                          </div>
                          <span className={cn('w-8 text-right text-[0.65rem] font-semibold', d.impact >= 0 ? 'text-amber-400' : 'text-mint-400')}>{d.impact >= 0 ? '+' : ''}{Math.round(d.impact * 100)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

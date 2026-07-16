import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserX, AlertTriangle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, Meter } from '@/components/ui';
import { initials } from '@/lib/utils';
import type { TeacherRow } from '@/types';

export default function Staff() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: async () => (await api.get('/staff')).data.teachers as TeacherRow[] });

  const markAbsent = useMutation({
    mutationFn: async (teacherId: string) => (await api.post('/staff/absence', { teacherId, date: new Date().toISOString().slice(0, 10) })).data,
    onSuccess: (res) => {
      pushToast({
        title: 'Absence recorded',
        body: res.suggestion ? `Suggested cover: ${res.suggestion.name}` : 'Cover flow triggered',
        severity: 'WARNING',
      });
      qc.invalidateQueries({ queryKey: ['command-center'] });
    },
    onError: (e) => pushToast({ title: 'Failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (isLoading) return <LoadingScreen />;
  const overloaded = data?.filter((t) => t.overloaded).length ?? 0;

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Staff"
        subtitle="Weekly hour caps are a Kairos hard constraint — overload here ripples into scheduling."
        actions={overloaded > 0 && <Badge severity="WARNING"><AlertTriangle className="h-3.5 w-3.5" /> {overloaded} near cap</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data?.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <Card className="glass-hover h-full">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-amber-400/80 to-rose-400/80 text-sm font-bold text-ink-950">{initials(t.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.department} · {t.employeeId}</div>
                </div>
                {t.overloaded && <Badge severity="WARNING">At cap</Badge>}
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Weekly load</span>
                  <span className="font-semibold text-slate-300">{t.weeklyHours}/{t.maxHours}h</span>
                </div>
                <Meter value={t.load} tone={t.overloaded ? 'rose' : t.load > 80 ? 'amber' : 'brand'} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.subjects.map((s) => <span key={s} className="chip">{s}</span>)}
                {t.classesLed.map((c) => <span key={c} className="chip !border-brand-400/30 !text-brand-400">{c}</span>)}
              </div>

              <button onClick={() => markAbsent.mutate(t.id)} className="btn-ghost mt-4 w-full !py-2 text-xs">
                <UserX className="h-3.5 w-3.5" /> Mark absent today
              </button>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

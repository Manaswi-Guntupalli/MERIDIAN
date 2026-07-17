import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserX, AlertTriangle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { Table, CellIdentity } from '@/components/ui/Table';
import { initials, cn } from '@/lib/utils';
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

      <Table
        rows={data ?? []}
        rowKey={(t) => t.id}
        empty={<EmptyState title="No staff yet" />}
        columns={[
          { key: 'name', header: 'Teacher', cell: (t) => <CellIdentity initials={initials(t.name)} title={t.name} sub={t.employeeId} /> },
          { key: 'dept', header: 'Department', cell: (t) => <span className="text-slate-600">{t.department}</span> },
          {
            key: 'subjects',
            header: 'Teaches',
            cell: (t) => (
              <div className="flex flex-wrap gap-1">
                {t.subjects.map((s) => <span key={s} className="rounded border border-line bg-ink-800 px-1.5 py-px text-[0.68rem] font-medium text-slate-500">{s}</span>)}
                {t.classesLed.map((c) => <span key={c} className="rounded border border-brand-200 bg-brand-50 px-1.5 py-px text-[0.68rem] font-semibold text-brand-700">{c}</span>)}
              </div>
            ),
          },
          {
            key: 'load',
            header: 'Weekly load',
            width: '190px',
            cell: (t) => (
              <div className="flex items-center gap-2.5">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className={cn('h-full rounded-full', t.overloaded ? 'bg-rose-400' : t.load > 80 ? 'bg-amber-400' : 'bg-brand-500')}
                    style={{ width: `${Math.min(100, t.load)}%` }}
                  />
                </div>
                <span className={cn('tnum text-[0.75rem] font-semibold', t.overloaded ? 'text-rose-400' : 'text-slate-500')}>
                  {t.weeklyHours}/{t.maxHours}h
                </span>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            width: '100px',
            cell: (t) => (t.overloaded ? <Badge severity="WARNING">at cap</Badge> : <Badge severity="SUCCESS">balanced</Badge>),
          },
          {
            key: 'action',
            header: '',
            align: 'right',
            width: '120px',
            cell: (t) => (
              <button onClick={() => markAbsent.mutate(t.id)} className="btn-ghost !px-2.5 !py-1 text-[0.72rem]">
                <UserX className="h-3.5 w-3.5" /> Absent
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

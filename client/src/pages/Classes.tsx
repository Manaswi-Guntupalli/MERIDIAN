import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { School, User, DoorOpen, Users, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { LoadingScreen, EmptyState } from '@/components/ui';
import type { ClassRow } from '@/types';

export default function Classes() {
  const { data, isLoading } = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  if (isLoading) return <LoadingScreen />;

  const totalStudents = data?.reduce((a, c) => a + c.students, 0) ?? 0;
  // Group by grade so the page reads as a school structure, not a flat wall.
  const grades = [...new Set((data ?? []).map((c) => c.grade))].sort((a, b) => a - b);

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Classes"
        subtitle="Sections, rooms and class teachers across the school."
        actions={
          <div className="flex items-baseline gap-1.5 rounded-[9px] border border-line bg-surface px-3 py-2 shadow-xs">
            <span className="tnum font-display text-lg font-semibold text-slate-900">{totalStudents}</span>
            <span className="text-[0.75rem] text-slate-400">students in {data?.length ?? 0} sections</span>
          </div>
        }
      />

      {!data?.length ? (
        <EmptyState icon={<School className="h-7 w-7" />} title="No classes yet" />
      ) : (
        <div className="space-y-8">
          {grades.map((grade) => (
            <section key={grade}>
              {/* Grade rule — structure before items */}
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-display text-[0.95rem] font-semibold text-slate-900">Grade {grade}</h2>
                <span className="h-px flex-1 bg-line" />
                <span className="text-[0.7rem] text-slate-400">
                  {data.filter((c) => c.grade === grade).length} section{data.filter((c) => c.grade === grade).length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data
                  .filter((c) => c.grade === grade)
                  .map((c, i) => (
                    <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.3 }}>
                      <Link to={`/attendance?classId=${c.id}`} className="surface surface-hover group block p-4">
                        <div className="flex items-start justify-between">
                          <span className="grid h-11 w-11 place-items-center rounded-[10px] bg-brand-50 font-display text-base font-semibold text-brand-700">
                            {c.name}
                          </span>
                          <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-brand-600" />
                        </div>

                        <dl className="mt-4 space-y-2 text-[0.8rem]">
                          <Row icon={<Users className="h-3.5 w-3.5" />} label="Students" value={`${c.students}`} />
                          <Row icon={<User className="h-3.5 w-3.5" />} label="Class teacher" value={c.classTeacher ?? 'Unassigned'} />
                          <Row icon={<DoorOpen className="h-3.5 w-3.5" />} label="Room" value={c.room ?? '—'} />
                        </dl>
                      </Link>
                    </motion.div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-300">{icon}</span>
      <dt className="text-slate-400">{label}</dt>
      <dd className="ml-auto truncate font-medium text-slate-700">{value}</dd>
    </div>
  );
}

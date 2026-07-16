import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { School, User, DoorOpen, Users } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, LoadingScreen } from '@/components/ui';
import type { ClassRow } from '@/types';

export default function Classes() {
  const { data, isLoading } = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  if (isLoading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader overline="Pulse · ERP" title="Classes" subtitle="Sections, rooms and class teachers across the school." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((c, i) => (
          <motion.div key={c.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}>
            <Link to={`/attendance?classId=${c.id}`}>
              <Card className="glass-hover">
                <div className="flex items-center justify-between">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-lg font-extrabold text-ink-950">{c.name}</div>
                  <School className="h-5 w-5 text-slate-600" />
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-slate-400"><Users className="h-4 w-4" /> {c.students} students</div>
                  <div className="flex items-center gap-2 text-slate-400"><User className="h-4 w-4" /> {c.classTeacher ?? 'No class teacher'}</div>
                  <div className="flex items-center gap-2 text-slate-400"><DoorOpen className="h-4 w-4" /> {c.room ?? 'No room'}</div>
                </div>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

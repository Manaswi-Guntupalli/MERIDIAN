import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Map, Users, User, Zap, DoorClosed, FlaskConical, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { TwinBuilding, TwinRoom } from '@/types';

const roomIcon: Record<string, any> = { LAB: FlaskConical, LIBRARY: BookOpen, HALL: Users, OFFICE: DoorClosed, CLASSROOM: DoorClosed };

export default function Twin() {
  const [sel, setSel] = useState<TwinRoom | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['twin'],
    queryFn: async () => (await api.get('/twin')).data as { day: string; period: number; emergency: string | null; buildings: TwinBuilding[] },
    refetchInterval: 6000,
  });

  if (isLoading) return <LoadingScreen label="Rendering digital twin…" />;

  const roomTone = (r: TwinRoom) => {
    if (!r.occupied) return 'border-white/10 bg-white/[0.02]';
    if (!r.teacherPresent) return 'border-rose-400/40 bg-rose-500/10';
    if (r.attendancePct !== null && r.attendancePct < 85) return 'border-amber-400/40 bg-amber-400/10';
    return 'border-mint-400/40 bg-mint-400/10';
  };

  return (
    <div>
      <PageHeader
        overline="Live Operations"
        title="School Digital Twin"
        subtitle="A live, animated map of the campus — occupancy, teacher presence, attendance and power, updating in real time."
        actions={<div className="flex gap-2"><Badge severity="INFO">{data?.day} · Period {data?.period}</Badge><Badge severity="SUCCESS"><span className="h-1.5 w-1.5 animate-pulseGlow rounded-full bg-mint-400" /> Live</Badge></div>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
            <div className="grid gap-5 sm:grid-cols-2">
              {data?.buildings.map((b, bi) => (
                <motion.div key={b.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: bi * 0.08 }} className="rounded-2xl border border-white/[0.08] bg-ink-850/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{b.name}</span>
                    <span className="text-[0.6rem] text-slate-600">{b.rooms.length} rooms</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {b.rooms.map((r) => {
                      const Icon = roomIcon[r.type] ?? DoorClosed;
                      return (
                        <motion.button
                          key={r.id}
                          onClick={() => setSel(r)}
                          whileHover={{ y: -2 }}
                          className={cn('rounded-xl border p-2.5 text-left transition', roomTone(r), sel?.id === r.id && '!ring-2 !ring-brand-400/50')}
                        >
                          <div className="flex items-center justify-between">
                            <Icon className="h-3.5 w-3.5 text-slate-400" />
                            {r.occupied && <span className={cn('h-1.5 w-1.5 rounded-full', r.teacherPresent ? 'bg-mint-400 animate-pulseGlow' : 'bg-rose-400')} />}
                          </div>
                          <div className="mt-1 text-xs font-bold text-white">{r.name}</div>
                          <div className="truncate text-[0.6rem] text-slate-500">{r.className ?? 'Vacant'}</div>
                          {r.attendancePct !== null && <div className="mt-0.5 text-[0.6rem] font-semibold text-slate-400">{r.attendancePct}% present</div>}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-[0.65rem] text-slate-500">
              <Legend color="bg-mint-400" label="Class in session" />
              <Legend color="bg-rose-400" label="Teacher absent" />
              <Legend color="bg-amber-400" label="Low attendance" />
              <Legend color="bg-white/20" label="Vacant" />
            </div>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 font-bold text-white">Room detail</h2>
          {sel ? (
            <motion.div key={sel.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-white">{sel.name}</div>
                  <Badge>{sel.type}</Badge>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <Row icon={<Users className="h-4 w-4" />} label="Class" value={sel.className ?? 'Vacant'} />
                  <Row icon={<BookOpen className="h-4 w-4" />} label="Subject" value={sel.subject ?? '—'} />
                  <Row icon={<User className="h-4 w-4" />} label="Teacher" value={sel.teacher ?? '—'} ok={sel.teacherPresent} />
                  <Row icon={<Users className="h-4 w-4" />} label="Attendance" value={sel.attendancePct !== null ? `${sel.attendancePct}%` : '—'} />
                  <Row icon={<Zap className="h-4 w-4" />} label="Power" value="Normal" ok />
                </div>
              </Card>
            </motion.div>
          ) : (
            <Card className="grid place-items-center py-16 text-center text-sm text-slate-500"><Map className="mb-2 h-6 w-6" /> Tap any room to inspect it live.</Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', color)} /> {label}</span>;
}
function Row({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-slate-500">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <span className={cn('ml-auto font-medium', ok === false ? 'text-rose-400' : ok ? 'text-mint-400' : 'text-slate-200')}>{value}</span>
    </div>
  );
}

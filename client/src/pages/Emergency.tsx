import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Waves, HeartPulse, Lock, ShieldAlert, Send, CheckCircle2, Users, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

const KINDS = [
  { kind: 'FIRE', icon: Flame, tone: 'from-rose-500 to-amber-500', desc: 'Evacuate to assembly ground' },
  { kind: 'EARTHQUAKE', icon: Waves, tone: 'from-amber-500 to-yellow-500', desc: 'Drop, cover, hold' },
  { kind: 'MEDICAL', icon: HeartPulse, tone: 'from-rose-500 to-pink-500', desc: 'Dispatch medical team' },
  { kind: 'LOCKDOWN', icon: Lock, tone: 'from-brand-500 to-indigo-500', desc: 'Secure all rooms' },
];

export default function Emergency() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [confirm, setConfirm] = useState<string | null>(null);

  const active = useQuery({ queryKey: ['emergency'], queryFn: async () => (await api.get('/emergency/active')).data.active });

  const trigger = useMutation({
    mutationFn: async (kind: string) => (await api.post('/emergency/trigger', { kind })).data,
    onSuccess: (res) => { pushToast({ title: `🚨 ${res.incident.kind} activated`, body: 'Teachers, parents & admins alerted', severity: 'CRITICAL' }); qc.invalidateQueries({ queryKey: ['emergency'] }); setConfirm(null); },
  });
  const resolve = useMutation({
    mutationFn: async (id: string) => api.post(`/emergency/resolve/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emergency'] }); pushToast({ title: 'All clear', severity: 'SUCCESS' }); },
  });

  return (
    <div>
      <PageHeader overline="Trust Core" title="Emergency Mode" subtitle="One button. Instantly alerts every teacher, parent and administrator, and broadcasts the evacuation protocol." />

      <AnimatePresence>
        {active.data && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="mb-6">
            <Card className="!border-rose-400/40 !bg-rose-500/10">
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 animate-pulseGlow place-items-center rounded-xl bg-rose-500/30 text-rose-300"><ShieldAlert className="h-6 w-6" /></span>
                <div className="flex-1">
                  <div className="text-lg font-bold text-rose-200">{active.data.kind} EMERGENCY ACTIVE</div>
                  <div className="text-sm text-rose-200/80">{active.data.protocol}</div>
                </div>
                <button onClick={() => resolve.mutate(active.data.id)} className="btn-ghost !border-rose-400/40 !text-rose-200"><CheckCircle2 className="h-4 w-4" /> All clear</button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KINDS.map((k, i) => (
          <motion.button
            key={k.kind}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            whileHover={{ y: -4 }}
            onClick={() => setConfirm(k.kind)}
            className="surface surface-hover group relative overflow-hidden p-6 text-left"
          >
            <div className={cn('absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition group-hover:opacity-40', k.tone)} />
            <span className={cn('grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br text-slate-900', k.tone)}><k.icon className="h-6 w-6" /></span>
            <div className="mt-4 text-lg font-bold text-slate-900">{k.kind}</div>
            <div className="text-xs text-slate-500">{k.desc}</div>
          </motion.button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Info icon={<Bell className="h-4 w-4" />} title="Instant broadcast" desc="Every role notified in realtime via the event stream" />
        <Info icon={<Users className="h-4 w-4" />} title="Evacuation protocol" desc="Role-appropriate instructions pushed to all devices" />
        <Info icon={<ShieldAlert className="h-4 w-4" />} title="Fully audited" desc="Trigger & resolve logged immutably in the Trust Core" />
      </div>

      <AnimatePresence>
        {confirm && (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setConfirm(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="surface w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/20 text-rose-400"><ShieldAlert className="h-7 w-7" /></span>
              <h2 className="mt-4 text-lg font-bold text-slate-900">Trigger {confirm} emergency?</h2>
              <p className="mt-1 text-sm text-slate-500">This will immediately alert everyone in the school. Use only for real emergencies or a sanctioned drill.</p>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setConfirm(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => trigger.mutate(confirm)} disabled={trigger.isPending} className="btn-danger flex-1">{trigger.isPending ? <Spinner /> : <><Send className="h-4 w-4" /> Trigger</>}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Info({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-brand-400">{icon}</span>
      <div><div className="text-sm font-semibold text-slate-900">{title}</div><div className="text-xs text-slate-500">{desc}</div></div>
    </Card>
  );
}

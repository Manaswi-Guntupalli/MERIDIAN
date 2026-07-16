import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function EmergencyBanner() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const isStaffAdmin = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);

  const { data } = useQuery({
    queryKey: ['emergency'],
    queryFn: async () => (await api.get('/emergency/active')).data as { active: any },
    refetchInterval: 8000,
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => api.post(`/emergency/resolve/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emergency'] }),
  });

  const active = data?.active;
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-rose-500/40 bg-rose-500/15"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 lg:px-6">
            <span className="grid h-8 w-8 shrink-0 animate-pulseGlow place-items-center rounded-lg bg-rose-500/30 text-rose-300">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-bold text-rose-200">{active.kind} EMERGENCY ACTIVE</span>
              <span className="ml-2 hidden text-xs text-rose-200/80 sm:inline">{active.protocol}</span>
            </div>
            {isStaffAdmin && (
              <button onClick={() => resolve.mutate(active.id)} className="btn-ghost !border-rose-400/40 !py-1.5 !text-rose-200 hover:!bg-rose-500/20">
                <X className="h-3.5 w-3.5" /> All clear
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

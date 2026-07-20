import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert, X, Check, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

interface ActiveEmergency {
  id: string;
  kind: string;
  title: string;
  protocol: string;
  instructions: string[];
  triggeredBy?: string;
  canAcknowledge: boolean;
  ackRole: 'TEACHER' | 'PARENT' | null;
  myAck: string | null;
  myClass: string | null;
}

export default function EmergencyBanner() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const isStaffAdmin = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);

  // Shares the ['emergency'] cache with the Emergency page — both MUST resolve
  // to the active incident (or null), never a wrapper object, or the shapes
  // collide and one side misreads the other's cache.
  const { data: active } = useQuery({
    queryKey: ['emergency'],
    queryFn: async () => ((await api.get('/emergency/active')).data.active ?? null) as ActiveEmergency | null,
    refetchInterval: 8000,
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => api.post(`/emergency/resolve/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emergency'] }),
  });

  const ack = useMutation({
    mutationFn: async (v: { id: string; status: string }) => api.post(`/emergency/${v.id}/acknowledge`, { status: v.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emergency'] });
      qc.invalidateQueries({ queryKey: ['emergency-state'] });
    },
  });

  if (!active) return null;

  const ackLabel =
    active.myAck === 'SAFE' ? `You reported ${active.myClass ?? 'your class'} Safe` :
    active.myAck === 'NEED_ASSISTANCE' ? 'You requested assistance — help is coordinating' :
    active.myAck === 'ACKNOWLEDGED' ? 'You acknowledged — please await official updates' :
    active.myAck === 'NEED_INFO' ? 'You requested information — the school will update you' : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="overflow-hidden border-b border-rose-500/40 bg-rose-500/15"
      >
        <div className="flex flex-col gap-2 px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 animate-pulseGlow place-items-center rounded-lg bg-rose-500/30 text-rose-300">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-bold text-rose-200">{active.title.toUpperCase()} ACTIVE</span>
              <span className="ml-2 hidden text-xs text-rose-200/80 sm:inline">{active.protocol}</span>
            </div>

            {/* Role-aware acknowledgement — the only surface parents/students
                can reach, so it lives in the banner shown on every device. */}
            {active.canAcknowledge && !active.myAck && (
              <div className="flex shrink-0 gap-1.5">
                {active.ackRole === 'TEACHER' ? (
                  <>
                    <button onClick={() => ack.mutate({ id: active.id, status: 'SAFE' })} disabled={ack.isPending} className="inline-flex items-center gap-1 rounded-lg border border-mint-400/50 bg-mint-500/20 px-2.5 py-1 text-xs font-semibold text-mint-200 hover:bg-mint-500/30">
                      <Check className="h-3.5 w-3.5" /> Class Safe
                    </button>
                    <button onClick={() => ack.mutate({ id: active.id, status: 'NEED_ASSISTANCE' })} disabled={ack.isPending} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30">
                      <TriangleAlert className="h-3.5 w-3.5" /> Need Assistance
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => ack.mutate({ id: active.id, status: 'ACKNOWLEDGED' })} disabled={ack.isPending} className="inline-flex items-center gap-1 rounded-lg border border-mint-400/50 bg-mint-500/20 px-2.5 py-1 text-xs font-semibold text-mint-200 hover:bg-mint-500/30">
                      <Check className="h-3.5 w-3.5" /> Acknowledge
                    </button>
                    <button onClick={() => ack.mutate({ id: active.id, status: 'NEED_INFO' })} disabled={ack.isPending} className="rounded-lg border border-rose-300/40 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">
                      Need Information
                    </button>
                  </>
                )}
              </div>
            )}
            {ackLabel && <span className="shrink-0 rounded-lg bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-100">{ackLabel} ✓</span>}

            {isStaffAdmin && (
              <button onClick={() => resolve.mutate(active.id)} className="btn-ghost shrink-0 !border-rose-400/40 !py-1.5 !text-rose-200 hover:!bg-rose-500/20">
                <X className="h-3.5 w-3.5" /> All clear
              </button>
            )}
          </div>

          {/* Role-specific standing instructions */}
          {active.instructions?.length > 0 && (
            <ul className="ml-11 flex flex-col gap-0.5 text-xs text-rose-200/85 sm:flex-row sm:flex-wrap sm:gap-x-4">
              {active.instructions.map((line, i) => (
                <li key={i} className="flex items-start gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-rose-300" />{line}</li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

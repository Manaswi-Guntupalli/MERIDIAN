import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, HelpCircle, Lock, LockOpen, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Badge, ConfidenceRing, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { KSlot, KSlotOptions, KTimetable } from './types';

/**
 * One slot, one card: what it is, why Kairos chose it, and — for admins on a
 * draft — the controls to adjust it safely. Every edit is validated server-
 * side against every hard constraint before it lands.
 */
export default function SlotDialog({
  slot,
  timetable,
  editable,
  onClose,
}: {
  slot: KSlot;
  timetable: KTimetable;
  editable: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [showWhy, setShowWhy] = useState(false);
  const [teacherId, setTeacherId] = useState(slot.teacherId);
  const [roomId, setRoomId] = useState(slot.roomId ?? '');
  const [cellKey, setCellKey] = useState(`${slot.day}-${slot.period}`);
  const [violations, setViolations] = useState<string[]>([]);

  const options = useQuery({
    queryKey: ['kairos-slot-options', slot.id],
    queryFn: async () => (await api.get(`/timetable/draft/slots/${slot.id}/options`)).data as KSlotOptions,
    enabled: editable,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['kairos-draft'] });
    qc.invalidateQueries({ queryKey: ['kairos-overview'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const [d, p] = cellKey.split('-').map(Number);
      return (
        await api.patch(`/timetable/draft/slots/${slot.id}`, {
          day: d,
          period: p,
          teacherId,
          roomId: roomId || null,
        })
      ).data;
    },
    onSuccess: () => {
      refresh();
      pushToast({ title: 'Slot updated', body: 'Change checked against every rule and locked in.', severity: 'SUCCESS' });
      onClose();
    },
    onError: (err: any) => {
      const v = err?.response?.data?.violations as string[] | undefined;
      if (v?.length) setViolations(v);
      else pushToast({ title: 'Could not update', body: apiError(err), severity: 'CRITICAL' });
    },
  });

  const toggleLock = useMutation({
    mutationFn: async () => (await api.post(`/timetable/draft/slots/${slot.id}/lock`, { locked: !slot.locked })).data,
    onSuccess: () => {
      refresh();
      pushToast({
        title: slot.locked ? 'Slot unlocked' : 'Slot locked',
        body: slot.locked ? 'Regeneration may move it again.' : 'Regeneration will keep it exactly here.',
        severity: 'INFO',
      });
      onClose();
    },
  });

  const changed = teacherId !== slot.teacherId || (roomId || '') !== (slot.roomId ?? '') || cellKey !== `${slot.day}-${slot.period}`;
  const why = slot.explain;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: slot.subjectColor }} />
              <h2 className="font-bold text-slate-900">{slot.subject}</h2>
              {slot.locked && <Badge><Lock className="h-3 w-3" /> Locked</Badge>}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {slot.className} · {slot.teacher}
              {slot.room ? ` · ${slot.room}` : ''}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {timetable.days[slot.day]} · {timetable.periods[slot.period]}
              {timetable.periodTimes[slot.period] ? ` (${timetable.periodTimes[slot.period].start}–${timetable.periodTimes[slot.period].end})` : ''}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Why? — Meridian's explainability principle */}
        <button
          onClick={() => setShowWhy((v) => !v)}
          className="mt-4 flex w-full items-center justify-between rounded-xl border border-line bg-ink-800/40 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-ink-800/70"
        >
          <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-brand-400" /> Why this assignment?</span>
          <span className="text-xs text-slate-400">{showWhy ? 'Hide' : 'Show'}</span>
        </button>
        {showWhy && why && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            <div className="mt-3 flex items-start gap-4 rounded-xl border border-line p-3.5">
              <div className="flex-1 space-y-1.5">
                {why.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400" />
                    <span>{r}</span>
                  </div>
                ))}
                {(why.alternatives.teachers > 0 || why.alternatives.rooms > 0) && (
                  <div className="pt-1 text-[0.68rem] text-slate-400">
                    {why.alternatives.teachers > 0 && `${why.alternatives.teachers} other teacher(s) could take this. `}
                    {why.alternatives.rooms > 0 && `${why.alternatives.rooms} other room(s) available.`}
                  </div>
                )}
              </div>
              <div className="text-center">
                <ConfidenceRing value={why.confidence} />
                <div className="mt-1 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">Confidence</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Draft editing — admins only */}
        {editable && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Teacher</span>
                <select value={teacherId} onChange={(e) => { setTeacherId(e.target.value); setViolations([]); }} className="input mt-1 w-full">
                  {(options.data?.teachers ?? [{ id: slot.teacherId, name: slot.teacher, ok: true }]).map((t) => (
                    <option key={t.id} value={t.id} disabled={!t.ok && t.id !== slot.teacherId}>
                      {t.name}{!t.ok && t.id !== slot.teacherId ? ' — busy' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Room</span>
                <select value={roomId} onChange={(e) => { setRoomId(e.target.value); setViolations([]); }} className="input mt-1 w-full">
                  <option value="">No room</option>
                  {(options.data?.rooms ?? []).map((r) => (
                    <option key={r.id} value={r.id} disabled={!r.ok && r.id !== slot.roomId}>
                      {r.name}{!r.ok && r.id !== slot.roomId ? ' — busy' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="label">Move to</span>
              <select value={cellKey} onChange={(e) => { setCellKey(e.target.value); setViolations([]); }} className="input mt-1 w-full">
                <option value={`${slot.day}-${slot.period}`}>
                  Keep {timetable.days[slot.day]} {timetable.periods[slot.period]}
                </option>
                {(options.data?.cells ?? []).map((c) => (
                  <option key={`${c.day}-${c.period}`} value={`${c.day}-${c.period}`}>
                    {timetable.days[c.day]} {timetable.periods[c.period]}
                  </option>
                ))}
              </select>
            </label>

            {violations.length > 0 && (
              <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.05] p-3">
                <div className="text-xs font-bold text-rose-400">This change would break the rules:</div>
                {violations.map((v, i) => (
                  <div key={i} className="mt-1 text-xs text-slate-600">• {v}</div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button onClick={() => toggleLock.mutate()} disabled={toggleLock.isPending} className={cn('btn-ghost text-xs', slot.locked && '!text-amber-400')}>
                {toggleLock.isPending ? <Spinner /> : slot.locked ? <><LockOpen className="h-3.5 w-3.5" /> Unlock</> : <><Lock className="h-3.5 w-3.5" /> Lock in place</>}
              </button>
              <button onClick={() => save.mutate()} disabled={!changed || save.isPending} className="btn-primary text-xs disabled:opacity-40">
                {save.isPending ? <Spinner /> : 'Apply change'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

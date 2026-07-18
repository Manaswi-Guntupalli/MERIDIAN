import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, Check, ShieldCheck, UserX, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Badge, EmptyState, Spinner } from '@/components/ui';
import type { TeacherRow } from '@/types';
import type { KSubSuggestion } from './types';

/**
 * Emergency mode: a teacher is out, and only their periods get re-covered.
 * Each suggestion explains itself; the admin can swap in an alternative
 * before applying. The published timetable never changes.
 */
export default function CoverDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [teacherId, setTeacherId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [plan, setPlan] = useState<{ suggestions: KSubSuggestion[]; message: string | null } | null>(null);
  const [picks, setPicks] = useState<Record<number, string>>({}); // period → subTeacherId

  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get('/staff')).data.teachers as TeacherRow[],
  });

  const planMutation = useMutation({
    mutationFn: async () => (await api.post('/timetable/substitute/plan', { teacherId, date })).data,
    onSuccess: (res) => {
      setPlan(res);
      const initial: Record<number, string> = {};
      for (const s of res.suggestions as KSubSuggestion[]) {
        if (s.candidate) initial[s.slot.period] = s.candidate.teacherId;
      }
      setPicks(initial);
    },
    onError: (err) => pushToast({ title: 'Could not plan cover', body: apiError(err), severity: 'CRITICAL' }),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const payload = plan!.suggestions
        .filter((s) => picks[s.slot.period])
        .map((s) => {
          const chosen =
            s.candidate?.teacherId === picks[s.slot.period]
              ? s.candidate
              : s.alternatives.find((a) => a.teacherId === picks[s.slot.period]) ?? s.candidate;
          return {
            period: s.slot.period,
            classId: s.slot.classId,
            subjectId: s.slot.subjectId,
            subTeacherId: picks[s.slot.period],
            reasons: chosen?.reasons,
            confidence: chosen?.confidence,
          };
        });
      return (await api.post('/timetable/substitute/apply', { teacherId, date, picks: payload })).data;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      pushToast({ title: 'Cover arranged', body: `${res.covered} period(s) covered. Substitutes have been notified.`, severity: 'SUCCESS' });
      onClose();
    },
    onError: (err) => pushToast({ title: 'Could not apply', body: apiError(err), severity: 'CRITICAL' }),
  });

  const covered = plan ? plan.suggestions.filter((s) => picks[s.slot.period]).length : 0;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex max-h-[86vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line p-5 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-amber-400" />
              <h2 className="font-bold text-slate-900">Arrange cover</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">Only the absent teacher's periods are re-assigned — nothing else moves.</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex items-end gap-2 border-b border-line p-5 py-4">
          <label className="block flex-1">
            <span className="label">Who is out?</span>
            <select value={teacherId} onChange={(e) => { setTeacherId(e.target.value); setPlan(null); }} className="input mt-1 w-full">
              <option value="">Select teacher…</option>
              {staff.data?.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Date</span>
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPlan(null); }} className="input mt-1" />
          </label>
          <button onClick={() => planMutation.mutate()} disabled={!teacherId || planMutation.isPending} className="btn-primary disabled:opacity-40">
            {planMutation.isPending ? <Spinner /> : 'Plan'}
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-5">
          {!plan ? (
            <p className="py-6 text-center text-sm text-slate-400">Pick a teacher and date, then Plan.</p>
          ) : plan.message ? (
            <p className="py-6 text-center text-sm text-slate-500">{plan.message}</p>
          ) : plan.suggestions.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="h-7 w-7" />} title="Nothing to cover" hint="This teacher has no periods that day." />
          ) : (
            <div className="space-y-2.5">
              {plan.suggestions.map((s) => {
                const all = s.candidate ? [s.candidate, ...s.alternatives] : s.alternatives;
                const chosen = all.find((c) => c.teacherId === picks[s.slot.period]);
                return (
                  <div key={s.slot.period} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge>P{s.slot.period + 1}</Badge>
                      <span className="font-semibold text-slate-800">{s.slot.className}</span>
                      <span className="text-slate-500">{s.slot.subjectName}</span>
                      {s.slot.roomName && <span className="text-slate-400">· {s.slot.roomName}</span>}
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      {all.length === 0 ? (
                        <span className="font-semibold text-rose-400">No qualified teacher free</span>
                      ) : (
                        <select
                          value={picks[s.slot.period] ?? ''}
                          onChange={(e) => setPicks({ ...picks, [s.slot.period]: e.target.value })}
                          className="input !w-auto !py-1 text-xs"
                        >
                          <option value="">Leave uncovered</option>
                          {all.map((c) => (
                            <option key={c.teacherId} value={c.teacherId}>
                              {c.teacherName} ({Math.round(c.confidence * 100)}%)
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {chosen && (
                      <div className="mt-2 space-y-0.5 pl-1">
                        {chosen.reasons.map((r, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-[0.68rem] text-slate-500">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-mint-400" /> {r}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {plan && !plan.message && plan.suggestions.length > 0 && (
          <div className="flex items-center justify-between border-t border-line p-5 py-4">
            <span className="text-xs text-slate-500">{covered} of {plan.suggestions.length} period(s) covered</span>
            <button onClick={() => apply.mutate()} disabled={!covered || apply.isPending} className="btn-primary disabled:opacity-40">
              {apply.isPending ? <Spinner /> : 'Apply & notify substitutes'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

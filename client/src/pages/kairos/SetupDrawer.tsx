import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarRange, GraduationCap, Users2, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Badge, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { KConfig, KCurriculumClass, KSubject, KTeacherConstraint } from './types';

type Section = 'day' | 'curriculum' | 'teachers';

/**
 * All planner configuration in one calm drawer: the school day, each class's
 * curriculum, and each teacher's working rules. Three sections — not ten pages.
 */
export default function SetupDrawer({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('day');
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/25 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ x: 560 }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="flex h-full w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="eyebrow">Kairos setup</div>
            <h2 className="text-lg font-bold text-slate-900">Plan the school week</h2>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close setup"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-1 border-b border-line px-5 pt-3">
          {(
            [
              ['day', 'School day', CalendarRange],
              ['curriculum', 'Curriculum', GraduationCap],
              ['teachers', 'Teachers', Users2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors',
                section === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-400 hover:text-slate-700',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-5">
          {section === 'day' && <SchoolDaySection />}
          {section === 'curriculum' && <CurriculumSection />}
          {section === 'teachers' && <TeachersSection />}
        </div>
      </motion.div>
    </div>
  );
}

// ── School day ────────────────────────────────────────────────────────────────
function SchoolDaySection() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const cfg = useQuery({
    queryKey: ['kairos-settings'],
    queryFn: async () => (await api.get('/timetable/settings')).data.config as KConfig,
  });
  const [form, setForm] = useState<KConfig | null>(null);
  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const save = useMutation({
    mutationFn: async () => (await api.put('/timetable/settings', form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kairos-settings'] });
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      pushToast({ title: 'School day saved', body: 'Regenerate the draft to apply the new timings.', severity: 'SUCCESS' });
    },
    onError: (err) => pushToast({ title: 'Could not save', body: apiError(err), severity: 'CRITICAL' }),
  });

  if (!form) return <Spinner />;
  const set = <K extends keyof KConfig>(k: K, v: KConfig[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Academic year</span>
          <input value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)} className="input mt-1 w-full" />
        </label>
        <label className="block">
          <span className="label">Working days</span>
          <select value={form.workingDays} onChange={(e) => set('workingDays', Number(e.target.value))} className="input mt-1 w-full">
            <option value={5}>Monday – Friday</option>
            <option value={6}>Monday – Saturday</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Day starts at</span>
          <input type="time" value={form.dayStart} onChange={(e) => set('dayStart', e.target.value)} className="input mt-1 w-full" />
        </label>
        <label className="block">
          <span className="label">Period length (min)</span>
          <input type="number" min={20} max={90} value={form.periodMinutes} onChange={(e) => set('periodMinutes', Number(e.target.value))} className="input mt-1 w-full" />
        </label>
        <label className="block">
          <span className="label">Periods per day</span>
          <input type="number" min={4} max={10} value={form.periodsPerDay} onChange={(e) => set('periodsPerDay', Number(e.target.value))} className="input mt-1 w-full" />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Breaks</span>
          <button
            onClick={() => set('breaks', [...form.breaks, { after: 2, name: 'Break', minutes: 10 }])}
            className="btn-ghost text-xs"
            disabled={form.breaks.length >= 4}
          >
            + Add break
          </button>
        </div>
        <div className="space-y-2">
          {form.breaks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={b.name} onChange={(e) => set('breaks', form.breaks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="input flex-1" placeholder="Name" />
              <span className="text-xs text-slate-400">after P</span>
              <input type="number" min={1} max={form.periodsPerDay} value={b.after + 1} onChange={(e) => set('breaks', form.breaks.map((x, j) => (j === i ? { ...x, after: Number(e.target.value) - 1 } : x)))} className="input w-16" />
              <input type="number" min={5} max={90} value={b.minutes} onChange={(e) => set('breaks', form.breaks.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)))} className="input w-16" />
              <span className="text-xs text-slate-400">min</span>
              <button onClick={() => set('breaks', form.breaks.filter((_, j) => j !== i))} className="btn-ghost !p-1" aria-label="Remove break"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Reserved periods (assembly, clubs…)</span>
          <button
            onClick={() => set('blocked', [...form.blocked, { day: 0, period: 0, reason: 'Assembly' }])}
            className="btn-ghost text-xs"
            disabled={form.blocked.length >= 20}
          >
            + Reserve
          </button>
        </div>
        <div className="space-y-2">
          {form.blocked.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={b.day} onChange={(e) => set('blocked', form.blocked.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)))} className="input w-24">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].slice(0, form.workingDays).map((d, di) => (
                  <option key={d} value={di}>{d}</option>
                ))}
              </select>
              <select value={b.period} onChange={(e) => set('blocked', form.blocked.map((x, j) => (j === i ? { ...x, period: Number(e.target.value) } : x)))} className="input w-20">
                {Array.from({ length: form.periodsPerDay }, (_, p) => (
                  <option key={p} value={p}>P{p + 1}</option>
                ))}
              </select>
              <input value={b.reason} onChange={(e) => set('blocked', form.blocked.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} className="input flex-1" placeholder="Reason" />
              <button onClick={() => set('blocked', form.blocked.filter((_, j) => j !== i))} className="btn-ghost !p-1" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="label">Holidays (YYYY-MM-DD, comma separated)</span>
        <input
          value={form.holidays.join(', ')}
          onChange={(e) => set('holidays', e.target.value.split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)))}
          className="input mt-1 w-full"
          placeholder="2026-08-15, 2026-10-02"
        />
      </label>

      <div className="flex justify-end border-t border-line pt-4">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
          {save.isPending ? <Spinner /> : 'Save school day'}
        </button>
      </div>
    </div>
  );
}

// ── Curriculum ────────────────────────────────────────────────────────────────
function CurriculumSection() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const data = useQuery({
    queryKey: ['kairos-curriculum'],
    queryFn: async () =>
      (await api.get('/timetable/curriculum')).data as { subjects: KSubject[]; classes: KCurriculumClass[] },
  });
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState<Record<string, { on: boolean; weekly: number; lab: boolean; elective: boolean }>>({});

  const cls = data.data?.classes.find((c) => c.id === (classId || data.data?.classes[0]?.id));

  useEffect(() => {
    if (!cls || !data.data) return;
    const next: typeof rows = {};
    for (const s of data.data.subjects) {
      const plan = cls.plans.find((p) => p.subjectId === s.id);
      next[s.id] = plan
        ? { on: true, weekly: plan.weeklyPeriods, lab: plan.requiresLab, elective: plan.elective }
        : { on: false, weekly: 4, lab: s.requiresLab, elective: false };
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cls?.id, data.data]);

  const save = useMutation({
    mutationFn: async () => {
      const plans = Object.entries(rows)
        .filter(([, r]) => r.on)
        .map(([subjectId, r]) => ({ subjectId, weeklyPeriods: r.weekly, requiresLab: r.lab, elective: r.elective }));
      return (await api.put(`/timetable/curriculum/${cls!.id}`, { plans })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kairos-curriculum'] });
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      pushToast({ title: `Curriculum saved for ${cls?.name}`, body: 'Regenerate the draft to apply it.', severity: 'SUCCESS' });
    },
    onError: (err) => pushToast({ title: 'Could not save', body: apiError(err), severity: 'CRITICAL' }),
  });

  if (!data.data || !cls) return <Spinner />;
  const total = Object.values(rows).filter((r) => r.on).reduce((a, r) => a + r.weekly, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {data.data.classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setClassId(c.id)}
              className={cn('chip', c.id === cls.id ? '!border-brand-500/40 !bg-brand-50 !text-brand-600' : 'surface-hover')}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Badge>{total} periods/week</Badge>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[1fr_92px_64px_64px] items-center gap-2 border-b border-line bg-ink-800/40 px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">
          <span>Subject</span><span>Periods/week</span><span>Lab</span><span>Elective</span>
        </div>
        {data.data.subjects.map((s) => {
          const r = rows[s.id];
          if (!r) return null;
          return (
            <div key={s.id} className={cn('grid grid-cols-[1fr_92px_64px_64px] items-center gap-2 border-b border-line px-3 py-2 last:border-0', !r.on && 'opacity-45')}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={r.on} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, on: e.target.checked } })} className="h-3.5 w-3.5 accent-[#0E7C6B]" />
                <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                <span className="font-medium text-slate-700">{s.name}</span>
              </label>
              <input type="number" min={1} max={12} value={r.weekly} disabled={!r.on} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, weekly: Number(e.target.value) } })} className="input !py-1" />
              <input type="checkbox" checked={r.lab} disabled={!r.on} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, lab: e.target.checked } })} className="h-3.5 w-3.5 accent-[#0E7C6B]" />
              <input type="checkbox" checked={r.elective} disabled={!r.on} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, elective: e.target.checked } })} className="h-3.5 w-3.5 accent-[#0E7C6B]" />
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
          {save.isPending ? <Spinner /> : `Save ${cls.name} curriculum`}
        </button>
      </div>
    </div>
  );
}

// ── Teacher rules ─────────────────────────────────────────────────────────────
function TeachersSection() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const data = useQuery({
    queryKey: ['kairos-constraints'],
    queryFn: async () => (await api.get('/timetable/constraints')).data.teachers as KTeacherConstraint[],
  });
  const [edits, setEdits] = useState<Record<string, Partial<KTeacherConstraint>>>({});

  const save = useMutation({
    mutationFn: async (id: string) => {
      const e = edits[id] ?? {};
      return (await api.put(`/timetable/constraints/${id}`, e)).data;
    },
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['kairos-constraints'] });
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      setEdits((prev) => {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
      pushToast({ title: 'Teacher rules saved', body: 'Regenerate the draft to apply them.', severity: 'SUCCESS' });
    },
    onError: (err) => pushToast({ title: 'Could not save', body: apiError(err), severity: 'CRITICAL' }),
  });

  if (!data.data) return <Spinner />;

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-400">
        Hard limits the engine will never cross: weekly and daily period caps, longest back-to-back run, and part-time status.
      </p>
      {data.data.map((t) => {
        const e = edits[t.id] ?? {};
        const val = { maxWeekly: e.maxWeekly ?? t.maxWeekly, maxDaily: e.maxDaily ?? t.maxDaily, maxConsecutive: e.maxConsecutive ?? t.maxConsecutive, partTime: e.partTime ?? t.partTime };
        const dirty = Object.keys(e).length > 0;
        return (
          <div key={t.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-28 text-sm font-semibold text-slate-800">{t.name}</span>
              <span className="text-[0.65rem] text-slate-400">{t.subjects.join(' · ') || 'No subjects'}</span>
              {val.partTime && <Badge severity="INFO">Part-time</Badge>}
              <span className="ml-auto text-[0.65rem] text-slate-400">{t.currentLoad}/{val.maxWeekly} this week</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-end gap-3 text-xs">
              <label className="block">
                <span className="text-[0.62rem] font-semibold uppercase text-slate-400">Weekly max</span>
                <input type="number" min={1} max={48} value={val.maxWeekly} onChange={(ev) => setEdits({ ...edits, [t.id]: { ...e, maxWeekly: Number(ev.target.value) } })} className="input mt-0.5 w-20 !py-1" />
              </label>
              <label className="block">
                <span className="text-[0.62rem] font-semibold uppercase text-slate-400">Daily max</span>
                <input type="number" min={1} max={10} value={val.maxDaily} onChange={(ev) => setEdits({ ...edits, [t.id]: { ...e, maxDaily: Number(ev.target.value) } })} className="input mt-0.5 w-20 !py-1" />
              </label>
              <label className="block">
                <span className="text-[0.62rem] font-semibold uppercase text-slate-400">In a row</span>
                <input type="number" min={1} max={8} value={val.maxConsecutive} onChange={(ev) => setEdits({ ...edits, [t.id]: { ...e, maxConsecutive: Number(ev.target.value) } })} className="input mt-0.5 w-20 !py-1" />
              </label>
              <label className="flex items-center gap-1.5 pb-1.5">
                <input type="checkbox" checked={val.partTime} onChange={(ev) => setEdits({ ...edits, [t.id]: { ...e, partTime: ev.target.checked } })} className="h-3.5 w-3.5 accent-[#0E7C6B]" />
                <span className="font-medium text-slate-600">Part-time</span>
              </label>
              {dirty && (
                <button onClick={() => save.mutate(t.id)} disabled={save.isPending} className="btn-primary ml-auto !px-3 !py-1.5 text-xs">
                  {save.isPending ? <Spinner /> : 'Save'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

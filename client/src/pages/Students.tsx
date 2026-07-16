import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Plus, GraduationCap, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, EmptyState, LoadingScreen, Spinner } from '@/components/ui';
import { initials } from '@/lib/utils';
import type { StudentRow, ClassRow } from '@/types';

export default function Students() {
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const canEdit = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  const students = useQuery({
    queryKey: ['students', q, classId],
    queryFn: async () => (await api.get('/students', { params: { q: q || undefined, classId: classId || undefined } })).data.students as StudentRow[],
  });

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Students"
        subtitle="One event-sourced roster. Every change is an immutable event you can rewind."
        actions={canEdit && <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="h-4 w-4" /> Add student</button>}
      />

      <Card className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-ink-850/60 px-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-500" />
        </div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input sm:w-48">
          <option value="">All classes</option>
          {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Card>

      {students.isLoading ? (
        <LoadingScreen />
      ) : students.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {students.data.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
              <Link to={`/students/${s.id}`} className="glass glass-hover flex items-center gap-3 p-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-sm font-bold text-ink-950">{initials(s.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{s.name}</div>
                  <div className="text-xs text-slate-500">Roll {s.rollNo} · {s.admissionNo}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge>{s.class?.name ?? '—'}</Badge>
                  {s.bloodGroup && <span className="text-[0.65rem] text-slate-500">{s.bloodGroup}</span>}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<GraduationCap className="h-8 w-8" />} title="No students found" hint="Try a different search or add a new student." />
      )}

      {showAdd && <AddStudentModal classes={classes.data ?? []} onClose={() => setShowAdd(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['students'] }); pushToast({ title: 'Student added', severity: 'SUCCESS' }); }} />}
    </div>
  );
}

function AddStudentModal({ classes, onClose, onDone }: { classes: ClassRow[]; onClose: () => void; onDone: () => void }) {
  const { pushToast } = useUI();
  const [form, setForm] = useState({ name: '', rollNo: '', admissionNo: '', classId: '', bloodGroup: '', gender: 'M' });
  const create = useMutation({
    mutationFn: async () =>
      api.post('/students', {
        name: form.name,
        rollNo: Number(form.rollNo),
        admissionNo: form.admissionNo,
        classId: form.classId || undefined,
        bloodGroup: form.bloodGroup || undefined,
        gender: form.gender,
      }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (e) => pushToast({ title: 'Could not add', body: apiError(e), severity: 'CRITICAL' }),
  });

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Add student</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="label mb-1 block">Full name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label mb-1 block">Roll no</label><input className="input" type="number" value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} /></div>
            <div><label className="label mb-1 block">Admission no</label><input className="input" value={form.admissionNo} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label mb-1 block">Class</label>
              <select className="input" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">Unassigned</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="label mb-1 block">Blood group</label><input className="input" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} /></div>
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!form.name || !form.rollNo || !form.admissionNo || create.isPending} className="btn-primary flex-1">
            {create.isPending ? <Spinner /> : 'Add student'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

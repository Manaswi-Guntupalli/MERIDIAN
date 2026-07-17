import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Plus, GraduationCap, X, ScanFace, ChevronRight } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Badge, EmptyState, LoadingScreen, Spinner } from '@/components/ui';
import { Table, CellIdentity } from '@/components/ui/Table';
import { initials } from '@/lib/utils';
import type { StudentRow, ClassRow } from '@/types';

export default function Students() {
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
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

      {/* Toolbar — a bare control strip, not a card wrapping a card */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-slate-400" strokeWidth={2} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="input pl-9" />
        </div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input sm:w-40">
          <option value="">All classes</option>
          {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-[0.78rem] text-slate-400 sm:ml-auto">
          {students.data?.length ?? 0} student{students.data?.length === 1 ? '' : 's'}
        </span>
      </div>

      {students.isLoading ? (
        <LoadingScreen />
      ) : (
        <Table
          rows={students.data ?? []}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/students/${s.id}`)}
          empty={<EmptyState icon={<GraduationCap className="h-7 w-7" />} title="No students found" hint="Try a different search, or add a new student." />}
          columns={[
            {
              key: 'name',
              header: 'Student',
              cell: (s) => <CellIdentity initials={initials(s.name)} title={s.name} sub={s.admissionNo} />,
            },
            { key: 'roll', header: 'Roll', align: 'right', width: '70px', cell: (s) => <span className="tnum text-slate-500">{s.rollNo}</span> },
            { key: 'class', header: 'Class', width: '90px', cell: (s) => <Badge>{s.class?.name ?? '—'}</Badge> },
            { key: 'blood', header: 'Blood', width: '80px', cell: (s) => <span className="tnum text-slate-500">{s.bloodGroup ?? '—'}</span> },
            {
              key: 'face',
              header: 'Face ID',
              width: '110px',
              cell: (s) =>
                (s as any).faceEnrolled ? (
                  <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-mint-400"><ScanFace className="h-3.5 w-3.5" /> Enrolled</span>
                ) : (
                  <span className="text-[0.75rem] text-slate-300">Not enrolled</span>
                ),
            },
            {
              key: 'go',
              header: '',
              align: 'right',
              width: '44px',
              cell: () => <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />,
            },
          ]}
        />
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
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Add student</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="h-4 w-4" /></button>
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

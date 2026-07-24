import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, Droplet, IdCard, CalendarCheck, ScanFace, CheckCircle2, Nfc } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, Meter } from '@/components/ui';
import FaceEnroll from '@/components/face/FaceEnroll';
import { initials, inr } from '@/lib/utils';

export default function StudentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const user = useAuth((st) => st.user)!;
  const canEnroll = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);
  const [enroll, setEnroll] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: async () => (await api.get(`/students/${id}`)).data.student,
  });

  if (isLoading) return <LoadingScreen />;
  if (!data) return null;
  const s = data;
  const present = s.attendance.filter((a: any) => a.status === 'PRESENT' || a.status === 'LATE').length;
  const rate = s.attendance.length ? Math.round((present / s.attendance.length) * 100) : 0;
  const dues = s.fees.reduce((a: number, f: any) => a + (f.amount - f.paid), 0);

  return (
    <div>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Back to students</Link>
      <PageHeader overline={s.class?.name ?? 'Unassigned'} title={s.name} subtitle={`Admission ${s.admissionNo} · Roll ${s.rollNo}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-xl font-bold text-white">{initials(s.name)}</div>
            <div>
              <div className="text-lg font-bold text-slate-900">{s.name}</div>
              <Badge>{s.class?.name ?? '—'}</Badge>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <Row icon={<IdCard className="h-4 w-4" />} label="Admission" value={s.admissionNo} />
            <Row icon={<Droplet className="h-4 w-4" />} label="Blood group" value={s.bloodGroup ?? '—'} />
            <Row icon={<CalendarCheck className="h-4 w-4" />} label="Admitted" value={new Date(s.createdAt).toLocaleDateString('en-IN')} />
            {s.parents?.map((p: any) => (
              <Row key={p.id} icon={<Phone className="h-4 w-4" />} label={p.parent.relation} value={p.parent.user.name} />
            ))}
          </div>

          {/* Face recognition enrollment */}
          <div className="mt-5 rounded-xl border border-line bg-ink-800/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ScanFace className="h-4 w-4 text-brand-400" /> Face profile</div>
              {s.faceEnrolled ? <Badge severity="SUCCESS"><CheckCircle2 className="h-3 w-3" /> {s.faceCount} embeddings</Badge> : <Badge>Not enrolled</Badge>}
            </div>
            <p className="mt-2 text-xs text-slate-500">On-device 128-D embeddings for face attendance. No image is ever stored.</p>
            {canEnroll && (
              <button onClick={() => setEnroll(true)} className={`${s.faceEnrolled ? 'btn-ghost' : 'btn-primary'} mt-3 w-full !py-2 text-xs`}>
                <ScanFace className="h-3.5 w-3.5" /> {s.faceEnrolled ? 'Re-enroll face' : 'Enroll face'}
              </button>
            )}
          </div>

          {/* Face enrollment */}
          <div className="mt-3 rounded-xl border border-line bg-ink-800/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Nfc className="h-4 w-4 text-brand-400" /> Face enrollment</div>
              {s.faceEnrolled ? <Badge severity="SUCCESS">{s.faceCount ?? 0} template{(s.faceCount ?? 0) === 1 ? '' : 's'}</Badge> : <Badge>Not enrolled</Badge>}
            </div>
            <Link to={`/presence/activity?studentId=${s.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              View attendance history →
            </Link>
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Attendance (last 30 records)</h2>
              <Badge severity={rate >= 90 ? 'SUCCESS' : rate >= 75 ? 'INFO' : 'WARNING'}>{rate}%</Badge>
            </div>
            <Meter value={rate} tone={rate >= 90 ? 'mint' : rate >= 75 ? 'brand' : 'amber'} />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.attendance.slice().reverse().map((a: any) => (
                <span key={a.id} title={`${a.date}: ${a.status}`} className={`h-6 w-6 rounded-md ${a.status === 'PRESENT' ? 'bg-mint-400/70' : a.status === 'LATE' ? 'bg-amber-400/70' : a.status === 'LEAVE' ? 'bg-cyan-400/50' : 'bg-rose-400/70'}`} />
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-slate-900">Fees</h2>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-slate-500">Outstanding</span>
              <span className="font-bold text-slate-900">{inr(dues)}</span>
            </div>
            <div className="space-y-2">
              {s.fees.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-800/60 px-3 py-2.5 text-sm">
                  <div><div className="font-medium text-slate-900">{f.title}</div><div className="text-xs text-slate-500">Due {f.dueDate}</div></div>
                  <div className="text-right"><div className="font-semibold text-slate-900">{inr(f.amount - f.paid)}</div><Badge severity={f.status === 'PAID' ? 'SUCCESS' : f.status === 'OVERDUE' ? 'CRITICAL' : 'WARNING'}>{f.status}</Badge></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {enroll && (
        <FaceEnroll
          subjectType="STUDENT"
          subjectId={s.id}
          name={s.name}
          onClose={() => setEnroll(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['student', id] })}
        />
      )}
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-slate-500">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <span className="ml-auto font-medium text-slate-700">{value}</span>
    </div>
  );
}

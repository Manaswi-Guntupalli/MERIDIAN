import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2, FileText, FileSpreadsheet, LayoutDashboard, ArrowLeft,
  UserCheck, ScanFace, QrCode, ShieldCheck, ClipboardList,
} from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, Spinner, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { AttendanceSessionSummary, ReportStatus } from '@/types';

// Shown after a teacher ends attendance. Everything here is read straight from
// the session data the engine already stored — nothing is recalculated. The
// PDF/Excel buttons stream server-rendered reports built from the same data.

const STATUS_STYLE: Record<ReportStatus, { tone: string; sev: string }> = {
  Present: { tone: 'text-mint-600', sev: 'SUCCESS' },
  Absent: { tone: 'text-slate-500', sev: 'INFO' },
  'Unverified QR': { tone: 'text-amber-600', sev: 'WARNING' },
  'Proxy Attempt': { tone: 'text-rose-600', sev: 'CRITICAL' },
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function downloadBlob(data: Blob, fileName: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceSummary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { pushToast } = useUI();
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

  const q = useQuery({
    queryKey: ['attendance-summary', sessionId],
    queryFn: async () => (await api.get(`/presence/session/${sessionId}/summary`)).data as AttendanceSessionSummary,
    enabled: !!sessionId,
  });

  const download = useMutation({
    mutationFn: async (format: 'pdf' | 'xlsx') => {
      setBusy(format);
      const res = await api.get(`/presence/session/${sessionId}/report.${format}`, { responseType: 'blob' });
      const cd = (res.headers['content-disposition'] as string | undefined) ?? '';
      const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? `attendance-report.${format}`;
      downloadBlob(res.data, name);
    },
    onError: (e) => pushToast({ title: 'Download failed', body: apiError(e), severity: 'CRITICAL' }),
    onSettled: () => setBusy(null),
  });

  if (q.isLoading || !q.data) {
    return <div className="grid h-[60vh] place-items-center text-slate-500"><Spinner /> Loading summary…</div>;
  }
  const s = q.data;

  const stats: { label: string; value: number; dot: string; num: string }[] = [
    { label: 'Students Present', value: s.counts.present, dot: 'bg-mint-500', num: 'text-mint-600' },
    { label: 'Students Absent', value: s.counts.absent, dot: 'bg-slate-400', num: 'text-slate-600' },
    { label: 'Unverified QR', value: s.counts.unverifiedQr, dot: 'bg-amber-500', num: 'text-amber-600' },
    { label: 'Proxy Attempts', value: s.counts.proxy, dot: 'bg-rose-500', num: 'text-rose-600' },
  ];
  const integrity: { label: string; ok: boolean }[] = [
    { label: 'Attendance verified through the state machine', ok: s.integrity.attendanceVerified },
    { label: 'Action written to the audit log', ok: s.integrity.auditLogged },
    { label: 'Session recorded in the event store', ok: s.integrity.eventStored },
    { label: 'Trust Core updated (reversible marks)', ok: s.integrity.trustCoreUpdated },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      {/* ── Completion header ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-6 py-2.5">
            <button onClick={() => navigate('/presence')} className="btn-quiet !px-2 text-xs" title="Back to Sessions">
              <ArrowLeft className="h-3.5 w-3.5" /> Sessions
            </button>
            <span className="ml-auto"><Badge severity="INFO">{s.status}</Badge></span>
          </div>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-mint-400/15">
              <CheckCircle2 className="h-8 w-8 text-mint-500" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Attendance Complete</h1>
            <div className="text-sm font-semibold text-slate-700">
              Grade {s.grade} · Section {s.section}{s.subject ? <> <span className="text-slate-400">•</span> {s.subject}</> : null}
            </div>
            <div className="text-xs text-slate-500">
              {s.teacherName} · {s.date} · {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
              <span className="mx-1.5 text-slate-300">|</span>
              Duration <span className="font-semibold text-slate-700">{fmtDuration(s.durationSeconds)}</span>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ── Attendance summary ── */}
      <section>
        <SectionLabel icon={<ClipboardList className="h-4 w-4" />} title="Attendance Summary" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((st, i) => (
            <motion.div key={st.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', st.dot)} />
                <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">{st.label}</span>
              </div>
              <div className={cn('tnum mt-2 text-4xl font-black', st.num)}>{st.value}</div>
            </motion.div>
          ))}
        </div>
        <div className="mt-2 text-right text-xs text-slate-400">{s.counts.total} students on register</div>
      </section>

      {/* ── Verification methods + Session integrity ── */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <SectionLabel icon={<ScanFace className="h-4 w-4" />} title="Verification Methods" inline />
          <div className="mt-3 space-y-3">
            <MethodRow icon={<UserCheck className="h-4 w-4 text-mint-500" />} label="Face only" value={s.methods.faceOnly} />
            <MethodRow icon={<QrCode className="h-4 w-4 text-brand-500" />} label="QR + Face" value={s.methods.qrAndFace} />
            {s.methods.manual > 0 && (
              <MethodRow icon={<ClipboardList className="h-4 w-4 text-slate-400" />} label="Manual override" value={s.methods.manual} />
            )}
            <div className="border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Average face confidence</span>
                <span className="tnum text-lg font-bold text-slate-900">
                  {s.methods.avgFaceConfidence == null ? '—' : `${Math.round(s.methods.avgFaceConfidence * 100)}%`}
                </span>
              </div>
              {s.methods.avgFaceConfidence != null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full bg-mint-400" style={{ width: `${Math.round(s.methods.avgFaceConfidence * 100)}%` }} />
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <SectionLabel icon={<ShieldCheck className="h-4 w-4" />} title="Session Integrity" inline />
          <div className="mt-3 space-y-2.5">
            {integrity.map((it) => (
              <div key={it.label} className="flex items-center gap-2.5">
                <CheckCircle2 className={cn('h-4 w-4 shrink-0', it.ok ? 'text-mint-500' : 'text-slate-300')} />
                <span className={cn('text-sm', it.ok ? 'text-slate-700' : 'text-slate-400 line-through')}>{it.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-slate-400">
            Each item is a live check against this session's trust artifacts — not a badge.
          </p>
        </Card>
      </div>

      {/* ── Register (compact) ── */}
      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <ClipboardList className="h-4 w-4 text-brand-500" />
          <h2 className="font-bold text-slate-900">Student Register</h2>
          <span className="ml-auto text-xs text-slate-400">{s.students.length} students</span>
        </div>
        {s.students.length ? (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-[0.68rem] uppercase tracking-wide text-slate-400">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 text-left font-semibold">Roll</th>
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Method</th>
                  <th className="px-3 py-2 text-right font-semibold">Conf.</th>
                  <th className="px-5 py-2 text-right font-semibold">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.students.map((st) => {
                  const style = STATUS_STYLE[st.status];
                  return (
                    <tr key={st.rollNo} className="hover:bg-ink-800/30">
                      <td className="px-5 py-2 tnum text-slate-500">{st.rollNo}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{st.name}</td>
                      <td className="px-3 py-2"><Badge severity={style.sev}>{st.status}</Badge></td>
                      <td className="px-3 py-2 text-slate-500">{st.method}</td>
                      <td className={cn('px-3 py-2 text-right tnum', style.tone)}>{st.confidence == null ? '—' : `${Math.round(st.confidence * 100)}%`}</td>
                      <td className="px-5 py-2 text-right tnum text-slate-500">{fmtTime(st.time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5"><EmptyState title="No students on register" hint="This class has no active students enrolled." /></div>
        )}
      </Card>

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
        <button onClick={() => download.mutate('pdf')} disabled={busy !== null} className="btn-primary">
          {busy === 'pdf' ? <Spinner /> : <FileText className="h-4 w-4" />} Download PDF Report
        </button>
        <button onClick={() => download.mutate('xlsx')} disabled={busy !== null} className="btn-ghost">
          {busy === 'xlsx' ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" />} Download Excel Report
        </button>
        <button onClick={() => navigate('/')} className="btn-quiet">
          <LayoutDashboard className="h-4 w-4" /> Return to Dashboard
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ icon, title, inline }: { icon: React.ReactNode; title: string; inline?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 text-slate-900', !inline && 'mb-3')}>
      <span className="text-brand-500">{icon}</span>
      <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
    </div>
  );
}

function MethodRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <span className="flex-1 text-sm text-slate-600">{label}</span>
      <span className="tnum text-lg font-bold text-slate-900">{value}</span>
    </div>
  );
}

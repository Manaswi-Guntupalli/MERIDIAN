import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanFace, Nfc, CheckCircle2, ShieldCheck, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen } from '@/components/ui';
import { initials, timeAgo } from '@/lib/utils';
import type { ClassRow, StudentRow } from '@/types';

interface Tap { name: string; rollNo: number; mode: string; at: string; confidence?: number }

export default function Presence() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'RFID' | 'CV'>('RFID');
  const [classId, setClassId] = useState('');
  const [taps, setTaps] = useState<Tap[]>([]);
  const [scanning, setScanning] = useState(false);

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => (await api.get('/classes')).data.classes as ClassRow[] });
  const activeClass = classId || classes.data?.[0]?.id || '';
  const students = useQuery({
    queryKey: ['students', 'presence', activeClass],
    queryFn: async () => (await api.get('/students', { params: { classId: activeClass } })).data.students as StudentRow[],
    enabled: !!activeClass,
  });

  const kiosk = useMutation({
    mutationFn: async (s: StudentRow) => {
      const confidence = mode === 'CV' ? 0.9 + Math.random() * 0.09 : undefined;
      return (await api.post('/attendance/kiosk', { studentId: s.id, rfidTag: mode === 'RFID' ? s.rfidTag : undefined, mode, confidence })).data;
    },
    onSuccess: (res) => {
      setTaps((t) => [{ name: res.student.name, rollNo: res.student.rollNo, mode, at: new Date().toISOString(), confidence: res.record.confidence }, ...t].slice(0, 12));
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const simulateTap = (s: StudentRow) => {
    setScanning(true);
    setTimeout(() => { kiosk.mutate(s); setScanning(false); }, 700);
  };

  return (
    <div>
      <PageHeader
        overline="Engine 05 · Presence"
        title="Privacy-first automated attendance"
        subtitle="RFID tap or on-device face embedding — attendance flows into the ERP in under a second, with zero raw biometric images ever stored."
        actions={
          <select value={activeClass} onChange={(e) => setClassId(e.target.value)} className="input w-32">
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Kiosk */}
        <Card className="flex flex-col items-center justify-center py-10 text-center">
          <div className="mb-4 inline-flex rounded-xl border border-line p-1">
            {(['RFID', 'CV'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition ${mode === m ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>
                {m === 'RFID' ? <Nfc className="h-4 w-4" /> : <ScanFace className="h-4 w-4" />} {m}
              </button>
            ))}
          </div>

          <div className="relative my-6 grid h-44 w-44 place-items-center">
            <motion.div animate={scanning ? { scale: [1, 1.1, 1], opacity: [0.4, 0.8, 0.4] } : {}} transition={{ repeat: Infinity, duration: 1.2 }} className="absolute inset-0 rounded-full border-2 border-brand-400/40" />
            <motion.div animate={scanning ? { scale: [1, 1.25, 1], opacity: [0.2, 0.5, 0.2] } : {}} transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }} className="absolute inset-0 rounded-full border-2 border-cyan-400/30" />
            <div className="grid h-28 w-28 place-items-center rounded-full bg-brand-600 text-white">
              {mode === 'RFID' ? <Radio className="h-10 w-10" /> : <ScanFace className="h-10 w-10" />}
            </div>
          </div>

          <div className="text-sm font-semibold text-slate-900">{scanning ? `${mode === 'CV' ? 'Matching embedding…' : 'Reading tag…'}` : `Ready — tap a student below`}</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-mint-400"><ShieldCheck className="h-3.5 w-3.5" /> {mode === 'CV' ? 'Raw frame discarded in-memory · only an embedding is used' : 'Tag resolved to enrolled student'}</div>

          <div className="mt-6 flex max-h-40 flex-wrap justify-center gap-1.5 overflow-y-auto no-scrollbar">
            {students.data?.slice(0, 16).map((s) => (
              <button key={s.id} onClick={() => simulateTap(s)} disabled={scanning} className="chip surface-hover hover:!text-slate-900">
                {s.rollNo}. {s.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </Card>

        {/* Live feed */}
        <Card className="!p-0">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <span className="h-2 w-2 animate-pulseGlow rounded-full bg-mint-400" />
            <h2 className="font-bold text-slate-900">Live attendance stream</h2>
          </div>
          <div className="max-h-[26rem] overflow-y-auto no-scrollbar p-3">
            <AnimatePresence initial={false}>
              {taps.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500">Taps will appear here, live across every Pulse surface.</div>
              ) : taps.map((t, i) => (
                <motion.div key={t.at + i} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-ink-800/60 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">{initials(t.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">Roll {t.rollNo} · {timeAgo(t.at)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge severity="SUCCESS"><CheckCircle2 className="h-3 w-3" /> Present</Badge>
                    <span className="text-[0.6rem] text-slate-500">{t.mode}{t.confidence ? ` · ${Math.round(t.confidence * 100)}%` : ''}</span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>
      </div>
    </div>
  );
}

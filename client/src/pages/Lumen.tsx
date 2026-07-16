import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { FileScan, Upload, CheckCircle2, ScanSearch, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, ConfidenceRing, LoadingScreen, Spinner, Meter } from '@/components/ui';
import { cn, confColor } from '@/lib/utils';
import type { DocSummary, ExtractedField } from '@/types';

const TYPES = ['ADMISSION', 'LEAVE', 'MEDICAL', 'FEE_RECEIPT'];

export default function Lumen() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [openId, setOpenId] = useState<string | null>(null);
  const [type, setType] = useState('ADMISSION');

  const docs = useQuery({ queryKey: ['documents'], queryFn: async () => (await api.get('/documents')).data.documents as DocSummary[] });

  const upload = useMutation({
    mutationFn: async () => (await api.post('/documents/upload', { type })).data.document,
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setOpenId(doc.id);
      pushToast({ title: 'Extracted', body: `${doc.fields.length} fields · ${Math.round(doc.overallConfidence * 100)}% confidence`, severity: 'SUCCESS' });
    },
  });

  return (
    <div>
      <PageHeader
        overline="Engine 01 · Lumen"
        title="Document intelligence you can audit"
        subtitle="Upload → verified record. Every value carries a confidence score and a clickable proof crop of the original scan."
      />

      <Card className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <FileScan className="h-5 w-5 text-brand-400" />
          <span className="text-sm text-slate-300">Simulate a scan:</span>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input sm:w-52">
          {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <button onClick={() => upload.mutate()} disabled={upload.isPending} className="btn-primary sm:ml-auto">
          {upload.isPending ? <><Spinner /> Extracting…</> : <><Upload className="h-4 w-4" /> Upload &amp; extract</>}
        </button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-bold text-white">Review queue <span className="text-sm font-normal text-slate-500">(worst-first)</span></h2>
          {docs.isLoading ? <LoadingScreen /> : (
            <div className="space-y-2">
              {docs.data?.map((d) => (
                <button key={d.id} onClick={() => setOpenId(d.id)} className={cn('glass glass-hover flex w-full items-center gap-3 p-3.5 text-left', openId === d.id && '!border-brand-400/40')}>
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5"><ScanSearch className="h-4 w-4 text-slate-400" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{d.fileName}</div>
                    <div className="text-xs text-slate-500">{d.type} · {d.fieldCount} fields</div>
                  </div>
                  {d.needsReview > 0 ? <Badge severity="WARNING">{d.needsReview} review</Badge> : <Badge severity="SUCCESS"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-bold text-white">Review card</h2>
          {openId ? <ReviewCard docId={openId} /> : (
            <Card className="grid place-items-center py-16 text-center text-slate-500">
              <Sparkles className="mb-2 h-6 w-6" />
              Select a document to verify its fields against the original scan.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ docId }: { docId: string }) {
  const qc = useQueryClient();
  const [hover, setHover] = useState<ExtractedField | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['document', docId], queryFn: async () => (await api.get(`/documents/${docId}`)).data.document });

  const confirm = useMutation({
    mutationFn: async (fieldId: string) => api.patch(`/documents/field/${fieldId}`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['document', docId] }); qc.invalidateQueries({ queryKey: ['documents'] }); },
  });

  if (isLoading || !data) return <LoadingScreen />;
  const fields: ExtractedField[] = data.fields;

  return (
    <Card className="!p-0">
      {/* Proof scan with crop overlay */}
      <div className="relative m-4 aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-ink-800 to-ink-850">
        <div className="absolute inset-0 p-4 opacity-40">
          <div className="mb-3 h-3 w-1/2 rounded bg-white/20" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="mb-2.5 flex gap-2">
              <div className="h-2.5 w-24 rounded bg-white/15" />
              <div className="h-2.5 flex-1 rounded bg-white/10" />
            </div>
          ))}
        </div>
        <AnimatePresence>
          {hover && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute rounded-md border-2 border-brand-400 bg-brand-400/15 shadow-glow"
              style={{ left: `${hover.cropX * 100}%`, top: `${hover.cropY * 100}%`, width: `${hover.cropW * 100}%`, height: `${hover.cropH * 100}%` }}
            >
              <span className="absolute -top-5 left-0 rounded bg-brand-500 px-1.5 py-0.5 text-[0.6rem] font-bold text-ink-950">{hover.label}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute bottom-2 right-2 chip !text-[0.6rem]">tap a field ↓ to see its proof crop</div>
      </div>

      <div className="divide-y divide-white/[0.04] px-4 pb-4">
        {fields.map((f) => (
          <div key={f.id} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)} className={cn('flex items-center gap-3 py-3 transition', f.status === 'REVIEW' && 'rounded-lg px-2 -mx-2 bg-amber-400/5')}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500">{f.label}</div>
              <div className="text-sm font-semibold text-white">{f.value}</div>
            </div>
            <span className={cn('text-xs font-bold', confColor(f.confidence))}>{Math.round(f.confidence * 100)}%</span>
            {f.status === 'REVIEW' ? (
              <button onClick={() => confirm.mutate(f.id)} className="btn-ghost !py-1.5 text-xs">Confirm</button>
            ) : (
              <CheckCircle2 className="h-4 w-4 text-mint-400" />
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-white/[0.06] p-4">
        <div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-500">Overall confidence</span><span className="font-bold text-white">{Math.round(data.overallConfidence * 100)}%</span></div>
        <Meter value={data.overallConfidence * 100} tone={data.overallConfidence >= 0.85 ? 'mint' : 'amber'} />
      </div>
    </Card>
  );
}

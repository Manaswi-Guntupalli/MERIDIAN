import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Wallet, Send, IndianRupee } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, StatTile, LoadingScreen, Spinner } from '@/components/ui';
import { inr } from '@/lib/utils';
import type { FeeRow } from '@/types';

export default function Fees() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [filter, setFilter] = useState('');
  const [payFee, setPayFee] = useState<FeeRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fees', filter],
    queryFn: async () => (await api.get('/fees', { params: { status: filter || undefined } })).data as { fees: FeeRow[]; summary: any },
  });

  const remind = useMutation({
    mutationFn: async () => (await api.post('/fees/remind')).data,
    onSuccess: (res) => pushToast({ title: 'Reminders drafted', body: `${res.drafted} guardians notified`, severity: 'SUCCESS' }),
    onError: (e) => pushToast({ title: 'Failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (isLoading) return <LoadingScreen />;
  const sum = data!.summary;

  return (
    <div>
      <PageHeader
        overline="Pulse · ERP"
        title="Fees"
        subtitle="Collections at a glance. Draft reminders in one click — every action lands in the Trust Ledger."
        actions={<button onClick={() => remind.mutate()} className="btn-primary">{remind.isPending ? <Spinner /> : <><Send className="h-4 w-4" /> Draft reminders</>}</button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Total billed" value={inr(sum.total)} icon={<Wallet className="h-4 w-4" />} />
        <StatTile index={1} label="Collected" value={inr(sum.collected)} accent="mint" />
        <StatTile index={2} label="Outstanding" value={inr(sum.outstanding)} accent="amber" />
        <StatTile index={3} label="Accounts due" value={sum.overdue} accent="rose" />
      </div>

      <div className="mb-3 flex gap-2">
        {['', 'PENDING', 'PARTIAL', 'OVERDUE', 'PAID'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip ${filter === f ? '!border-brand-400/40 !bg-brand-500/10 !text-brand-400' : ''}`}>{f || 'All'}</button>
        ))}
      </div>

      <Card className="!p-0">
        <div className="divide-y divide-white/[0.04]">
          {data!.fees.map((f, i) => (
            <motion.div key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.015, 0.3) }} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{f.student} <span className="text-slate-500">· {f.class}</span></div>
                <div className="text-xs text-slate-500">{f.title} · due {f.dueDate}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-white">{inr(f.due)}</div>
                <div className="text-[0.65rem] text-slate-500">of {inr(f.amount)}</div>
              </div>
              <Badge severity={f.status === 'PAID' ? 'SUCCESS' : f.status === 'OVERDUE' ? 'CRITICAL' : f.status === 'PARTIAL' ? 'INFO' : 'WARNING'}>{f.status}</Badge>
              {f.status !== 'PAID' && <button onClick={() => setPayFee(f)} className="btn-ghost !py-1.5 text-xs">Record</button>}
            </motion.div>
          ))}
        </div>
      </Card>

      {payFee && <PayModal fee={payFee} onClose={() => setPayFee(null)} onDone={() => { qc.invalidateQueries({ queryKey: ['fees'] }); pushToast({ title: 'Payment recorded', severity: 'SUCCESS' }); }} />}
    </div>
  );
}

function PayModal({ fee, onClose, onDone }: { fee: FeeRow; onClose: () => void; onDone: () => void }) {
  const { pushToast } = useUI();
  const [amount, setAmount] = useState(fee.due);
  const pay = useMutation({
    mutationFn: async () => api.post('/fees/pay', { feeId: fee.id, amount, method: 'CASH' }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (e) => pushToast({ title: 'Failed', body: apiError(e), severity: 'CRITICAL' }),
  });
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-white">Record payment</h2>
        <p className="mt-1 text-sm text-slate-400">{fee.student} · {fee.title}</p>
        <div className="mt-4">
          <label className="label mb-1 block">Amount (max {inr(fee.due)})</label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-850/60 px-3">
            <IndianRupee className="h-4 w-4 text-slate-500" />
            <input type="number" value={amount} max={fee.due} onChange={(e) => setAmount(Number(e.target.value))} className="w-full bg-transparent py-2.5 text-sm outline-none" />
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={() => pay.mutate()} disabled={amount <= 0 || amount > fee.due || pay.isPending} className="btn-primary flex-1">{pay.isPending ? <Spinner /> : 'Confirm'}</button>
        </div>
      </motion.div>
    </div>
  );
}

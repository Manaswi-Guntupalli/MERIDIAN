import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Wallet, Send, IndianRupee } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, StatTile, LoadingScreen, Spinner, EmptyState } from '@/components/ui';
import { Table, CellIdentity } from '@/components/ui/Table';
import { inr, initials, cn } from '@/lib/utils';
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

      {/* Segmented filter — one control, not five loose chips */}
      <div className="mb-4 inline-flex rounded-[9px] border border-line bg-surface p-0.5 shadow-xs">
        {['', 'PENDING', 'PARTIAL', 'OVERDUE', 'PAID'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-[7px] px-3 py-1.5 text-[0.76rem] font-semibold capitalize transition-colors',
              filter === f ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {f ? f.toLowerCase() : 'All'}
          </button>
        ))}
      </div>

      <Table
        rows={data!.fees}
        rowKey={(f) => f.id}
        empty={<EmptyState icon={<Wallet className="h-7 w-7" />} title="Nothing to collect" hint="No fee records match this filter." />}
        columns={[
          {
            key: 'student',
            header: 'Student',
            cell: (f) => <CellIdentity initials={initials(f.student)} title={f.student} sub={f.class} />,
          },
          { key: 'title', header: 'Fee', cell: (f) => <span className="text-slate-600">{f.title}</span> },
          { key: 'due', header: 'Due date', cell: (f) => <span className="tnum text-slate-500">{f.dueDate}</span> },
          {
            key: 'progress',
            header: 'Collected',
            width: '150px',
            cell: (f) => {
              const p = f.amount ? Math.round((f.paid / f.amount) * 100) : 0;
              return (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
                    <div className={cn('h-full rounded-full', p >= 100 ? 'bg-mint-400' : p > 0 ? 'bg-brand-500' : 'bg-ink-600')} style={{ width: `${p}%` }} />
                  </div>
                  <span className="tnum text-[0.72rem] text-slate-400">{p}%</span>
                </div>
              );
            },
          },
          {
            key: 'amount',
            header: 'Outstanding',
            align: 'right',
            cell: (f) => (
              <div>
                <div className="tnum font-semibold text-slate-900">{inr(f.due)}</div>
                <div className="tnum text-[0.68rem] text-slate-400">of {inr(f.amount)}</div>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            cell: (f) => (
              <Badge severity={f.status === 'PAID' ? 'SUCCESS' : f.status === 'OVERDUE' ? 'CRITICAL' : f.status === 'PARTIAL' ? 'INFO' : 'WARNING'}>
                {f.status.toLowerCase()}
              </Badge>
            ),
          },
          {
            key: 'action',
            header: '',
            align: 'right',
            width: '96px',
            cell: (f) =>
              f.status !== 'PAID' ? (
                <button onClick={(e) => { e.stopPropagation(); setPayFee(f); }} className="btn-ghost !px-2.5 !py-1 text-[0.72rem]">
                  Record
                </button>
              ) : (
                <span className="text-[0.72rem] text-slate-300">—</span>
              ),
          },
        ]}
      />

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
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">Record payment</h2>
        <p className="mt-1 text-sm text-slate-500">{fee.student} · {fee.title}</p>
        <div className="mt-4">
          <label className="label mb-1 block">Amount (max {inr(fee.due)})</label>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-ink-850/60 px-3">
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

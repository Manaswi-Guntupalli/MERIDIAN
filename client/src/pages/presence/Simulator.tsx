import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, Shuffle, Zap, ShieldQuestion, Copy, WifiOff, AlertTriangle, Ban, Clock, LogOut, Nfc } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, EmptyState } from '@/components/ui';
import { useRfidReader } from '@/hooks/useRfidReader';
import { timeAgo, initials, cn } from '@/lib/utils';
import type { RFIDCardRow, RFIDReaderRow, ScanResult } from '@/types';
import { EVENT_BADGE, directionLabel } from './shared';

interface FeedItem {
  key: string;
  label: string;
  results: ScanResult[];
  at: string;
}

export default function PresenceSimulator() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [readerId, setReaderId] = useState('');
  const [cardUid, setCardUid] = useState('');
  const [cardId, setCardId] = useState('');
  const [burstCount, setBurstCount] = useState(8);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const readers = useQuery({ queryKey: ['presence-readers'], queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[] });
  const cards = useQuery({ queryKey: ['presence-cards', 'ACTIVE'], queryFn: async () => (await api.get('/presence/cards', { params: { status: 'ACTIVE' } })).data.cards as RFIDCardRow[] });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['presence-events'] });
    qc.invalidateQueries({ queryKey: ['presence-analytics'] });
    qc.invalidateQueries({ queryKey: ['presence-readers'] });
    qc.invalidateQueries({ queryKey: ['presence-cards'] });
  };

  const push = (label: string, results: ScanResult | ScanResult[]) => {
    const arr = Array.isArray(results) ? results : [results];
    setFeed((f) => [{ key: `${Date.now()}-${Math.random()}`, label, results: arr, at: new Date().toISOString() }, ...f].slice(0, 30));
    refresh();
  };

  const run = useMutation({
    mutationFn: async (args: { path: string; label: string; body?: Record<string, unknown> }) => {
      const res = await api.post(`/presence/simulate/${args.path}`, args.body ?? {});
      return { label: args.label, data: res.data };
    },
    onSuccess: ({ label, data }) => {
      if (data.results) push(label, data.results);
      else if (data.first) push(label, [data.first, data.second]);
      else push(label, data);
    },
    onError: (e) => pushToast({ title: 'Simulation failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  const rfid = useRfidReader((tag) => setCardUid(tag));

  const requireReaderCard = () => !!readerId && !!cardUid;

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900"><Nfc className="h-4 w-4 text-brand-400" /> Reader &amp; card selection</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Reader</span>
            <select value={readerId} onChange={(e) => setReaderId(e.target.value)} className="input w-full">
              <option value="">Select a reader…</option>
              {readers.data?.map((r) => <option key={r.id} value={r.id}>{r.name} {r.online ? '' : '(offline)'}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Card</span>
            <select
              value={cardUid}
              onChange={(e) => {
                setCardUid(e.target.value);
                setCardId(cards.data?.find((c) => c.uid === e.target.value)?.id ?? '');
              }}
              className="input w-full"
            >
              <option value="">Select a card…</option>
              {cards.data?.map((c) => <option key={c.id} value={c.uid}>{c.uid} · {c.student?.name}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
          <input ref={rfid.inputRef} onKeyDown={rfid.handleKeyDown} className="sr-only" aria-hidden />
          <button
            type="button"
            onClick={() => rfid.setArmed((a) => !a)}
            className={cn('btn-ghost !py-1.5 text-xs', rfid.armed && 'bg-brand-50 text-brand-700')}
          >
            <Radio className="h-3.5 w-3.5" /> {rfid.armed ? 'Listening for a physical reader…' : 'Use a connected USB/serial reader'}
          </button>
          <span className="text-xs text-slate-500">Scan a real tag to fill the Card field above — useful for demoing with actual hardware.</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <ActionButton icon={<Radio className="h-4 w-4" />} label="Scan" disabled={!requireReaderCard()} onClick={() => run.mutate({ path: 'scan', label: 'Scan', body: { readerId, cardUid } })} />
          <ActionButton icon={<Shuffle className="h-4 w-4" />} label="Random scan" onClick={() => run.mutate({ path: 'random', label: 'Random scan' })} />
          <ActionButton icon={<LogOut className="h-4 w-4" />} label="Exit scan" disabled={!requireReaderCard()} onClick={() => run.mutate({ path: 'exit', label: 'Exit scan', body: { readerId, cardUid } })} />
          <ActionButton icon={<ShieldQuestion className="h-4 w-4" />} label="Unknown card" onClick={() => run.mutate({ path: 'unknown-card', label: 'Unknown card', body: readerId ? { readerId } : {} })} />
          <ActionButton icon={<Copy className="h-4 w-4" />} label="Duplicate scan" onClick={() => run.mutate({ path: 'duplicate', label: 'Duplicate scan', body: { readerId: readerId || undefined, cardUid: cardUid || undefined } })} />
          <ActionButton icon={<WifiOff className="h-4 w-4" />} label="Offline reader" disabled={!readerId} onClick={() => run.mutate({ path: 'offline-reader', label: 'Offline reader', body: { readerId } })} />
          <ActionButton icon={<AlertTriangle className="h-4 w-4" />} label="Lost card" disabled={!cardId} onClick={() => run.mutate({ path: 'lost-card', label: 'Lost card', body: { cardId, readerId: readerId || undefined } })} />
          <ActionButton icon={<Ban className="h-4 w-4" />} label="Disabled card" disabled={!cardId} onClick={() => run.mutate({ path: 'disabled-card', label: 'Disabled card', body: { cardId, readerId: readerId || undefined } })} />
          <ActionButton icon={<Clock className="h-4 w-4" />} label="Late arrival" onClick={() => run.mutate({ path: 'late', label: 'Late arrival', body: { readerId: readerId || undefined, cardUid: cardUid || undefined } })} />
          <div className="col-span-2 flex items-center gap-2 rounded-xl border border-line px-3 py-2 sm:col-span-1">
            <input type="number" min={1} max={30} value={burstCount} onChange={(e) => setBurstCount(Number(e.target.value))} className="input w-14 !py-1.5 text-center" />
            <button onClick={() => run.mutate({ path: 'burst', label: 'Burst mode', body: { readerId: readerId || undefined, count: burstCount } })} className="btn-ghost flex-1 !py-1.5 text-xs">
              <Zap className="h-3.5 w-3.5" /> Burst
            </button>
          </div>
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="h-2 w-2 animate-pulseGlow rounded-full bg-mint-400" />
          <h2 className="font-bold text-slate-900">Simulation results</h2>
        </div>
        <div className="max-h-[28rem] overflow-y-auto no-scrollbar p-3">
          <AnimatePresence initial={false}>
            {feed.length === 0 ? (
              <EmptyState title="No simulated scans yet" hint="Every button here calls the exact same engine a real reader would." />
            ) : (
              feed.map((f) => (
                <motion.div key={f.key} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="mb-2 rounded-xl border border-line bg-ink-800/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{f.label}</span>
                    <span className="text-[0.65rem] text-slate-500">{timeAgo(f.at)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {f.results.map((r, i) => {
                      const badge = EVENT_BADGE[r.status];
                      return (
                        <div key={r.eventId ?? i} className="flex items-center gap-2.5">
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-[0.65rem] font-bold text-white">
                            {r.student ? initials(r.student.name) : '?'}
                          </div>
                          <div className="min-w-0 flex-1 text-sm text-slate-800">
                            {r.student?.name ?? 'Unknown card'} <span className="text-xs text-slate-500">{directionLabel(r.direction)}</span>
                          </div>
                          {r.reason && <span className="hidden max-w-[10rem] truncate text-xs text-slate-500 sm:inline">{r.reason}</span>}
                          <Badge severity={badge.severity}>{badge.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-ghost flex-col gap-1 !py-3 text-xs disabled:cursor-not-allowed disabled:opacity-40">
      {icon}
      {label}
    </button>
  );
}

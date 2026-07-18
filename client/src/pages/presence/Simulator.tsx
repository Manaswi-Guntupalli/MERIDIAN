import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, Shuffle, Zap, ShieldQuestion, Copy, WifiOff, AlertTriangle, Ban, Clock, LogIn, LogOut, Nfc, HeartPulse } from 'lucide-react';
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

// Real gate hardware heartbeats every few seconds; while this page keeps the
// interval comfortably inside the 90s default offline threshold, demo readers
// behave exactly like healthy physical ones.
const HEARTBEAT_INTERVAL_MS = 45_000;

export default function PresenceSimulator() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [readerId, setReaderId] = useState('');
  const [cardUid, setCardUid] = useState('');
  const [cardId, setCardId] = useState('');
  const [burstCount, setBurstCount] = useState(8);
  const [keepOnline, setKeepOnline] = useState(true);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const readers = useQuery({ queryKey: ['presence-readers'], queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[], refetchInterval: 20_000 });
  const cards = useQuery({ queryKey: ['presence-cards', 'ACTIVE'], queryFn: async () => (await api.get('/presence/cards', { params: { status: 'ACTIVE' } })).data.cards as RFIDCardRow[] });

  // Pre-select the first gate and card so every button works immediately.
  useEffect(() => {
    if (!readerId && readers.data?.length) setReaderId(readers.data[0].id);
  }, [readers.data, readerId]);
  useEffect(() => {
    if (!cardUid && cards.data?.length) {
      setCardUid(cards.data[0].uid);
      setCardId(cards.data[0].id);
    }
  }, [cards.data, cardUid]);

  useEffect(() => {
    if (!keepOnline) return;
    const beat = () => api.post('/presence/simulate/go-online').then(() => qc.invalidateQueries({ queryKey: ['presence-readers'] })).catch(() => {});
    beat();
    const t = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(t);
  }, [keepOnline, qc]);

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

  const forceOnline = useMutation({
    mutationFn: async (id: string) => api.post(`/presence/readers/${id}/force-status`, { online: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presence-readers'] }),
  });

  const rfid = useRfidReader((tag) => setCardUid(tag));

  const ready = !!readerId && !!cardUid;
  const selectedReader = readers.data?.find((r) => r.id === readerId);
  const selectedCard = cards.data?.find((c) => c.uid === cardUid);
  const onlineCount = readers.data?.filter((r) => r.online).length ?? 0;
  const totalReaders = readers.data?.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Step 1 — virtual hardware keeps demo readers heartbeating */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600"><HeartPulse className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              Virtual gate hardware
              <Badge severity={onlineCount === totalReaders && totalReaders > 0 ? 'SUCCESS' : 'WARNING'}>{onlineCount}/{totalReaders} readers online</Badge>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Real readers send a heartbeat every few seconds — go silent and they drop Offline, and the engine rejects their scans.
              While this switch is on, the Simulator sends those heartbeats for every reader, exactly like healthy hardware.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={keepOnline}
            onClick={() => setKeepOnline((v) => !v)}
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', keepOnline ? 'bg-mint-500' : 'bg-ink-800 border border-line')}
            title={keepOnline ? 'Virtual hardware on — readers stay online' : 'Virtual hardware off — readers will drop offline'}
          >
            <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', keepOnline ? 'left-[1.375rem]' : 'left-0.5')} />
          </button>
        </div>
      </Card>

      {/* Step 2 — pick the gate and the student card */}
      <Card>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900"><Nfc className="h-4 w-4 text-brand-400" /> Choose a gate and a student card</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Gate (reader)</span>
            <select value={readerId} onChange={(e) => setReaderId(e.target.value)} className="input w-full">
              <option value="">Select a reader…</option>
              {readers.data?.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.location}{r.online ? '' : ' (offline)'}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Student card</span>
            <select
              value={cardUid}
              onChange={(e) => {
                setCardUid(e.target.value);
                setCardId(cards.data?.find((c) => c.uid === e.target.value)?.id ?? '');
              }}
              className="input w-full"
            >
              <option value="">Select a card…</option>
              {cards.data?.map((c) => <option key={c.id} value={c.uid}>{c.student?.name} · {c.uid}</option>)}
            </select>
          </label>
        </div>

        {selectedReader && !selectedReader.online && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-700">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1"><b>{selectedReader.name}</b> is offline — every scan at it will be rejected.</span>
            <button onClick={() => forceOnline.mutate(selectedReader.id)} disabled={forceOnline.isPending} className="btn-ghost !py-1 text-xs">Bring it online</button>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
          <input ref={rfid.inputRef} onKeyDown={rfid.handleKeyDown} className="sr-only" aria-hidden />
          <button
            type="button"
            onClick={() => rfid.setArmed((a) => !a)}
            className={cn('btn-ghost !py-1.5 text-xs', rfid.armed && 'bg-brand-50 text-brand-700')}
          >
            <Radio className="h-3.5 w-3.5" /> {rfid.armed ? 'Listening for a physical reader…' : 'Use a connected USB/serial reader'}
          </button>
          <span className="text-xs text-slate-500">Optional: scan a real tag to fill the Card field — for demoing with actual hardware.</span>
        </div>
      </Card>

      {/* Step 3 — scenarios, grouped and explained */}
      <Card>
        <div className="mb-1 text-sm font-semibold text-slate-900">Run a scenario</div>
        <p className="mb-4 text-xs text-slate-500">Every button calls the exact engine a physical reader would — nothing here is faked.</p>

        <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Everyday flow</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Scenario
            icon={<LogIn className="h-4 w-4 text-mint-500" />}
            title="Entry scan"
            desc={ready ? `${selectedCard?.student?.name ?? 'Student'} taps in — marked present, parents notified.` : 'Select a gate and a card above first.'}
            disabled={!ready}
            onClick={() => run.mutate({ path: 'scan', label: 'Entry scan', body: { readerId, cardUid } })}
          />
          <Scenario
            icon={<LogOut className="h-4 w-4 text-cyan-500" />}
            title="Exit scan"
            desc={ready ? 'Same student taps out — logged as an exit, the day stays marked.' : 'Select a gate and a card above first.'}
            disabled={!ready}
            onClick={() => run.mutate({ path: 'exit', label: 'Exit scan', body: { readerId, cardUid } })}
          />
          <Scenario
            icon={<Shuffle className="h-4 w-4 text-brand-500" />}
            title="Random student"
            desc="Any active card taps at an online gate — good for filling the feed."
            onClick={() => run.mutate({ path: 'random', label: 'Random student' })}
          />
          <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
            <Zap className="h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800">Morning rush</div>
              <div className="text-[0.7rem] leading-snug text-slate-500">Several students tap in back-to-back.</div>
            </div>
            <input type="number" min={1} max={30} value={burstCount} onChange={(e) => setBurstCount(Number(e.target.value))} className="input w-14 !py-1.5 text-center" />
            <button onClick={() => run.mutate({ path: 'burst', label: 'Morning rush', body: { readerId: readerId || undefined, count: burstCount } })} className="btn-ghost !py-1.5 text-xs">Run</button>
          </div>
        </div>

        <div className="mb-2 mt-5 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Edge cases the engine must catch</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Scenario
            icon={<Clock className="h-4 w-4 text-amber-500" />}
            title="Late arrival"
            desc="A tap after school start + grace — auto-classified LATE with minutes late."
            onClick={() => run.mutate({ path: 'late', label: 'Late arrival', body: { readerId: readerId || undefined, cardUid: cardUid || undefined } })}
          />
          <Scenario
            icon={<Copy className="h-4 w-4 text-slate-500" />}
            title="Duplicate tap"
            desc="Same card twice in a row — the second is logged but never double-counted."
            onClick={() => run.mutate({ path: 'duplicate', label: 'Duplicate tap', body: { readerId: readerId || undefined, cardUid: cardUid || undefined } })}
          />
          <Scenario
            icon={<ShieldQuestion className="h-4 w-4 text-rose-500" />}
            title="Unknown card"
            desc="A UID nobody issued — creates a security review for admins, not attendance."
            onClick={() => run.mutate({ path: 'unknown-card', label: 'Unknown card', body: readerId ? { readerId } : {} })}
          />
          <Scenario
            icon={<WifiOff className="h-4 w-4 text-rose-500" />}
            title="Offline reader"
            desc="Forces the selected gate offline, then scans — rejected. Virtual hardware revives it on its next heartbeat."
            disabled={!readerId}
            onClick={() => run.mutate({ path: 'offline-reader', label: 'Offline reader', body: { readerId } })}
          />
          <Scenario
            icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
            title="Lost card"
            desc="Marks the selected card LOST, then scans it — rejected. Reissue it under Manage → Cards."
            disabled={!cardId}
            onClick={() => run.mutate({ path: 'lost-card', label: 'Lost card', body: { cardId, readerId: readerId || undefined } })}
          />
          <Scenario
            icon={<Ban className="h-4 w-4 text-slate-500" />}
            title="Disabled card"
            desc="Disables the selected card, then scans it — rejected. Re-enable under Manage → Cards."
            disabled={!cardId}
            onClick={() => run.mutate({ path: 'disabled-card', label: 'Disabled card', body: { cardId, readerId: readerId || undefined } })}
          />
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="h-2 w-2 animate-pulseGlow rounded-full bg-mint-400" />
          <h2 className="font-bold text-slate-900">What happened</h2>
          <span className="ml-auto text-xs text-slate-500">The same events appear in Overview, Activity, dashboards and parent notifications.</span>
        </div>
        <div className="max-h-[28rem] overflow-y-auto no-scrollbar p-3">
          <AnimatePresence initial={false}>
            {feed.length === 0 ? (
              <EmptyState title="No simulated scans yet" hint="Start with an Entry scan — the result lands here instantly." />
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
                          {r.reason && <span className="hidden max-w-[12rem] truncate text-xs text-slate-500 sm:inline">{r.reason}</span>}
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

function Scenario({ icon, title, desc, onClick, disabled }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left transition hover:border-brand-400/50 hover:bg-ink-800/40 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-800">{title}</span>
        <span className="block text-[0.7rem] leading-snug text-slate-500">{desc}</span>
      </span>
    </button>
  );
}

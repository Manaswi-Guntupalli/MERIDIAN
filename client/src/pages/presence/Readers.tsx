import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, KeyRound, Trash2, Radio, Copy, Check } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { timeAgo, cn } from '@/lib/utils';
import type { RFIDReaderRow, ReaderDirection } from '@/types';
import { Modal } from './shared';

export default function PresenceReaders() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [showCreate, setShowCreate] = useState(false);
  const [revealKey, setRevealKey] = useState<{ name: string; apiKey: string } | null>(null);

  const readers = useQuery({
    queryKey: ['presence-readers'],
    queryFn: async () => (await api.get('/presence/readers')).data.readers as RFIDReaderRow[],
    refetchInterval: 20_000,
  });

  const create = useMutation({
    mutationFn: async (body: { name: string; location: string; building?: string; direction: ReaderDirection }) => (await api.post('/presence/readers', body)).data,
    onSuccess: (res) => {
      setShowCreate(false);
      setRevealKey({ name: res.reader.name, apiKey: res.apiKey });
      qc.invalidateQueries({ queryKey: ['presence-readers'] });
    },
    onError: (e) => pushToast({ title: 'Could not create reader', body: apiError(e), severity: 'CRITICAL' }),
  });

  const rotate = useMutation({
    mutationFn: async (id: string) => (await api.post(`/presence/readers/${id}/rotate-key`)).data,
    onSuccess: (res) => {
      setRevealKey({ name: res.reader.name, apiKey: res.apiKey });
      qc.invalidateQueries({ queryKey: ['presence-readers'] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/presence/readers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presence-readers'] }),
    onError: (e) => pushToast({ title: 'Could not delete reader', body: apiError(e), severity: 'CRITICAL' }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Physical gate hardware — a real reader authenticates against the same key issued here and POSTs to the same ingest endpoint as the Simulator.</p>
        <button onClick={() => setShowCreate(true)} className="btn-primary shrink-0 !py-2 text-xs"><Plus className="h-3.5 w-3.5" /> Add reader</button>
      </div>

      {readers.isLoading ? (
        <LoadingScreen />
      ) : readers.data?.length ? (
        <div className="grid gap-2">
          {readers.data.map((r) => (
            <Card key={r.id} className="flex items-center gap-4 !py-3.5">
              <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', r.online ? 'bg-mint-400/10 text-mint-500' : 'bg-rose-400/10 text-rose-500')}>
                <Radio className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{r.name}</span>
                  <Badge>{r.direction}</Badge>
                </div>
                <div className="truncate text-xs text-slate-500">{r.location}{r.building ? ` · ${r.building}` : ''} · fw {r.firmwareVersion ?? '—'}</div>
              </div>
              <div className="flex flex-col items-end gap-1 text-xs text-slate-500">
                <Badge severity={r.online ? 'SUCCESS' : 'CRITICAL'}>{r.online ? 'Online' : 'Offline'}</Badge>
                <span>{r.lastHeartbeat ? `seen ${timeAgo(r.lastHeartbeat)}` : 'never seen'}</span>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button onClick={() => rotate.mutate(r.id)} className="btn-ghost !p-2" title="Rotate device key"><KeyRound className="h-3.5 w-3.5" /></button>
                <button
                  onClick={() => window.confirm(`Delete reader "${r.name}"? Any device using its key will stop working.`) && remove.mutate(r.id)}
                  className="btn-ghost !p-2 text-rose-500"
                  title="Delete reader"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No readers configured" hint="Add your first gate reader to start accepting scans." />
      )}

      {showCreate && <CreateReaderModal onClose={() => setShowCreate(false)} onSubmit={(body) => create.mutate(body)} pending={create.isPending} />}
      {revealKey && <RevealKeyModal name={revealKey.name} apiKey={revealKey.apiKey} onClose={() => setRevealKey(null)} />}
    </div>
  );
}

function CreateReaderModal({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (b: { name: string; location: string; building?: string; direction: ReaderDirection }) => void; pending: boolean }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [building, setBuilding] = useState('');
  const [direction, setDirection] = useState<ReaderDirection>('BOTH');

  return (
    <Modal title="Add RFID reader" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name, location, building: building || undefined, direction });
        }}
        className="space-y-3"
      >
        <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="Main Gate Reader" /></Field>
        <Field label="Location"><input required value={location} onChange={(e) => setLocation(e.target.value)} className="input w-full" placeholder="Main Gate" /></Field>
        <Field label="Building (optional)"><input value={building} onChange={(e) => setBuilding(e.target.value)} className="input w-full" placeholder="Admin & Hall" /></Field>
        <Field label="Direction">
          <select value={direction} onChange={(e) => setDirection(e.target.value as ReaderDirection)} className="input w-full">
            <option value="BOTH">Both (entry + exit)</option>
            <option value="ENTRY">Entry only</option>
            <option value="EXIT">Exit only</option>
          </select>
        </Field>
        <button type="submit" disabled={pending} className="btn-primary w-full !py-2.5">{pending ? 'Creating…' : 'Create reader'}</button>
      </form>
    </Modal>
  );
}

function RevealKeyModal({ name, apiKey, onClose }: { name: string; apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={`Device key for ${name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">This key authenticates the physical reader (or a hardware simulator) against <code className="rounded bg-ink-800 px-1 py-0.5 text-xs">POST /api/presence/readers/:id/heartbeat</code> and <code className="rounded bg-ink-800 px-1 py-0.5 text-xs">POST /api/presence/scan</code> via the <code className="rounded bg-ink-800 px-1 py-0.5 text-xs">x-reader-key</code> header. Shown once — copy it now.</p>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-ink-800/60 p-3">
        <code className="flex-1 truncate text-xs text-slate-800">{apiKey}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(apiKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="btn-ghost !p-2"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-mint-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <button onClick={onClose} className="btn-primary mt-4 w-full !py-2.5">Done</button>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

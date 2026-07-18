import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat, Ban, AlertTriangle, Wrench, RotateCcw, History as HistoryIcon, Search } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { RFIDCardRow } from '@/types';
import { Modal, CARD_BADGE, StudentPicker } from './shared';

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'DISABLED', 'LOST', 'BROKEN', 'REPLACED'] as const;

export default function PresenceCards() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [q, setQ] = useState('');
  const [showIssue, setShowIssue] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<RFIDCardRow | null>(null);
  const [historyStudentId, setHistoryStudentId] = useState<string | null>(null);

  const cards = useQuery({
    queryKey: ['presence-cards', status],
    queryFn: async () => (await api.get('/presence/cards', { params: status === 'ALL' ? {} : { status } })).data.cards as RFIDCardRow[],
  });

  const filtered = useMemo(() => {
    if (!cards.data) return [];
    if (!q.trim()) return cards.data;
    const needle = q.trim().toLowerCase();
    return cards.data.filter((c) => c.uid.toLowerCase().includes(needle) || c.student?.name.toLowerCase().includes(needle));
  }, [cards.data, q]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['presence-cards'] });
  const onError = (e: unknown, label: string) => pushToast({ title: label, body: apiError(e), severity: 'CRITICAL' });

  const issue = useMutation({
    mutationFn: async (body: { studentId: string; uid: string }) => (await api.post('/presence/cards', body)).data,
    onSuccess: () => { setShowIssue(false); invalidate(); pushToast({ title: 'Card issued', body: 'Active immediately.', severity: 'SUCCESS' }); },
    onError: (e) => onError(e, 'Could not issue card'),
  });
  const replace = useMutation({
    mutationFn: async ({ id, newUid }: { id: string; newUid: string }) => (await api.post(`/presence/cards/${id}/replace`, { newUid })).data,
    onSuccess: () => { setReplaceTarget(null); invalidate(); pushToast({ title: 'Card replaced', body: 'Old card retired, new card active.', severity: 'SUCCESS' }); },
    onError: (e) => onError(e, 'Could not replace card'),
  });
  const disable = useMutation({ mutationFn: async (id: string) => api.post(`/presence/cards/${id}/disable`), onSuccess: invalidate, onError: (e) => onError(e, 'Could not disable card') });
  const lost = useMutation({ mutationFn: async (id: string) => api.post(`/presence/cards/${id}/lost`), onSuccess: invalidate, onError: (e) => onError(e, 'Could not report card lost') });
  const broken = useMutation({ mutationFn: async (id: string) => api.post(`/presence/cards/${id}/broken`), onSuccess: invalidate, onError: (e) => onError(e, 'Could not report card broken') });
  const reissue = useMutation({ mutationFn: async (id: string) => api.post(`/presence/cards/${id}/reissue`), onSuccess: invalidate, onError: (e) => onError(e, 'Could not reissue card') });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search UID or student…" className="input w-56 pl-8" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input w-36">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>)}
        </select>
        <button onClick={() => setShowIssue(true)} className="btn-primary ml-auto shrink-0 !py-2 text-xs"><Plus className="h-3.5 w-3.5" /> Issue card</button>
      </div>

      {cards.isLoading ? (
        <LoadingScreen />
      ) : filtered.length ? (
        <div className="grid gap-2">
          {filtered.map((c) => {
            const badge = CARD_BADGE[c.status];
            return (
              <Card key={c.id} className="flex flex-wrap items-center gap-3 !py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-semibold text-slate-900">{c.uid}</code>
                    <Badge severity={badge.severity}>{badge.label}</Badge>
                  </div>
                  <div className="truncate text-xs text-slate-500">{c.student ? `${c.student.name} · Roll ${c.student.rollNo}` : c.studentId}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button onClick={() => setHistoryStudentId(c.studentId)} className="btn-ghost !p-2" title="Card history"><HistoryIcon className="h-3.5 w-3.5" /></button>
                  {c.status === 'ACTIVE' && (
                    <>
                      <button onClick={() => setReplaceTarget(c)} className="btn-ghost !p-2" title="Replace"><Repeat className="h-3.5 w-3.5" /></button>
                      <button onClick={() => lost.mutate(c.id)} className="btn-ghost !p-2 text-amber-500" title="Report lost"><AlertTriangle className="h-3.5 w-3.5" /></button>
                      <button onClick={() => broken.mutate(c.id)} className="btn-ghost !p-2 text-amber-500" title="Report broken"><Wrench className="h-3.5 w-3.5" /></button>
                      <button onClick={() => disable.mutate(c.id)} className="btn-ghost !p-2 text-rose-500" title="Disable"><Ban className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                  {(c.status === 'DISABLED' || c.status === 'LOST' || c.status === 'BROKEN') && (
                    <button onClick={() => reissue.mutate(c.id)} className="btn-ghost !p-2 text-mint-500" title="Reissue"><RotateCcw className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No cards found" hint="Issue a card to a student to get started." />
      )}

      {showIssue && <IssueModal onClose={() => setShowIssue(false)} onSubmit={(b) => issue.mutate(b)} pending={issue.isPending} />}
      {replaceTarget && (
        <ReplaceModal card={replaceTarget} onClose={() => setReplaceTarget(null)} onSubmit={(newUid) => replace.mutate({ id: replaceTarget.id, newUid })} pending={replace.isPending} />
      )}
      {historyStudentId && <HistoryModal studentId={historyStudentId} onClose={() => setHistoryStudentId(null)} />}
    </div>
  );
}

function IssueModal({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (b: { studentId: string; uid: string }) => void; pending: boolean }) {
  const [studentId, setStudentId] = useState('');
  const [uid, setUid] = useState('');
  return (
    <Modal title="Issue RFID card" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ studentId, uid }); }} className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Student</span><StudentPicker value={studentId} onChange={setStudentId} /></label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Card UID</span>
          <input required value={uid} onChange={(e) => setUid(e.target.value)} className="input w-full" placeholder="RFID-00133" />
        </label>
        <button type="submit" disabled={pending || !studentId} className="btn-primary w-full !py-2.5">{pending ? 'Issuing…' : 'Issue card'}</button>
      </form>
    </Modal>
  );
}

function ReplaceModal({ card, onClose, onSubmit, pending }: { card: RFIDCardRow; onClose: () => void; onSubmit: (uid: string) => void; pending: boolean }) {
  const [uid, setUid] = useState('');
  return (
    <Modal title={`Replace card ${card.uid}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(uid); }} className="space-y-3">
        <p className="text-sm text-slate-500">{card.uid} will be retired and linked to the new card. The student keeps the same profile.</p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">New card UID</span>
          <input required value={uid} onChange={(e) => setUid(e.target.value)} className="input w-full" placeholder="RFID-00133-B" />
        </label>
        <button type="submit" disabled={pending} className="btn-primary w-full !py-2.5">{pending ? 'Replacing…' : 'Replace card'}</button>
      </form>
    </Modal>
  );
}

function HistoryModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['presence-card-history', studentId],
    queryFn: async () => (await api.get(`/presence/cards/history/${studentId}`)).data as { student: { name: string }; cards: RFIDCardRow[] },
  });
  return (
    <Modal title={history.data ? `Card history — ${history.data.student.name}` : 'Card history'} onClose={onClose} width="max-w-lg">
      {history.isLoading ? (
        <LoadingScreen />
      ) : (
        <div className="space-y-2">
          {history.data?.cards.map((c) => {
            const badge = CARD_BADGE[c.status];
            return (
              <div key={c.id} className={cn('flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm', c.status === 'ACTIVE' ? 'bg-mint-400/5' : 'bg-ink-800/60')}>
                <div>
                  <code className="font-semibold text-slate-900">{c.uid}</code>
                  <div className="text-xs text-slate-500">Issued {new Date(c.issuedDate).toLocaleDateString('en-IN')}</div>
                </div>
                <Badge severity={badge.severity}>{badge.label}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Eye, PencilRuler } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, EmptyState, LoadingScreen } from '@/components/ui';
import { cn } from '@/lib/utils';
import TimetableGrid, { type ViewMode } from './TimetableGrid';
import SlotDialog from './SlotDialog';
import type { KSlot, KTimetable } from './types';

/**
 * The main event: the timetable, filtered by class / teacher / room, in
 * either the live version or the draft under review. Click any lesson for
 * its story ("Why?") and — on a draft — safe editing controls.
 */
export default function TimetableTab({
  isAdmin,
  view,
  onViewChange,
}: {
  isAdmin: boolean;
  view: 'draft' | 'live';
  onViewChange: (v: 'draft' | 'live') => void;
}) {
  const [mode, setMode] = useState<ViewMode>('class');
  const [entityId, setEntityId] = useState('');
  const [selected, setSelected] = useState<KSlot | null>(null);

  const live = useQuery({
    queryKey: ['kairos-live'],
    queryFn: async () => (await api.get('/timetable')).data.timetable as KTimetable | null,
  });
  const draft = useQuery({
    queryKey: ['kairos-draft'],
    queryFn: async () => (await api.get('/timetable/draft')).data.timetable as KTimetable | null,
    enabled: isAdmin,
  });

  const showingDraft = view === 'draft' && !!draft.data;
  const tt = showingDraft ? draft.data : live.data;

  // Entity choices derived from whichever timetable is on screen.
  const entities = useMemo(() => {
    if (!tt) return [] as { id: string; name: string }[];
    const map = new Map<string, string>();
    for (const s of tt.slots) {
      if (mode === 'class') map.set(s.classId, s.className);
      else if (mode === 'teacher') map.set(s.teacherId, s.teacher);
      else if (s.roomId) map.set(s.roomId, s.room ?? '—');
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tt, mode]);

  const activeEntity = entities.find((e) => e.id === entityId)?.id ?? entities[0]?.id ?? '';

  if (live.isLoading || (isAdmin && draft.isLoading)) return <LoadingScreen label="Loading timetable…" />;

  if (!tt) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-8 w-8" />}
        title="No timetable yet"
        hint={isAdmin ? 'Generate a draft from the Overview tab to get started.' : 'The timetable will appear here once published.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — quiet, calendar-app simple */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['class', 'teacher', 'room'] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setEntityId(''); }}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                mode === m ? 'bg-brand-600 text-white' : 'bg-surface text-slate-500 hover:text-slate-800',
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <select value={activeEntity} onChange={(e) => setEntityId(e.target.value)} className="input w-40">
          {entities.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && draft.data && (
            <div className="flex overflow-hidden rounded-lg border border-line">
              <button
                onClick={() => onViewChange('live')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold', !showingDraft ? 'bg-brand-600 text-white' : 'bg-surface text-slate-500 hover:text-slate-800')}
              >
                <Eye className="h-3.5 w-3.5" /> Live{live.data ? ` v${live.data.version}` : ''}
              </button>
              <button
                onClick={() => onViewChange('draft')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold', showingDraft ? 'bg-amber-400 text-slate-900' : 'bg-surface text-slate-500 hover:text-slate-800')}
              >
                <PencilRuler className="h-3.5 w-3.5" /> Draft
              </button>
            </div>
          )}
          {showingDraft ? (
            <Badge severity="WARNING">Draft — not visible to the school until published</Badge>
          ) : (
            live.data && <Badge severity="SUCCESS">Live · Health {tt.score}/100</Badge>
          )}
        </div>
      </div>

      <TimetableGrid
        timetable={tt}
        mode={mode}
        entityId={activeEntity}
        onSlotClick={(s) => setSelected(s)}
      />

      <p className="text-xs text-slate-400">
        Click any lesson to see why Kairos placed it there{showingDraft && isAdmin ? ', lock it, or move it — every change is checked against every rule first' : ''}.
      </p>

      {selected && (
        <SlotDialog
          slot={selected}
          timetable={tt}
          editable={isAdmin && showingDraft}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

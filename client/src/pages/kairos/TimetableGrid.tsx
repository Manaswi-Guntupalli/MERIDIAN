import { Fragment } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KSlot, KTimetable } from './types';

export type ViewMode = 'class' | 'teacher' | 'room';

/**
 * The timetable itself — one calm calendar grid. Filtered to a single class,
 * teacher or room so it always reads like a personal week, never a wall of
 * data. All intelligence stays behind the click.
 */
export default function TimetableGrid({
  timetable,
  mode,
  entityId,
  onSlotClick,
  compact = false,
}: {
  timetable: KTimetable;
  mode: ViewMode;
  entityId: string;
  onSlotClick?: (slot: KSlot) => void;
  compact?: boolean;
}) {
  const slots = timetable.slots.filter((s) =>
    mode === 'class' ? s.classId === entityId : mode === 'teacher' ? s.teacherId === entityId : s.roomId === entityId,
  );
  const cell = (d: number, p: number) => slots.find((s) => s.day === d && s.period === p);
  const blockedAt = (d: number, p: number) => timetable.blocked.find((b) => b.day === d && b.period === p);
  const breakAfter = (p: number) => timetable.breaks.find((b) => b.after === p);
  const days = timetable.days;

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid border-b border-line bg-ink-800/40" style={{ gridTemplateColumns: `88px repeat(${days.length}, 1fr)` }}>
            <div />
            {days.map((d) => (
              <div key={d} className="border-l border-line py-2.5 text-center text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {d}
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: `88px repeat(${days.length}, 1fr)` }}>
            {timetable.periods.map((pLabel, p) => (
              <Fragment key={`p-${p}`}>
                <div className="flex flex-col items-center justify-start border-b border-line pt-2.5">
                  <span className="text-[0.62rem] font-semibold text-slate-400">{pLabel}</span>
                  {timetable.periodTimes[p] && (
                    <span className="tnum mt-0.5 text-[0.58rem] text-slate-300">{timetable.periodTimes[p].start}</span>
                  )}
                </div>
                {days.map((_, d) => {
                  const blocked = blockedAt(d, p);
                  const c = cell(d, p);
                  return (
                    <motion.div
                      key={`${d}-${p}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: (d + p) * 0.006, duration: 0.18 }}
                      className="border-b border-l border-line p-1"
                    >
                      {blocked ? (
                        <div className={cn('grid h-full place-items-center rounded-[7px] border border-dashed border-line bg-ink-800/50 text-[0.62rem] font-medium text-slate-400', compact ? 'min-h-[40px]' : 'min-h-[54px]')}>
                          {blocked.reason}
                        </div>
                      ) : c ? (
                        <button
                          type="button"
                          onClick={onSlotClick ? () => onSlotClick(c) : undefined}
                          className={cn(
                            'group relative block h-full w-full rounded-[7px] px-2 py-1.5 text-left text-[0.68rem] leading-tight transition-shadow',
                            onSlotClick ? 'cursor-pointer hover:shadow-md' : 'cursor-default',
                          )}
                          style={{ background: `${c.subjectColor}12`, boxShadow: `inset 2px 0 0 ${c.subjectColor}` }}
                          title={`${c.subject} · ${mode === 'teacher' ? c.className : c.teacher}${c.room ? ' · ' + c.room : ''}`}
                        >
                          <div className="truncate font-semibold text-slate-800">{c.subject}</div>
                          <div className="truncate text-slate-400">
                            {mode === 'class' ? c.teacher.split(' ').slice(-1) : c.className}
                          </div>
                          {!compact && c.room && <div className="truncate text-[0.62rem] text-slate-300">{c.room}</div>}
                          {c.locked && (
                            <Lock className="absolute right-1.5 top-1.5 h-3 w-3 text-slate-400" aria-label="Locked" />
                          )}
                        </button>
                      ) : (
                        <div className={cn('h-full rounded-[7px] bg-ink-800/30', compact ? 'min-h-[40px]' : 'min-h-[54px]')} />
                      )}
                    </motion.div>
                  );
                })}
                {breakAfter(p) && (
                  <div
                    className="col-span-full flex items-center gap-2 border-b border-line bg-ink-800/40 px-3 py-1 text-[0.6rem] font-medium uppercase tracking-[0.1em] text-slate-400"
                    style={{ gridColumn: `1 / span ${days.length + 1}` }}
                  >
                    {breakAfter(p)!.name} · {breakAfter(p)!.minutes} min
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Subject legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5">
        {[...new Map(slots.map((s) => [s.subject, s.subjectColor])).entries()].map(([name, color]) => (
          <span key={name} className="flex items-center gap-1.5 text-[0.68rem] text-slate-500">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} /> {name}
          </span>
        ))}
      </div>
    </div>
  );
}

import { useSchoolStatus } from '@/hooks/useSchoolStatus';
import { cn } from '@/lib/utils';

const DOT: Record<string, string> = {
  mint: 'bg-mint-400',
  cyan: 'bg-cyan-400',
  amber: 'bg-amber-400',
  slate: 'bg-slate-300',
};

/** Always-visible, live school-day status. Ticks locally each minute. */
export default function SchoolStatusChip() {
  const s = useSchoolStatus();
  if (s.phase === 'LOADING') return null;

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[0.72rem] font-medium text-slate-600 sm:inline-flex"
      title={s.detail}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[s.tone], s.inSession && 'animate-pulseGlow')} />
      {s.label}
    </span>
  );
}

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn, severityColor } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ overline, title, action }: { overline?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {overline && <div className="label mb-1">{overline}</div>}
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  accent = 'brand',
  index = 0,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: 'brand' | 'cyan' | 'mint' | 'amber' | 'rose';
  index?: number;
}) {
  const accents: Record<string, string> = {
    brand: 'from-brand-500/20 text-brand-400',
    cyan: 'from-cyan-400/20 text-cyan-400',
    mint: 'from-mint-400/20 text-mint-400',
    amber: 'from-amber-400/20 text-amber-400',
    rose: 'from-rose-400/20 text-rose-400',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="glass glass-hover relative overflow-hidden p-4"
    >
      <div className={cn('absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br to-transparent blur-2xl', accents[accent])} />
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon && <span className={cn('opacity-70', accents[accent].split(' ')[1])}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-extrabold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </motion.div>
  );
}

export function Badge({ children, severity, className }: { children: ReactNode; severity?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', severity ? severityColor[severity] : 'border-white/10 bg-white/5 text-slate-300', className)}>
      {children}
    </span>
  );
}

export function Meter({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: string }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-gradient',
    mint: 'bg-mint-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
  };
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <motion.div
        className={cn('h-full rounded-full', tones[tone] ?? tones.brand)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
    </div>
  );
}

export function ConfidenceRing({ value, size = 44 }: { value: number; size?: number }) {
  const pct = Math.round(value * 100);
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = pct >= 90 ? '#34d399' : pct >= 75 ? '#22d3ee' : pct >= 60 ? '#fbbf24' : '#fb7185';
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c - (pct / 100) * c }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      <text x="50%" y="50%" dy="0.32em" textAnchor="middle" className="rotate-90" style={{ transformOrigin: 'center' }} fill="white" fontSize="11" fontWeight="700">
        {pct}
      </text>
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-400">
      <Spinner className="h-6 w-6 text-brand-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-12 text-center">
      {icon && <div className="text-slate-500">{icon}</div>}
      <div className="font-semibold text-slate-300">{title}</div>
      {hint && <div className="max-w-xs text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-xl bg-white/5', className)} />;
}

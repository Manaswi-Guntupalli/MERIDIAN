import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn, severityColor } from '@/lib/utils';
import { T } from '@/constants/theme';
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
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
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
  // A quiet accent rail instead of a coloured glow — depth from structure.
  const accents: Record<string, { rail: string; icon: string; wash: string }> = {
    brand: { rail: 'bg-brand-500', icon: 'text-brand-500', wash: 'bg-brand-50' },
    cyan: { rail: 'bg-cyan-400', icon: 'text-cyan-400', wash: 'bg-cyan-400/[0.07]' },
    mint: { rail: 'bg-mint-400', icon: 'text-mint-400', wash: 'bg-mint-400/[0.07]' },
    amber: { rail: 'bg-amber-400', icon: 'text-amber-400', wash: 'bg-amber-400/[0.07]' },
    rose: { rail: 'bg-rose-400', icon: 'text-rose-400', wash: 'bg-rose-400/[0.07]' },
  };
  const a = accents[accent] ?? accents.brand;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="surface surface-hover lift-3d relative overflow-hidden p-4 pl-5"
    >
      <span className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r-full', a.rail)} />
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {icon && <span className={cn('grid h-7 w-7 place-items-center rounded-md', a.wash, a.icon)}>{icon}</span>}
      </div>
      <div className="tnum mt-2 font-display text-[1.7rem] font-semibold leading-none text-slate-900">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </motion.div>
  );
}

export function Badge({ children, severity, className }: { children: ReactNode; severity?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', severity ? severityColor[severity] : 'border-line bg-ink-800 text-slate-600', className)}>
      {children}
    </span>
  );
}

export function Meter({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: string }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-500',
    mint: 'bg-mint-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
  };
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-ink-700', className)}>
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
  const color = pct >= 90 ? T.mint : pct >= 75 ? T.brand : pct >= 60 ? T.amber : T.rose;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.well} strokeWidth={stroke} />
      {/* The arc starts at 12 o'clock via an SVG-native rotate about the explicit
          centre — CSS rotate classes on <svg>/<text> render inconsistently,
          especially inside 3D-transformed ancestors. */}
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
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
      </g>
      <text x="50%" y="50%" dy="0.32em" textAnchor="middle" fill="#16211F" fontSize="11" fontWeight="700">
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
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
      <Spinner className="h-6 w-6 text-brand-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center">
      {icon && <div className="text-slate-500">{icon}</div>}
      <div className="font-semibold text-slate-600">{title}</div>
      {hint && <div className="max-w-xs text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-xl bg-ink-800', className)} />;
}

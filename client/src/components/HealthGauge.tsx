import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { T } from '@/constants/theme';
import { DUR, EASE_OUT, SWEEP, stagger } from '@/constants/motion';
import CountUp from './ui/CountUp';

interface Sub {
  label: string;
  value: number;
  /** The period this category describes — no category is a single-day figure. */
  hint?: string;
}

/**
 * Shown while the engine is computing, or when it cannot be reached.
 *
 * The dashboard used to fall back to a second, server-side health figure with
 * different categories and different weights — so the headline number changed
 * a second after the page opened. Health has one owner now; until it answers,
 * nothing pretends to be it.
 */
export function HealthGaugePlaceholder({ state }: { state: 'loading' | 'offline' | 'nodata' }) {
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.well} strokeWidth={stroke} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-health-figure="placeholder"
            className={cn('font-display text-[3rem] font-semibold leading-none tracking-[-0.03em] text-slate-300', state === 'loading' && 'animate-pulse')}
          >
            —
          </span>
          <span className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Health</span>
        </div>
      </div>
      <div className="w-full flex-1">
        <div className="mb-3 text-sm text-slate-500">
          {state === 'loading'
            ? 'Scoring live school data…'
            : state === 'offline'
              ? 'Score unavailable — the intelligence engine is unreachable.'
              : 'Not enough recorded data to score the school yet.'}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="mb-1 h-3 w-full rounded bg-ink-800" />
              <div className="h-1.5 w-full rounded-full bg-ink-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The signature Operational Health radial — the executive "one number" that
// blends live sub-scores. Gradient stroke (purple → cyan), animated on mount.
export default function HealthGauge({ value, subs }: { value: number; subs: Sub[] }) {
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const status = value >= 85 ? 'Everything running smoothly' : value >= 70 ? 'Minor items need attention' : 'Action recommended';

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id="healthGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={T.brand} />
              <stop offset="100%" stopColor={T.mint} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.well} strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#healthGrad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c - (value / 100) * c }}
            transition={{ duration: 0.9, ease: EASE_OUT }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* The figure counts up to meet the ring, landing together. */}
          <CountUp
            data-health-figure="score"
            value={value}
            decimals={Number.isInteger(value) ? 0 : 1}
            duration={900}
            className="tnum font-display text-[3rem] font-semibold leading-none tracking-[-0.03em] text-slate-900"
          />
          <span className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Health</span>
        </div>
      </div>

      <div className="w-full flex-1">
        <div className="mb-4 text-[0.9rem] font-medium text-slate-600">{status}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {subs.map((s, i) => (
            <motion.div
              key={s.label}
              title={s.hint}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: stagger(i, 0.05), duration: DUR.base, ease: EASE_OUT }}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[0.78rem] text-slate-500">{s.label}</span>
                <span className="tnum text-[0.82rem] font-semibold text-slate-800">{s.value}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <motion.div
                  className={cn('h-full rounded-full', s.value >= 85 ? 'bg-mint-400' : s.value >= 70 ? 'bg-brand-600' : 'bg-amber-400')}
                  initial={{ width: 0 }}
                  animate={{ width: `${s.value}%` }}
                  transition={{ ...SWEEP, delay: 0.15 + stagger(i, 0.06) }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

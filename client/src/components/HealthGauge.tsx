import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { T } from '@/constants/theme';

interface Sub {
  label: string;
  value: number;
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
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="tnum text-5xl font-extrabold text-slate-900"
          >
            {value}
          </motion.span>
          <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Health</span>
        </div>
      </div>

      <div className="w-full flex-1">
        <div className="mb-3 text-sm text-slate-500">{status}</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {subs.map((s, i) => (
            <div key={s.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">{s.label}</span>
                <span className="tnum font-semibold text-slate-700">{s.value}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <motion.div
                  className={cn('h-full rounded-full', s.value >= 85 ? 'bg-mint-400' : s.value >= 70 ? 'bg-brand-600' : 'bg-amber-400')}
                  initial={{ width: 0 }}
                  animate={{ width: `${s.value}%` }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.7, ease: 'easeOut' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

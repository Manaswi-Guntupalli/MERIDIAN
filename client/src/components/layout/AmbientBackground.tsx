import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NAV } from '@/constants/nav';

/**
 * Static ambient wash behind the page content — a very subtle pastel tint,
 * no motion. Each sidebar group gets its own hue pair (matching its sidebar
 * accent); switching sections crossfades between palettes so the colour
 * never snaps. Sits behind the scrolling <main>, pointer-events-none.
 */
const GROUP_HUES: Record<string, [string, string]> = {
  'Overview': ['147,197,253', '196,181,253'], // blue + lavender
  'Pulse · ERP': ['110,231,183', '147,197,253'], // mint + blue
  'Engines': ['253,186,116', '249,168,212'], // peach + pink
  'Trust Core': ['252,211,77', '253,186,116'], // gold + peach
  'System': ['203,213,225', '196,181,253'], // slate + lavender
};

function groupFor(pathname: string): string {
  let best = 'Overview';
  let bestLen = 0;
  for (const item of NAV) {
    const match = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(item.to + '/');
    if (match && item.to.length > bestLen) {
      best = item.group;
      bestLen = item.to.length;
    }
  }
  return best;
}

export default function AmbientBackground() {
  const { pathname } = useLocation();
  const group = groupFor(pathname);
  const [a, b] = GROUP_HUES[group] ?? GROUP_HUES['Overview'];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <AnimatePresence initial={false}>
        <motion.div
          key={group}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeInOut' }}
          style={{
            // Corner-anchored washes with gradual multi-stop falloff — reads
            // as faint tinted light, never as a shape or ring.
            background: [
              `radial-gradient(70% 55% at 10% 0%, rgba(${a},0.11) 0%, rgba(${a},0.06) 45%, transparent 75%)`,
              `radial-gradient(65% 60% at 100% 30%, rgba(${b},0.09) 0%, rgba(${b},0.05) 45%, transparent 75%)`,
              `radial-gradient(80% 55% at 30% 100%, rgba(${a},0.07) 0%, rgba(${a},0.04) 45%, transparent 78%)`,
            ].join(', '),
          }}
        />
      </AnimatePresence>
    </div>
  );
}

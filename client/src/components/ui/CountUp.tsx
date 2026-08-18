import { useEffect, useRef, useState } from 'react';
import { EASE_OUT } from '@/constants/motion';

/**
 * A number that settles into place instead of appearing.
 *
 * Two rules keep this from becoming a gimmick:
 *  - It only ever runs once per value. A figure that re-counts on every poll
 *    turns a dashboard into a slot machine.
 *  - It respects prefers-reduced-motion, and it never animates from a previous
 *    value to a new one — only from rest into the first real number, so a
 *    reader is never shown a figure the database never held for long.
 */

const cubicOut = (t: number) => {
  // Same curve as EASE_OUT, evaluated directly: expo-out approximation.
  const [, , , y2] = EASE_OUT;
  return 1 - Math.pow(1 - t, 3 * y2);
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function CountUp({
  value,
  decimals = 0,
  duration = 700,
  className,
  format,
  ...rest
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  /** Wrap the counted figure — e.g. currency or a percent sign. */
  format?: (n: number) => string;
} & Record<string, unknown>) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  /**
   * Flips only when a count actually finishes. It must not be set when the
   * animation *starts*: StrictMode invokes effects twice, and a flag set on
   * start makes the second pass believe the work is done — which left the
   * figure stuck at 0 while the ring behind it swept to full.
   */
  const hasSettled = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(value)) return;

    // Already showing a real figure: later values replace it outright. A
    // number that re-counts on every poll turns a dashboard into a slot machine.
    if (hasSettled.current || prefersReducedMotion()) {
      hasSettled.current = true;
      setShown(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // Clamped at both ends: a rAF callback's timestamp can predate the
      // performance.now() captured just before it, and a negative elapsed
      // time drove the curve past 1, briefly rendering a health score of -7.
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setShown(value * cubicOut(t));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        hasSettled.current = true;
        setShown(value);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  const rounded = decimals > 0 ? Number(shown.toFixed(decimals)) : Math.round(shown);
  return (
    <span className={className} {...rest}>
      {format ? format(rounded) : rounded.toFixed(decimals)}
    </span>
  );
}

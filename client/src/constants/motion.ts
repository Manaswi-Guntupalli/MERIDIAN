/**
 * Motion tokens — one timing language for the whole product.
 *
 * The rule: motion explains a change, it never performs. Everything lands
 * between 150ms and 300ms on a single decelerating curve, so a stat tile, a
 * dialog and a chart all feel like they belong to the same machine. Entrances
 * move a few pixels, never scale from nothing; exits are faster than entrances
 * because leaving should not cost the user time.
 */

/** Decelerating curve (expo-out). Fast to start, settles gently — the "arrival". */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Symmetric curve for things that move and come back (drawers, accordions). */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DUR = {
  /** Hover, press, focus — must feel instant. */
  fast: 0.15,
  /** The default: a card arriving, a panel opening. */
  base: 0.22,
  /** Emphasis only: the page masthead, a dialog. */
  slow: 0.3,
} as const;

/** Cap the stagger so a long list never makes the last row feel late. */
const MAX_STAGGER = 0.24;
export const stagger = (index: number, step = 0.035) =>
  Math.min(index * step, MAX_STAGGER);

/** The standard entrance: a few pixels up, never a scale-in. */
export const fadeUp = (index = 0, distance = 8) => ({
  initial: { opacity: 0, y: distance },
  animate: { opacity: 1, y: 0 },
  transition: { delay: stagger(index), duration: DUR.base, ease: EASE_OUT },
});

/** For content that replaces content in place — no movement, just a cross-fade. */
export const fadeIn = (index = 0) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { delay: stagger(index), duration: DUR.base, ease: EASE_OUT },
});

/** Dialogs: rise and settle; leave quicker than they arrive. */
export const dialogMotion = {
  initial: { opacity: 0, y: 8, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.99, transition: { duration: DUR.fast } },
  transition: { duration: DUR.base, ease: EASE_OUT },
};

export const scrimMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
  transition: { duration: DUR.base },
};

/** Bars, rings and chart series: one sweep, slightly longer, never repeating. */
export const SWEEP = { duration: 0.8, ease: EASE_OUT } as const;

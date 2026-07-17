/**
 * Design tokens for contexts CSS classes can't reach — SVG gradients, canvas
 * strokes and chart libraries. Single source of truth so a palette change
 * never means hunting hex literals through components again.
 */
export const T = {
  brand: '#0E7C6B', // deep teal — primary
  brandDeep: '#0A6558',
  mint: '#1E8A63', // soft emerald — success
  cyan: '#1F6F8B', // deep aqua — info
  amber: '#A76A12', // bronzed amber — warning
  rose: '#C0453B', // muted brick — danger
  coral: '#E86A4F', // warm coral — accent
  gold: '#C98A21',

  ink: '#16211F', // headings
  body: '#3F4A48',
  muted: '#7C8886', // axis labels, secondary
  line: '#E8E4DA', // hairline
  well: '#F3F1EB', // subtle fill
  surface: '#FFFFFF',
  canvas: '#FBFAF7',
} as const;

// Chart defaults so every visualisation reads as one system.
export const CHART = {
  grid: '#EFEDE6',
  axis: T.muted,
  tooltip: {
    background: T.surface,
    border: `1px solid ${T.line}`,
    borderRadius: 10,
    fontSize: 12,
    boxShadow: '0 8px 24px rgba(28,32,31,0.10)',
    color: T.ink,
  },
} as const;

// Face-recognition overlay states.
export const FACE = {
  known: T.mint,
  low: T.amber,
  unknown: T.rose,
  scan: T.brand,
} as const;

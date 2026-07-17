import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * The one table in the product. Deliberately NOT a bordered grid — rows are
 * separated by hairlines only, the header is a quiet small-caps rule, and
 * numeric columns align right with tabular figures. Scrolls inside itself so
 * a wide table never breaks the page.
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  cell: (row: T, index: number) => ReactNode;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  const alignOf = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (!rows.length && empty) return <div className="surface p-0">{empty}</div>;

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-slate-400 first:pl-5 last:pr-5',
                    alignOf(c.align),
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <motion.tr
                key={rowKey(row, i)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.012, 0.2), duration: 0.2 }}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'border-b border-line/70 last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-ink-800/70',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle text-[0.84rem] text-slate-600 first:pl-5 last:pr-5', alignOf(c.align))}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Primary identity cell — avatar + name + supporting line. */
export function CellIdentity({ initials, title, sub, tone = 'brand' }: { initials: string; title: string; sub?: string; tone?: 'brand' | 'muted' }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[0.63rem] font-bold',
          tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-ink-800 text-slate-500',
        )}
      >
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-900">{title}</span>
        {sub && <span className="block truncate text-[0.72rem] text-slate-400">{sub}</span>}
      </span>
    </div>
  );
}

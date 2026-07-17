import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * The page's masthead. Serif title carries the voice; the eyebrow orients you;
 * generous bottom space lets the content breathe rather than crowding it.
 */
export default function PageHeader({
  overline,
  title,
  subtitle,
  actions,
}: {
  overline?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        {overline && <div className="eyebrow mb-1.5">{overline}</div>}
        <h1 className="title-xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

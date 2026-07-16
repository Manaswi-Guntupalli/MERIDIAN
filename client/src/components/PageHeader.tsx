import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

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
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        {overline && <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-brand-400">{overline}</div>}
        <h1 className="text-2xl font-extrabold tracking-tight text-white lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.div>
  );
}

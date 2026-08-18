import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { DUR, EASE_OUT } from '@/constants/motion';

/**
 * The page's masthead — the first thing the eye should land on.
 *
 * Hierarchy comes from three separate signals rather than size alone: the
 * eyebrow is small, coloured and tracked out; the title is large, serif and
 * optically tightened; the subtitle is quiet and measure-capped so it reads as
 * a caption to the title instead of competing with it.
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
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE_OUT }}
      className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        {overline && <div className="eyebrow mb-2">{overline}</div>}
        <h1 className="title-xl">{title}</h1>
        {subtitle && <p className="prose-quiet mt-2.5 max-w-[58ch]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

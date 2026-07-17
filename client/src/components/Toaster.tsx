import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/store/ui';
import { severityColor } from '@/lib/utils';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

const icons = {
  SUCCESS: CheckCircle2,
  INFO: Info,
  WARNING: AlertTriangle,
  CRITICAL: XCircle,
};

export default function Toaster() {
  const { toasts, dismissToast } = useUI();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icons[t.severity] ?? Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="surface pointer-events-auto flex items-start gap-3 p-3.5"
            >
              <span className={`rounded-lg border p-1.5 ${severityColor[t.severity]}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-slate-500">{t.body}</div>}
              </div>
              <button onClick={() => dismissToast(t.id)} className="text-slate-500 hover:text-slate-900">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

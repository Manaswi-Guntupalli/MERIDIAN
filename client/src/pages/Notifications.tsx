import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { severityColor, timeAgo } from '@/lib/utils';
import type { NotificationItem } from '@/types';

// The feed shows a two-line preview of each notification. A school notice runs
// to several paragraphs, and inlining it would push every other alert off the
// screen — so the full text lives in a detail dialog, one click away.

export default function Notifications() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data as { notifications: NotificationItem[]; unread: number } });

  const readAll = useMutation({ mutationFn: async () => api.patch('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: async (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  const [open, setOpen] = useState<NotificationItem | null>(null);

  const openDetail = (n: NotificationItem) => {
    setOpen(n);
    if (!n.read) readOne.mutate(n.id);
  };

  if (isLoading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        overline="Smart notifications"
        title="Notifications"
        subtitle="Not 'new fee due' — actionable, with a suggested fix ready. The important thing, first."
        actions={data && data.unread > 0 && <button onClick={() => readAll.mutate()} className="btn-ghost"><CheckCheck className="h-4 w-4" /> Mark all read</button>}
      />

      {data?.notifications.length ? (
        <div className="space-y-2">
          {data.notifications.map((n, i) => (
            <motion.div key={n.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => openDetail(n)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(n); } }}
                className={`flex cursor-pointer items-start gap-3 transition hover:border-brand-400/30 ${!n.read ? '!border-brand-400/20' : 'opacity-70'}`}
              >
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${severityColor[n.severity]}`}><Bell className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
                    <Badge className="ml-auto">{n.category}</Badge>
                  </div>
                  <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-slate-500">{n.body}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[0.65rem] text-slate-400">{timeAgo(n.createdAt)}</span>
                    {n.action && <Link to={n.action.to} onClick={(e) => e.stopPropagation()} className="text-[0.7rem] font-semibold text-brand-400 hover:underline">{n.action.label} →</Link>}
                    <span className="ml-auto text-[0.7rem] font-semibold text-brand-400">Read →</span>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="You're all caught up" hint="Smart, actionable alerts will appear here." />
      )}

      <NotificationDetail n={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** One notification, read in full — paragraph breaks intact and selectable. */
function NotificationDetail({ n, onClose }: { n: NotificationItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!n) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, onClose]);

  return (
    <AnimatePresence>
      {n && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center bg-[#2A2621]/25 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={n.title}
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${severityColor[n.severity]}`}><Bell className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-semibold text-slate-900">{n.title}</h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[0.7rem] text-slate-400">{timeAgo(n.createdAt)}</span>
                  <Badge>{n.category}</Badge>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-ink-800/40 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 whitespace-pre-line border-t border-line pt-5 text-[0.92rem] leading-relaxed text-slate-700">
              {n.body}
            </div>

            {n.action && (
              <Link to={n.action.to} onClick={onClose} className="btn-primary mt-5 inline-flex">
                {n.action.label} →
              </Link>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

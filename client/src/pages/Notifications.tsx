import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, EmptyState } from '@/components/ui';
import { severityColor, timeAgo } from '@/lib/utils';
import type { NotificationItem } from '@/types';

export default function Notifications() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data as { notifications: NotificationItem[]; unread: number } });

  const readAll = useMutation({ mutationFn: async () => api.patch('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: async (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

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
            <motion.div key={n.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} onClick={() => !n.read && readOne.mutate(n.id)}>
              <Card className={`flex items-start gap-3 ${!n.read ? '!border-brand-400/20' : 'opacity-70'}`}>
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${severityColor[n.severity]}`}><Bell className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
                    <Badge className="ml-auto">{n.category}</Badge>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500">{n.body}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[0.65rem] text-slate-400">{timeAgo(n.createdAt)}</span>
                    {n.action && <Link to={n.action.to} className="text-[0.7rem] font-semibold text-brand-400 hover:underline">{n.action.label} →</Link>}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="You're all caught up" hint="Smart, actionable alerts will appear here." />
      )}
    </div>
  );
}

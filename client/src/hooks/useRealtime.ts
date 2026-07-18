import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket } from '@/lib/socket';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import type { NotificationItem } from '@/types';

// Connects to the realtime stream and reacts to events across the app.
export function useRealtime() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();
    if (!socket) return;

    const onNotification = (n: NotificationItem) => {
      pushToast({ title: n.title, body: n.body, severity: n.severity });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    // Any appended event can move the numbers — refresh every derived view so
    // the whole command center is genuinely live, not just the event log.
    const REACTIVE = [
      'events', 'stats', 'command-center', 'insights', 'attendance',
      'predictions', 'twin', 'face', 'fees', 'me-dashboard', 'teacher-dashboard', 'ai-logs',
      'documents', 'lumen-stats',
    ];
    const onEvent = () => REACTIVE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const PRESENCE_REACTIVE = ['presence-events', 'presence-analytics', 'attendance', 'twin', 'presence-readers'];
    const onPresenceEvent = (e: { status: string; student?: { name: string }; direction: string; reason?: string }) => {
      if (e.status === 'VERIFIED' || e.status === 'LATE') {
        const verb = e.direction === 'EXIT' ? 'exited' : 'entered';
        pushToast({ title: e.status === 'LATE' ? 'Late arrival' : 'Presence ✓', body: `${e.student?.name ?? 'Student'} ${verb}${e.status === 'LATE' ? ' (late)' : ''}`, severity: e.status === 'LATE' ? 'WARNING' : 'SUCCESS' });
      } else if (e.status === 'UNKNOWN') {
        pushToast({ title: 'Unknown card scanned', body: e.reason ?? 'Needs review', severity: 'WARNING' });
      }
      PRESENCE_REACTIVE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    };
    const onReaderStatus = () => qc.invalidateQueries({ queryKey: ['presence-readers'] });
    const onEmergency = (e: { kind: string }) => {
      pushToast({ title: `🚨 ${e.kind} EMERGENCY`, body: 'Emergency protocol activated', severity: 'CRITICAL' });
      qc.invalidateQueries({ queryKey: ['emergency'] });
    };
    const onEmergencyResolve = () => qc.invalidateQueries({ queryKey: ['emergency'] });

    socket.on('notification:new', onNotification);
    socket.on('event:new', onEvent);
    socket.on('presence:event', onPresenceEvent);
    socket.on('presence:reader-status', onReaderStatus);
    socket.on('emergency:trigger', onEmergency);
    socket.on('emergency:resolve', onEmergencyResolve);

    return () => {
      socket.off('notification:new', onNotification);
      socket.off('event:new', onEvent);
      socket.off('presence:event', onPresenceEvent);
      socket.off('presence:reader-status', onReaderStatus);
      socket.off('emergency:trigger', onEmergency);
      socket.off('emergency:resolve', onEmergencyResolve);
    };
  }, [user, qc, pushToast]);
}

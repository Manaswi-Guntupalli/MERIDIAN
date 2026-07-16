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
    const socket = connectSocket(user.schoolId);

    const onNotification = (n: NotificationItem) => {
      pushToast({ title: n.title, body: n.body, severity: n.severity });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    const onEvent = () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    };
    const onPresence = (p: { student: string; mode: string }) => {
      pushToast({ title: 'Presence ✓', body: `${p.student} marked present (${p.mode})`, severity: 'SUCCESS' });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['twin'] });
    };
    const onEmergency = (e: { kind: string }) => {
      pushToast({ title: `🚨 ${e.kind} EMERGENCY`, body: 'Emergency protocol activated', severity: 'CRITICAL' });
      qc.invalidateQueries({ queryKey: ['emergency'] });
    };
    const onEmergencyResolve = () => qc.invalidateQueries({ queryKey: ['emergency'] });

    socket.on('notification:new', onNotification);
    socket.on('event:new', onEvent);
    socket.on('presence:tap', onPresence);
    socket.on('emergency:trigger', onEmergency);
    socket.on('emergency:resolve', onEmergencyResolve);

    return () => {
      socket.off('notification:new', onNotification);
      socket.off('event:new', onEvent);
      socket.off('presence:tap', onPresence);
      socket.off('emergency:trigger', onEmergency);
      socket.off('emergency:resolve', onEmergencyResolve);
    };
  }, [user, qc, pushToast]);
}

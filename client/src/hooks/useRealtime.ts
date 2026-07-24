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
    // Attendance sessions: a student going PRESENT (or a blocked proxy) moves
    // the live grid and every derived attendance view.
    const PRESENCE_REACTIVE = ['attendance-session', 'presence-events', 'presence-analytics', 'attendance', 'twin', 'face'];
    const onAttendanceVerification = (e: { state?: string; reason?: string }) => {
      if (e.state === 'PROXY_ATTEMPT') pushToast({ title: 'Proxy attendance blocked', body: e.reason ?? 'Face did not match the QR claim', severity: 'CRITICAL' });
      PRESENCE_REACTIVE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    };
    const onAttendanceSession = () => qc.invalidateQueries({ queryKey: ['attendance-session'] });
    const onEmergency = (e: { kind: string }) => {
      pushToast({ title: `🚨 ${e.kind} EMERGENCY`, body: 'Emergency protocol activated', severity: 'CRITICAL' });
      qc.invalidateQueries({ queryKey: ['emergency'] });
      qc.invalidateQueries({ queryKey: ['emergency-state'] });
    };
    const onEmergencyResolve = () => {
      qc.invalidateQueries({ queryKey: ['emergency'] });
      qc.invalidateQueries({ queryKey: ['emergency-state'] });
    };
    // A teacher/parent acknowledgement moves the coordination counters live.
    const onEmergencyAck = () => qc.invalidateQueries({ queryKey: ['emergency-state'] });

    // A publish (or rollback) swaps the school's live timetable — every view
    // that consumes it refreshes instantly: Kairos itself, teacher/student
    // dashboards, the digital twin, staff loads. No reload, no stale schedule.
    // (The toast comes via the school-wide notification, so none here.)
    const TIMETABLE_REACTIVE = [
      'kairos-live', 'kairos-overview', 'kairos-versions', 'kairos-draft',
      'teacher-dashboard', 'me-dashboard', 'twin', 'stats', 'command-center', 'staff',
    ];
    const onTimetablePublished = () => TIMETABLE_REACTIVE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const onTimetableDraft = () => {
      qc.invalidateQueries({ queryKey: ['kairos-overview'] });
      qc.invalidateQueries({ queryKey: ['kairos-draft'] });
    };

    socket.on('notification:new', onNotification);
    socket.on('event:new', onEvent);
    socket.on('attendance:verification', onAttendanceVerification);
    socket.on('attendance:session', onAttendanceSession);
    socket.on('emergency:trigger', onEmergency);
    socket.on('emergency:resolve', onEmergencyResolve);
    socket.on('emergency:ack', onEmergencyAck);
    socket.on('timetable:published', onTimetablePublished);
    socket.on('timetable:draft', onTimetableDraft);

    return () => {
      socket.off('notification:new', onNotification);
      socket.off('event:new', onEvent);
      socket.off('attendance:verification', onAttendanceVerification);
      socket.off('attendance:session', onAttendanceSession);
      socket.off('emergency:trigger', onEmergency);
      socket.off('emergency:resolve', onEmergencyResolve);
      socket.off('emergency:ack', onEmergencyAck);
      socket.off('timetable:published', onTimetablePublished);
      socket.off('timetable:draft', onTimetableDraft);
    };
  }, [user, qc, pushToast]);
}

import { prisma } from '../lib/prisma.js';
import { toJson, fromJson } from '../lib/json.js';
import { emitToSchool } from '../lib/socket.js';

export interface NotificationInput {
  schoolId: string;
  userId?: string;
  title: string;
  body: string;
  severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  category?: string;
  action?: unknown;
}

export async function notify(input: NotificationInput) {
  const n = await prisma.notification.create({
    data: {
      schoolId: input.schoolId,
      userId: input.userId,
      title: input.title,
      body: input.body,
      severity: input.severity ?? 'INFO',
      category: input.category ?? 'GENERAL',
      actionString: toJson(input.action ?? null),
    },
  });
  emitToSchool(input.schoolId, 'notification:new', serializeNotification(n));
  return n;
}

/**
 * `read` is per-viewer (computed from NotificationRead receipts), so the
 * caller supplies it. The default covers freshly-created notifications going
 * out over the socket — new mail is unread for everybody by definition.
 */
export function serializeNotification(n: any, read = false) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    severity: n.severity,
    category: n.category,
    action: fromJson(n.actionString, null),
    read,
    createdAt: n.createdAt,
  };
}

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { serializeNotification } from '../services/notifications.js';

const router = Router();
router.use(authenticate);

/** The notifications this user is allowed to see: their school's broadcasts
 *  plus their own personal ones. Every endpoint filters through this — a
 *  notification outside it can be neither listed nor marked. */
const visibleTo = (schoolId: string, userId: string) => ({
  schoolId,
  OR: [{ userId: null }, { userId }],
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    const items = await prisma.notification.findMany({
      where: visibleTo(req.user!.schoolId, me),
      orderBy: { createdAt: 'desc' },
      take: 50,
      // Pull only *my* receipt per row — "read" is my state, nobody else's.
      include: { reads: { where: { userId: me }, select: { id: true } } },
    });
    const serialized = items.map((n) => serializeNotification(n, n.reads.length > 0));
    res.json({
      notifications: serialized,
      unread: serialized.filter((n) => !n.read).length,
    });
  }),
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    // Visibility check first: you cannot mark (or probe for) a notification
    // that was never yours to see.
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, ...visibleTo(req.user!.schoolId, me) },
      select: { id: true },
    });
    if (!notification) throw notFound('Notification not found');

    // Upsert on the (notification, user) unique key — marking twice is a no-op.
    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId: notification.id, userId: me } },
      create: { notificationId: notification.id, userId: me },
      update: {},
    });
    res.json({ ok: true });
  }),
);

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const me = req.user!.sub;
    // Only rows *I* can see and haven't read. This is the line that fixes the
    // original bug: the old version stamped read=true across the whole
    // school, clearing everyone's inbox — including other users' personal
    // notifications they had never even seen.
    const unread = await prisma.notification.findMany({
      where: { ...visibleTo(req.user!.schoolId, me), reads: { none: { userId: me } } },
      select: { id: true },
    });
    if (unread.length) {
      // SQLite's createMany has no skipDuplicates; the none-filter above makes
      // rows unique by construction, and the one race (same user clicking
      // twice concurrently) trips the @@unique constraint — harmless, so it's
      // swallowed rather than surfaced as a failure to mark things read.
      try {
        await prisma.notificationRead.createMany({
          data: unread.map((n) => ({ notificationId: n.id, userId: me })),
        });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    res.json({ ok: true, marked: unread.length });
  }),
);

export default router;

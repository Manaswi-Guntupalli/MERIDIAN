import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { serializeNotification } from '../services/notifications.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const items = await prisma.notification.findMany({
      where: { schoolId, OR: [{ userId: null }, { userId: req.user!.sub }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      notifications: items.map(serializeNotification),
      unread: items.filter((n) => !n.read).length,
    });
  }),
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      data: { read: true },
    });
    res.json({ ok: true });
  }),
);

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { schoolId: req.user!.schoolId, read: false }, data: { read: true } });
    res.json({ ok: true });
  }),
);

export default router;

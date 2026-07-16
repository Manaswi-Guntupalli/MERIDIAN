import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { STAFF } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const classes = await prisma.class.findMany({
      where: { schoolId: req.user!.schoolId },
      include: {
        room: true,
        classTeacher: { include: { user: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });
    res.json({
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        section: c.section,
        room: c.room?.name,
        classTeacher: c.classTeacher?.user.name,
        students: c._count.students,
      })),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const cls = await prisma.class.findFirst({
      where: { id: req.params.id, schoolId: req.user!.schoolId },
      include: {
        room: true,
        classTeacher: { include: { user: true } },
        students: { orderBy: { rollNo: 'asc' } },
      },
    });
    if (!cls) throw notFound('Class not found');
    res.json({ class: cls });
  }),
);

export default router;

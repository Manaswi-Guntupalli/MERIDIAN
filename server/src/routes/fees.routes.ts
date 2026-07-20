import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { notify } from '../services/notifications.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { status } = req.query as { status?: string };
    const fees = await prisma.fee.findMany({
      where: { schoolId, ...(status ? { status } : {}) },
      include: { student: { include: { class: true } }, payments: true },
      orderBy: { dueDate: 'asc' },
    });
    const summary = {
      total: fees.reduce((a, f) => a + f.amount, 0),
      collected: fees.reduce((a, f) => a + f.paid, 0),
      outstanding: fees.reduce((a, f) => a + (f.amount - f.paid), 0),
      overdue: fees.filter((f) => f.status !== 'PAID').length,
    };
    res.json({
      fees: fees.map((f) => ({
        id: f.id,
        title: f.title,
        amount: f.amount,
        paid: f.paid,
        due: f.amount - f.paid,
        dueDate: f.dueDate,
        status: f.status,
        student: f.student.name,
        studentId: f.studentId,
        class: f.student.class?.name,
      })),
      summary,
    });
  }),
);

const paySchema = z.object({
  feeId: z.string(),
  amount: z.number().positive(),
  method: z.string().optional(),
  reference: z.string().optional(),
});
router.post(
  '/pay',
  authorize(...STAFF_ADMIN),
  validateBody(paySchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const body = req.body as z.infer<typeof paySchema>;
    const fee = await prisma.fee.findFirst({ where: { id: body.feeId, schoolId } });
    if (!fee) throw notFound('Fee not found');
    if (body.amount > fee.amount - fee.paid) throw badRequest('Amount exceeds outstanding balance');

    const payment = await prisma.payment.create({
      data: { feeId: fee.id, amount: body.amount, method: body.method ?? 'CASH', reference: body.reference },
    });
    const paid = fee.paid + body.amount;
    const status = paid >= fee.amount ? 'PAID' : 'PARTIAL';
    await prisma.fee.update({ where: { id: fee.id }, data: { paid, status } });

    await recordEvent({
      schoolId,
      type: 'FEE_PAYMENT_RECORDED',
      aggregate: 'Fee',
      aggregateId: fee.id,
      payload: { feeId: fee.id, paymentId: payment.id, amount: body.amount },
      actorId: req.user!.sub,
      actorName: req.user!.name,
    });
    res.json({ payment, status, paid });
  }),
);

// Draft reminders to all overdue accounts (Command Center action).
// Each reminder is addressed ONLY to the people it concerns — the student's
// own account and their linked guardians. A fee notice as a school-wide
// broadcast (the old behaviour) leaked every family's dues to every user.
router.post(
  '/remind',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const overdue = await prisma.fee.findMany({
      where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
      include: { student: { include: { parents: { include: { parent: true } } } } },
    });

    let recipients = 0;
    for (const f of overdue.slice(0, 25)) {
      const due = Math.round(f.amount - f.paid).toLocaleString('en-IN');
      const targets = new Set<string>();
      if (f.student.userId) targets.add(f.student.userId);
      for (const link of f.student.parents) targets.add(link.parent.userId);
      for (const userId of targets) {
        await notify({
          schoolId,
          userId,
          title: 'Fee reminder',
          body: `₹${due} is due for ${f.student.name} — ${f.title} (due ${f.dueDate}).`,
          severity: 'WARNING',
          category: 'FEES',
        });
        recipients++;
      }
    }

    const drafted = Math.min(25, overdue.length);
    // The drafting admin gets one private summary, not a stream of broadcasts.
    await notify({
      schoolId,
      userId: req.user!.sub,
      title: 'Fee reminders sent',
      body: `${drafted} reminder(s) delivered to ${recipients} student/guardian account(s).`,
      severity: 'SUCCESS',
      category: 'FEES',
    });
    res.json({ drafted, recipients });
  }),
);

export default router;

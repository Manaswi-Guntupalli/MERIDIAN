import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { chatText } from '../lib/openai.js';
import { computePredictions } from '../services/foresight.js';
import { logAI } from '../services/trustLedger.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

// One-click AI report: assembles real figures, adds a narrative + recommendations.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const t = new Date().toISOString().slice(0, 10);
    const [students, teachers, classes, todayAtt, fees, docs] = await Promise.all([
      prisma.student.count({ where: { schoolId } }),
      prisma.teacher.findMany({ where: { schoolId }, include: { user: true } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.attendance.findMany({ where: { schoolId, date: t } }),
      prisma.fee.findMany({ where: { schoolId } }),
      prisma.document.count({ where: { schoolId } }),
    ]);
    const present = todayAtt.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    const attendanceRate = todayAtt.length ? Math.round((present / todayAtt.length) * 100) : 0;
    const outstanding = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
    const collected = fees.reduce((a, f) => a + f.paid, 0);
    const overloaded = teachers.filter((tt) => tt.weeklyHours >= tt.maxHours - 1).map((tt) => tt.user.name);
    const { preds } = await computePredictions(schoolId);

    const metrics = {
      students,
      teachers: teachers.length,
      classes,
      attendanceRate,
      collected: Math.round(collected),
      outstanding: Math.round(outstanding),
      documents: docs,
      overloaded,
    };

    // Narrative — OpenAI if available, else a deterministic template.
    let narrative = await chatText(
      'You are a school operations analyst. Write a crisp 3-4 sentence executive summary from the JSON metrics. No markdown headers.',
      JSON.stringify(metrics),
    );
    if (!narrative) {
      narrative =
        `The school currently serves ${students} students across ${classes} classes with ${teachers.length} staff. ` +
        `Today's attendance stands at ${attendanceRate}%. Fee collection has reached ₹${Math.round(collected).toLocaleString('en-IN')} with ₹${Math.round(outstanding).toLocaleString('en-IN')} outstanding. ` +
        (overloaded.length
          ? `${overloaded.length} staff member(s) are near their weekly hour cap and should be monitored.`
          : `Staff workload is balanced within weekly caps.`);
    }

    const recommendations = [
      outstanding > 0 ? `Draft fee reminders for outstanding ₹${Math.round(outstanding).toLocaleString('en-IN')}.` : 'Fee collection is on track.',
      overloaded.length ? `Rebalance load for: ${overloaded.join(', ')}.` : 'Teacher workload is balanced.',
      attendanceRate < 90 ? 'Investigate attendance dip using Foresight drivers.' : 'Attendance is healthy.',
    ];

    await logAI({
      schoolId,
      engine: 'COPILOT',
      action: 'Generated operations report',
      reason: 'Assembled from live metrics + Foresight predictions',
      confidence: 0.85,
      output: { metrics },
      actorId: req.user!.sub,
      reversible: false,
    });

    res.json({
      generatedAt: new Date().toISOString(),
      title: 'Operations Summary',
      metrics,
      predictions: preds.map((p) => ({ label: p.label, confidence: p.confidence })),
      narrative,
      recommendations,
    });
  }),
);

export default router;

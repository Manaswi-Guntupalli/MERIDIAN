import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { fromJson } from '../lib/json.js';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { computePredictions } from '../services/foresight.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

// Foresight predictions with SHAP-style drivers. Recomputes live from data.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    await computePredictions(schoolId);
    const preds = await prisma.prediction.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    res.json({
      predictions: preds.map((p) => ({
        id: p.id,
        kind: p.kind,
        label: p.label,
        value: p.value,
        confidence: p.confidence,
        targetDate: p.targetDate,
        drivers: fromJson<{ factor: string; impact: number }[]>(p.driversString, []),
      })),
    });
  }),
);

export default router;

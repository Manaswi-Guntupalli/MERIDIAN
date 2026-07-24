import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler } from '../../lib/errors.js';
import { STAFF, STAFF_ADMIN } from '../../utils/constants.js';
import { getPresenceSettings, updatePresenceSettings } from '../../services/presence/settings.js';
import { auditLog } from '../../services/trustLedger.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize(...STAFF),
  asyncHandler(async (req, res) => {
    res.json(await getPresenceSettings(req.user!.schoolId));
  }),
);

const patchSchema = z.object({
  schoolStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lateGraceMinutes: z.number().int().min(0).max(120).optional(),
  sessionDurationMinutes: z.number().int().min(1).max(120).optional(),
});
router.put(
  '/',
  authorize(...STAFF_ADMIN),
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const settings = await updatePresenceSettings(req.user!.schoolId, req.body);
    await auditLog({ schoolId: req.user!.schoolId, actorId: req.user!.sub, action: 'PRESENCE_SETTINGS_UPDATED', entity: 'Setting', meta: req.body });
    res.json(settings);
  }),
);

export default router;

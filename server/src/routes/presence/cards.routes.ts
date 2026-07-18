import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler } from '../../lib/errors.js';
import { STAFF, STAFF_ADMIN } from '../../utils/constants.js';
import * as cards from '../../services/presence/cards.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { studentId, status } = req.query as { studentId?: string; status?: string };
    res.json({ cards: await cards.listCards(req.user!.schoolId, { studentId, status }) });
  }),
);

router.get(
  '/history/:studentId',
  asyncHandler(async (req, res) => {
    res.json(await cards.cardHistory(req.user!.schoolId, req.params.studentId));
  }),
);

const issueSchema = z.object({ studentId: z.string(), uid: z.string().min(1) });
router.post(
  '/',
  authorize(...STAFF_ADMIN),
  validateBody(issueSchema),
  asyncHandler(async (req, res) => {
    const card = await cards.issueCard({ schoolId: req.user!.schoolId, ...req.body }, { id: req.user!.sub, name: req.user!.name });
    res.status(201).json({ card });
  }),
);

const replaceSchema = z.object({ newUid: z.string().min(1) });
router.post(
  '/:id/replace',
  authorize(...STAFF_ADMIN),
  validateBody(replaceSchema),
  asyncHandler(async (req, res) => {
    const result = await cards.replaceCard(req.user!.schoolId, req.params.id, (req.body as { newUid: string }).newUid, { id: req.user!.sub, name: req.user!.name });
    res.json(result);
  }),
);

router.post(
  '/:id/disable',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ card: await cards.disableCard(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name }) });
  }),
);

router.post(
  '/:id/lost',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ card: await cards.reportLost(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name }) });
  }),
);

router.post(
  '/:id/broken',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ card: await cards.reportBroken(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name }) });
  }),
);

router.post(
  '/:id/reissue',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ card: await cards.reissueCard(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name }) });
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { askCopilot } from '../services/copilot.js';
import { logAI } from '../services/trustLedger.js';
import { STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
// Copilot answers over school-wide data (fees, staff load) — admins only.
router.use(authorize(...STAFF_ADMIN));

const askSchema = z.object({ question: z.string().min(2) });

router.post(
  '/ask',
  validateBody(askSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { question } = req.body as z.infer<typeof askSchema>;
    const result = await askCopilot(schoolId, question);
    await logAI({
      schoolId,
      engine: 'COPILOT',
      action: 'Grounded answer',
      reason: `Answered from live event store (${result.source})`,
      confidence: result.confidence,
      input: { question },
      output: { answer: result.answer },
      actorId: req.user!.sub,
      reversible: false,
    });
    res.json(result);
  }),
);

// Suggested prompts for the UI.
router.get('/suggestions', authenticate, (_req, res) => {
  res.json({
    suggestions: [
      'Which teachers are overloaded?',
      'Why did attendance drop this week?',
      'Which classes are likely to need substitutes tomorrow?',
      'Show unpaid fees above ₹10,000',
      'Generate a PTA meeting summary',
    ],
  });
});

export default router;

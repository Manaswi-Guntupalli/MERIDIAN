import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, authenticateReader } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler } from '../../lib/errors.js';
import { STAFF, STAFF_ADMIN } from '../../utils/constants.js';
import * as readers from '../../services/presence/readers.js';

const router = Router();

// apiKeyHash never leaves the server — not even to the STAFF_ADMIN who can
// see everything else about the reader. Only the plaintext key, shown once
// at creation/rotation, authenticates a device; the hash has no caller-facing use.
function sanitize<T extends { apiKeyHash?: string }>(reader: T): Omit<T, 'apiKeyHash'> {
  const { apiKeyHash: _drop, ...rest } = reader;
  return rest;
}

// Device-facing heartbeat — authenticated by reader key, not a user JWT.
router.post(
  '/:id/heartbeat',
  authenticateReader,
  asyncHandler(async (req, res) => {
    const { signal, firmwareVersion } = req.body as { signal?: number; firmwareVersion?: string };
    const reader = await readers.recordHeartbeat(req.reader!.id, { signal, firmwareVersion });
    res.json({ reader: sanitize(reader) });
  }),
);

router.use(authenticate);
router.use(authorize(...STAFF));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ readers: (await readers.listReaders(req.user!.schoolId)).map(sanitize) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ reader: sanitize(await readers.getReader(req.user!.schoolId, req.params.id)) });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  building: z.string().optional(),
  direction: z.enum(['ENTRY', 'EXIT', 'BOTH']).optional(),
});
router.post(
  '/',
  authorize(...STAFF_ADMIN),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const { reader, apiKey } = await readers.createReader({ schoolId: req.user!.schoolId, ...req.body }, { id: req.user!.sub, name: req.user!.name });
    // The plaintext key is returned exactly once — the client must show it
    // to the admin now; it cannot be recovered later, only rotated.
    res.status(201).json({ reader: sanitize(reader), apiKey });
  }),
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  building: z.string().optional(),
  direction: z.enum(['ENTRY', 'EXIT', 'BOTH']).optional(),
  firmwareVersion: z.string().optional(),
});
router.patch(
  '/:id',
  authorize(...STAFF_ADMIN),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const reader = await readers.updateReader(req.user!.schoolId, req.params.id, req.body, { id: req.user!.sub, name: req.user!.name });
    res.json({ reader: sanitize(reader) });
  }),
);

router.post(
  '/:id/rotate-key',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const { reader, apiKey } = await readers.rotateReaderKey(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name });
    res.json({ reader: sanitize(reader), apiKey });
  }),
);

// Simulator-only: force a reader offline/online instantly instead of
// waiting for a heartbeat timeout.
router.post(
  '/:id/force-status',
  authorize(...STAFF_ADMIN),
  validateBody(z.object({ online: z.boolean() })),
  asyncHandler(async (req, res) => {
    const reader = await readers.forceReaderOnline(req.user!.schoolId, req.params.id, (req.body as { online: boolean }).online);
    res.json({ reader: sanitize(reader) });
  }),
);

router.delete(
  '/:id',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    await readers.deleteReader(req.user!.schoolId, req.params.id, { id: req.user!.sub, name: req.user!.name });
    res.json({ ok: true });
  }),
);

export default router;

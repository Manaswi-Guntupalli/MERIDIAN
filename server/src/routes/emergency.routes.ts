import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { EMERGENCY_KINDS, STAFF, STAFF_ADMIN } from '../utils/constants.js';
import {
  EMERGENCY_TYPES,
  isValidKind,
  activateEmergency,
  resolveEmergency,
  acknowledge,
  getIncidentState,
  getActiveIncident,
} from '../services/emergency.js';

const router = Router();
router.use(authenticate);

// The active incident + this viewer's own acknowledgement + role instructions —
// drives the banner and the role-specific instruction cards on every device.
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const active = await getActiveIncident(req.user!.schoolId);
    if (!active) return res.json({ active: null });
    const type = EMERGENCY_TYPES[active.kind as keyof typeof EMERGENCY_TYPES];
    const role = req.user!.role;
    const audience = role === 'PARENT' ? 'parent' : role === 'STUDENT' ? 'student' : 'staff';
    const myAck = await prisma.emergencyAck.findUnique({
      where: { incidentId_userId: { incidentId: active.id, userId: req.user!.sub } },
      select: { status: true, className: true },
    });
    res.json({
      active: {
        id: active.id,
        kind: active.kind,
        severity: active.severity,
        title: type?.title ?? active.kind,
        protocol: type?.instruction ?? '',
        description: type?.description ?? '',
        instructions: type?.roleInstructions[audience] ?? [],
        triggeredBy: active.triggeredBy,
        createdAt: active.createdAt,
        canAcknowledge: role === 'TEACHER' || role === 'PARENT',
        ackRole: role === 'TEACHER' ? 'TEACHER' : role === 'PARENT' ? 'PARENT' : null,
        myAck: myAck?.status ?? null,
        myClass: myAck?.className ?? null,
      },
    });
  }),
);

const triggerSchema = z.object({
  kind: z.enum(EMERGENCY_KINDS as unknown as [string, ...string[]]),
  note: z.string().optional(),
});
router.post(
  '/trigger',
  authorize(...STAFF), // teachers can raise an emergency (e.g. fire in a classroom)
  validateBody(triggerSchema),
  asyncHandler(async (req, res) => {
    const { kind, note } = req.body as z.infer<typeof triggerSchema>;
    if (!isValidKind(kind)) throw badRequest('Unknown emergency kind.');
    const { incident, type } = await activateEmergency(
      { id: req.user!.sub, name: req.user!.name, schoolId: req.user!.schoolId },
      kind,
      note,
    );
    res.status(201).json({ incident, protocol: type.instruction });
  }),
);

router.post(
  '/resolve/:id',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    await resolveEmergency({ id: req.user!.sub, name: req.user!.name, schoolId: req.user!.schoolId }, req.params.id);
    res.json({ ok: true });
  }),
);

// Teacher class-status report / parent acknowledgement.
const ackSchema = z.object({ status: z.string(), note: z.string().max(280).optional() });
router.post(
  '/:id/acknowledge',
  validateBody(ackSchema),
  asyncHandler(async (req, res) => {
    const role = req.user!.role;
    if (role !== 'TEACHER' && role !== 'PARENT') throw badRequest('Only teachers and parents acknowledge emergencies.');
    const { status, note } = req.body as z.infer<typeof ackSchema>;
    const ack = await acknowledge(
      { id: req.user!.sub, name: req.user!.name, schoolId: req.user!.schoolId },
      req.params.id,
      role,
      status,
      note,
    );
    res.json({ ack });
  }),
);

// Full live coordination state — the principal's command dashboard.
router.get(
  '/:id/state',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    res.json(await getIncidentState(req.user!.schoolId, req.params.id));
  }),
);

// Recent incidents (history) — read-only.
router.get(
  '/incidents',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const incidents = await prisma.emergencyIncident.findMany({
      where: { schoolId: req.user!.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ incidents });
  }),
);

export default router;

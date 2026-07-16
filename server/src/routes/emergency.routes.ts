import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { recordEvent } from '../services/eventStore.js';
import { notify } from '../services/notifications.js';
import { emitToSchool } from '../lib/socket.js';
import { EMERGENCY_KINDS, STAFF, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);

const EVAC = {
  FIRE: 'Evacuate via nearest fire exit to the main assembly ground. Do not use lifts.',
  EARTHQUAKE: 'Drop, cover, hold. After shaking stops, move to the open field via marked routes.',
  MEDICAL: 'Medical team dispatched. Clear the corridor; keep the patient still until help arrives.',
  LOCKDOWN: 'Lock all doors, move away from windows, stay silent until the all-clear is given.',
} as const;

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const active = await prisma.emergencyIncident.findFirst({
      where: { schoolId: req.user!.schoolId, status: 'ACTIVE' },
    });
    res.json({ active: active ? { ...active, protocol: EVAC[active.kind as keyof typeof EVAC] } : null });
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
    const schoolId = req.user!.schoolId;
    const { kind, note } = req.body as z.infer<typeof triggerSchema>;

    const incident = await prisma.emergencyIncident.create({
      data: { schoolId, kind, note, triggeredBy: req.user!.name, status: 'ACTIVE' },
    });

    const protocol = EVAC[kind as keyof typeof EVAC];
    // Fan out to everyone: teachers, parents, admins.
    await notify({
      schoolId,
      title: `🚨 ${kind} EMERGENCY`,
      body: protocol,
      severity: 'CRITICAL',
      category: 'EMERGENCY',
    });
    await recordEvent({
      schoolId,
      type: 'EMERGENCY_TRIGGERED',
      aggregate: 'Emergency',
      aggregateId: incident.id,
      payload: { kind, note },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    emitToSchool(schoolId, 'emergency:trigger', { kind, protocol, incidentId: incident.id });

    res.status(201).json({ incident, protocol });
  }),
);

router.post(
  '/resolve/:id',
  authorize(...STAFF_ADMIN),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const incident = await prisma.emergencyIncident.findFirst({ where: { id: req.params.id, schoolId } });
    if (!incident) throw notFound('Incident not found');
    await prisma.emergencyIncident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await notify({ schoolId, title: '✅ All clear', body: `${incident.kind} resolved. Normal operations resumed.`, severity: 'SUCCESS', category: 'EMERGENCY' });
    emitToSchool(schoolId, 'emergency:resolve', { incidentId: incident.id });
    res.json({ ok: true });
  }),
);

export default router;

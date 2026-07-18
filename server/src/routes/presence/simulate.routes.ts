import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validateBody } from '../../utils/validate.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { STAFF_ADMIN } from '../../utils/constants.js';
import { processScan } from '../../services/presence/engine.js';
import * as readers from '../../services/presence/readers.js';
import * as cards from '../../services/presence/cards.js';
import { getPresenceSettings, minutesOfDay } from '../../services/presence/settings.js';

// Every scenario below funnels through the exact same processScan() a real
// reader hits — there is no parallel "fake" attendance path. The only thing
// unique to this router is that it's allowed to force reader state and
// (only here) override the event timestamp, so demo scenarios like "late
// arrival" are reproducible without waiting for the clock.
const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

// Virtual gate hardware: sends the same periodic heartbeat a physical
// reader would, for every reader in the school. Goes through the real
// recordHeartbeat path (ReaderHeartbeat rows, lastHeartbeat, online flip +
// socket emit) so demo readers stay online exactly the way hardware does.
router.post(
  '/go-online',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const all = await prisma.rFIDReader.findMany({ where: { schoolId }, select: { id: true } });
    for (const r of all) {
      await readers.recordHeartbeat(r.id, { signal: Math.round((0.82 + Math.random() * 0.17) * 100) / 100 });
    }
    res.json({ ok: true, readers: all.length });
  }),
);

async function randomActiveCard(schoolId: string) {
  const active = await prisma.rFIDCard.findMany({ where: { schoolId, status: 'ACTIVE', student: { active: true } }, select: { uid: true, studentId: true } });
  if (!active.length) throw badRequest('No active cards to simulate with — issue a card first');
  return active[Math.floor(Math.random() * active.length)];
}

async function randomOnlineReader(schoolId: string) {
  const online = await prisma.rFIDReader.findMany({ where: { schoolId, online: true } });
  if (!online.length) throw badRequest('No online readers to simulate with');
  return online[Math.floor(Math.random() * online.length)];
}

const scanSchema = z.object({ readerId: z.string(), cardUid: z.string(), direction: z.enum(['ENTRY', 'EXIT']).optional() });
router.post(
  '/scan',
  validateBody(scanSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { readerId, cardUid, direction } = req.body as z.infer<typeof scanSchema>;
    res.json(await processScan({ schoolId, source: 'RFID', readerId, cardUid, direction, createdBy: req.user!.sub, notes: 'Simulator' }));
  }),
);

router.post(
  '/random',
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const [reader, card] = await Promise.all([randomOnlineReader(schoolId), randomActiveCard(schoolId)]);
    res.json(await processScan({ schoolId, source: 'RFID', readerId: reader.id, cardUid: card.uid, createdBy: req.user!.sub, notes: 'Simulator: random' }));
  }),
);

const burstSchema = z.object({ readerId: z.string().optional(), count: z.number().int().min(1).max(30).default(10) });
router.post(
  '/burst',
  validateBody(burstSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { readerId, count } = req.body as z.infer<typeof burstSchema>;
    const reader = readerId ? await readers.getReader(schoolId, readerId) : await randomOnlineReader(schoolId);
    const results = [];
    for (let i = 0; i < count; i++) {
      const card = await randomActiveCard(schoolId);
      results.push(await processScan({ schoolId, source: 'RFID', readerId: reader.id, cardUid: card.uid, createdBy: req.user!.sub, notes: 'Simulator: burst' }));
    }
    res.json({ results });
  }),
);

const readerOnlySchema = z.object({ readerId: z.string().optional() });
router.post(
  '/unknown-card',
  validateBody(readerOnlySchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { readerId } = req.body as z.infer<typeof readerOnlySchema>;
    const reader = readerId ? await readers.getReader(schoolId, readerId) : await randomOnlineReader(schoolId);
    const fakeUid = `UNKNOWN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    res.json(await processScan({ schoolId, source: 'RFID', readerId: reader.id, cardUid: fakeUid, createdBy: req.user!.sub, notes: 'Simulator: unknown card' }));
  }),
);

router.post(
  '/duplicate',
  validateBody(scanSchema.partial({ readerId: true, cardUid: true, direction: true })),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    let { readerId, cardUid } = req.body as Partial<z.infer<typeof scanSchema>>;
    if (!readerId) readerId = (await randomOnlineReader(schoolId)).id;
    if (!cardUid) cardUid = (await randomActiveCard(schoolId)).uid;
    const first = await processScan({ schoolId, source: 'RFID', readerId, cardUid, createdBy: req.user!.sub, notes: 'Simulator: duplicate (1st)' });
    const second = await processScan({ schoolId, source: 'RFID', readerId, cardUid, createdBy: req.user!.sub, notes: 'Simulator: duplicate (2nd)' });
    res.json({ first, second });
  }),
);

const offlineReaderSchema = z.object({ readerId: z.string() });
router.post(
  '/offline-reader',
  validateBody(offlineReaderSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { readerId } = req.body as z.infer<typeof offlineReaderSchema>;
    await readers.forceReaderOnline(schoolId, readerId, false);
    const card = await randomActiveCard(schoolId);
    res.json(await processScan({ schoolId, source: 'RFID', readerId, cardUid: card.uid, createdBy: req.user!.sub, notes: 'Simulator: offline reader' }));
  }),
);

const cardIdSchema = z.object({ cardId: z.string(), readerId: z.string().optional() });
router.post(
  '/lost-card',
  validateBody(cardIdSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { cardId, readerId } = req.body as z.infer<typeof cardIdSchema>;
    // Resolve the reader BEFORE mutating the card — a reader lookup failure
    // must not leave the card half-transitioned with nothing to show for it.
    const reader = readerId ? await readers.getReader(schoolId, readerId) : await randomOnlineReader(schoolId);
    const card = await cards.reportLost(schoolId, cardId, { id: req.user!.sub, name: req.user!.name });
    res.json(await processScan({ schoolId, source: 'RFID', readerId: reader.id, cardUid: card.uid, createdBy: req.user!.sub, notes: 'Simulator: lost card' }));
  }),
);

router.post(
  '/disabled-card',
  validateBody(cardIdSchema),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { cardId, readerId } = req.body as z.infer<typeof cardIdSchema>;
    const reader = readerId ? await readers.getReader(schoolId, readerId) : await randomOnlineReader(schoolId);
    const card = await cards.disableCard(schoolId, cardId, { id: req.user!.sub, name: req.user!.name });
    res.json(await processScan({ schoolId, source: 'RFID', readerId: reader.id, cardUid: card.uid, createdBy: req.user!.sub, notes: 'Simulator: disabled card' }));
  }),
);

router.post(
  '/late',
  validateBody(scanSchema.omit({ direction: true }).partial({ readerId: true, cardUid: true })),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    let { readerId, cardUid } = req.body as { readerId?: string; cardUid?: string };
    if (!readerId) readerId = (await randomOnlineReader(schoolId)).id;
    if (!cardUid) cardUid = (await randomActiveCard(schoolId)).uid;
    const settings = await getPresenceSettings(schoolId);
    const lateAt = new Date();
    const minutesPastMidnight = minutesOfDay(settings.schoolStartTime) + settings.lateGraceMinutes + 20;
    lateAt.setHours(0, 0, 0, 0);
    lateAt.setMinutes(minutesPastMidnight);
    res.json(await processScan({ schoolId, source: 'RFID', readerId, cardUid, direction: 'ENTRY', simulateAt: lateAt, createdBy: req.user!.sub, notes: 'Simulator: forced late arrival' }));
  }),
);

router.post(
  '/exit',
  validateBody(scanSchema.omit({ direction: true })),
  asyncHandler(async (req, res) => {
    const schoolId = req.user!.schoolId;
    const { readerId, cardUid } = req.body as { readerId: string; cardUid: string };
    res.json(await processScan({ schoolId, source: 'RFID', readerId, cardUid, direction: 'EXIT', createdBy: req.user!.sub, notes: 'Simulator: exit scan' }));
  }),
);

export default router;

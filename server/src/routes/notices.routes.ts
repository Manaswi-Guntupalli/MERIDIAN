import { createHash } from 'crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, forbidden } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../utils/validate.js';
import { notify } from '../services/notifications.js';
import { recordEvent } from '../services/eventStore.js';
import { logAI } from '../services/trustLedger.js';
import {
  audiencesFor,
  canSendNotices,
  resolveAudience,
  type AudienceSelection,
  type Sender,
} from '../services/notices/audience.js';
import { NOTICE_TONES, draftNotice } from '../services/notices/draft.js';
import type { Role } from '../utils/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI Notice — AI assists, the human decides.
//
// Three endpoints, deliberately separate:
//   GET  /notices/audiences  what this sender may address (drives the UI)
//   POST /notices/draft      rewrite the sender's facts; persists nothing
//   POST /notices/send       validate, resolve recipients, deliver, record
//
// Drafting and sending are distinct on purpose. Nothing is delivered as a side
// effect of generating text: a send only happens when a human posts the notice
// they have read, and the body that is sent is the body that is stored.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

/** Every route here requires notice permission, checked from the role alone. */
router.use((req, _res, next) => {
  if (!canSendNotices(req.user!.role as Role)) {
    return next(forbidden('Your role cannot send school notices.'));
  }
  next();
});

/** SUPER_ADMIN → "Super Admin". Used only for the sign-off on a draft. */
const roleTitle = (role: Role) =>
  role
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** The authenticated caller, in the shape the audience service expects. */
const senderOf = (req: Request): Sender => ({
  sub: req.user!.sub,
  role: req.user!.role as Role,
  schoolId: req.user!.schoolId,
});

// ── What may this sender address? ────────────────────────────────────────────
router.get(
  '/audiences',
  asyncHandler(async (req, res) => {
    const audiences = await audiencesFor(senderOf(req));
    res.json({ audiences, tones: NOTICE_TONES });
  }),
);

const audienceSchema = z.object({
  scope: z.enum(['SCHOOL', 'GRADE', 'CLASS']),
  scopeId: z.string().optional(),
  recipients: z.enum(['STUDENTS', 'PARENTS', 'BOTH', 'TEACHERS']),
});

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  context: z.string().trim().min(1).max(4000),
  tone: z.enum(NOTICE_TONES),
  audience: audienceSchema,
});

// ── Draft: rewrite the staff member's facts. Nothing is stored or sent. ──────
router.post(
  '/draft',
  validateBody(draftSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof draftSchema>;
    const sender = senderOf(req);

    // Permission is checked before the text ever leaves the building: there is
    // no reason to send a teacher's context to a third party for an audience
    // they are not allowed to address.
    const audience = await resolveAudience(sender, body.audience as AudienceSelection);

    const draft = await draftNotice({
      subject: body.subject,
      context: body.context,
      tone: body.tone,
      audience: audience.description,
      // The signatory is taken from the session, never typed in — a notice
      // must not go out signed "[Your Name]".
      sender: `${req.user!.name}, ${roleTitle(sender.role)}`,
    });

    if (!draft) {
      // The client keeps the typed context; this is a failed assist, not a
      // failed notice.
      return res.status(503).json({
        error: 'Unable to generate draft. Please try again.',
        audience: audience.description,
        recipientCount: audience.userIds.length,
      });
    }

    res.json({
      draft,
      audience: audience.description,
      recipientCount: audience.userIds.length,
    });
  }),
);

const sendSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  audience: audienceSchema,
  /** Whether the text came from a draft, and whether the human changed it. */
  aiAssisted: z.boolean().default(false),
  aiDraft: z.string().trim().max(8000).optional(),
});

// ── Send: the only endpoint that delivers anything. ─────────────────────────
router.post(
  '/send',
  validateBody(sendSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof sendSchema>;
    const sender = senderOf(req);

    // Recipients are derived here, never accepted from the client.
    const audience = await resolveAudience(sender, body.audience as AudienceSelection);
    if (audience.userIds.length === 0) {
      throw badRequest('That audience currently has no one in it.');
    }

    // Did the human change what the model wrote? Compared on trimmed text so
    // trailing whitespace is not reported as an edit.
    const teacherEdited = body.aiAssisted
      ? (body.aiDraft ?? '').trim() !== body.body.trim()
      : false;

    let delivered = 0;
    for (const userId of audience.userIds) {
      // Reuses the existing notification service: one row per recipient,
      // emitted over the same `notification:new` socket event every other
      // Meridian notification uses.
      //
      // The notice itself is the body. Both clients render title + body, and
      // nothing else in the app renders a notification action, so a notice
      // carried in an action field would be one a parent could never read.
      await notify({
        schoolId: sender.schoolId,
        userId,
        title: body.subject,
        body: body.body,
        severity: 'INFO',
        category: 'NOTICE',
      });
      delivered++;
    }

    const messageHash = createHash('sha256').update(body.body).digest('hex');

    // Permanent record: the approved notice, never the intermediate draft.
    await recordEvent({
      schoolId: sender.schoolId,
      type: 'NOTICE_SENT',
      aggregate: 'Notice',
      aggregateId: messageHash.slice(0, 24),
      payload: {
        actorRole: sender.role,
        recipientScope: audience.description,
        recipientCount: audience.userIds.length,
        subject: body.subject,
        notice: body.body,
        aiAssisted: body.aiAssisted,
        teacherEdited,
        messageHash,
        deliveryStatus: delivered === audience.userIds.length ? 'DELIVERED' : 'PARTIAL',
      },
      actorId: sender.sub,
      actorName: req.user!.name,
      reversible: false, // A delivered notice cannot be unsent.
    });

    // The AI ledger entry makes the assist visible and states plainly that a
    // human approved the text that went out.
    await logAI({
      schoolId: sender.schoolId,
      engine: 'NOTICE',
      action: 'School notice sent',
      reason: body.aiAssisted
        ? `AI drafted the notice; ${req.user!.name} ${teacherEdited ? 'edited and approved' : 'approved it unchanged'} before sending to ${audience.description}.`
        : `${req.user!.name} wrote and sent this notice to ${audience.description} without AI assistance.`,
      confidence: 1,
      output: {
        subject: body.subject,
        recipientScope: audience.description,
        recipientCount: audience.userIds.length,
        aiAssisted: body.aiAssisted,
        teacherEdited,
        messageHash,
      },
      actorId: sender.sub,
      reversible: false,
    });

    res.status(201).json({
      delivered,
      audience: audience.description,
      aiAssisted: body.aiAssisted,
      teacherEdited,
    });
  }),
);

export default router;

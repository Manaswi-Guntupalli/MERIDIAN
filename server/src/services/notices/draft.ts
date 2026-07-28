import { chatText } from '../../lib/openai.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI Notice — drafting.
//
// The member of staff supplies the facts; the model only rewrites them. It is
// explicitly forbidden from adding anything, because a notice that invents a
// date or a room is worse than no notice at all. Nothing here is persisted:
// a draft is a suggestion until a human approves it, and only the approved
// text reaches the ledger.
// ─────────────────────────────────────────────────────────────────────────────

export const NOTICE_TONES = ['Professional', 'Friendly', 'Urgent', 'Informative'] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

export const SYSTEM_PROMPT = [
  'You are an assistant helping school staff write school notices.',
  '',
  'Rules:',
  'Never invent information.',
  'Never invent dates.',
  'Never invent timings.',
  'Never invent names.',
  'Never invent classes.',
  'Never invent sections.',
  'Never invent subjects.',
  'Never invent events.',
  'Never invent homework.',
  'Only improve writing quality.',
  'Preserve all factual information.',
  '',
  'Improve: grammar, clarity, professionalism, structure.',
  'Keep the notice concise.',
  'Do not exaggerate.',
  'Do not add information.',
  'Never use fill-in placeholders such as [Your Name], [Your Position] or [Date].',
  'If you sign off, sign off as the sender given below and nobody else.',
  'Return ONLY the final notice.',
].join('\n');

export interface DraftRequest {
  subject: string;
  context: string;
  tone: NoticeTone;
  /** Who it is addressed to, so the salutation fits. Never a source of facts. */
  audience: string;
  /** Who is sending it, so the sign-off is real rather than "[Your Name]". */
  sender: string;
}

/**
 * Returns the drafted notice, or null when the model is unavailable or
 * unhelpful. Null is a first-class outcome: the caller reports "unable to
 * generate" and keeps the typed context, rather than inventing a draft.
 */
export async function draftNotice(input: DraftRequest): Promise<string | null> {
  const user = [
    `Audience: ${input.audience}`,
    `Sender: ${input.sender}`,
    `Tone: ${input.tone}`,
    `Subject: ${input.subject}`,
    '',
    'Facts to communicate (do not add to these):',
    input.context,
  ].join('\n');

  const text = await chatText(SYSTEM_PROMPT, user);
  const cleaned = text?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : null;
}

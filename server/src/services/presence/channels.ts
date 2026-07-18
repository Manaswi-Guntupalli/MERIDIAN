import { logAI } from '../trustLedger.js';

// Multi-channel parent notification dispatch. In-app + Socket.io
// (services/notifications.ts) is real today. No SMS/email/push provider is
// configured anywhere in this repo (no Twilio/SendGrid/FCM env vars), so —
// same resilience pattern the codebase already uses for OpenAI — each
// channel here is a real, typed seam that logs a structured "would send"
// entry into the Trust Ledger instead of silently doing nothing. Wiring a
// real provider later means implementing the body of these three functions;
// nothing else in Presence changes.

export interface ChannelMessage {
  schoolId: string;
  to: string; // phone / email / device token
  title: string;
  body: string;
}

export async function sendSms(msg: ChannelMessage): Promise<void> {
  await logAI({
    schoolId: msg.schoolId,
    engine: 'PRESENCE',
    action: 'SMS notification (stub — no SMS provider configured)',
    reason: 'Set an SMS provider (e.g. Twilio) to send this for real; the call site and payload are already wired.',
    output: { to: msg.to, title: msg.title, body: msg.body },
    reversible: false,
  });
}

export async function sendEmail(msg: ChannelMessage): Promise<void> {
  await logAI({
    schoolId: msg.schoolId,
    engine: 'PRESENCE',
    action: 'Email notification (stub — no email provider configured)',
    reason: 'Set an email provider (e.g. SendGrid/SES) to send this for real; the call site and payload are already wired.',
    output: { to: msg.to, title: msg.title, body: msg.body },
    reversible: false,
  });
}

export async function sendPush(msg: ChannelMessage): Promise<void> {
  await logAI({
    schoolId: msg.schoolId,
    engine: 'PRESENCE',
    action: 'Push notification (stub — no push provider configured)',
    reason: 'Set a push provider (e.g. FCM/APNs) to send this for real; the call site and payload are already wired.',
    output: { to: msg.to, title: msg.title, body: msg.body },
    reversible: false,
  });
}

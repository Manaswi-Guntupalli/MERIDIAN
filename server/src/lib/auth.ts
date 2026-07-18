import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string; // user id
  schoolId: string;
  role: string;
  name: string;
  /** Token version — must match the user row or the token is revoked.
   *  This single integer is what makes "log out everywhere", deactivation and
   *  password resets take effect immediately instead of at token expiry. */
  tv: number;
  /** Present only on impersonation tokens: who is really behind the wheel. */
  imp?: { id: string; name: string };
}

export function signToken(payload: JwtPayload, expiresIn?: string): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: (expiresIn ?? env.jwtExpiresIn) as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─────────────────────────  temporary passwords  ─────────────────────────

// Word-digit-word: "amber-52-falcon". Chosen over random hex because a school
// clerk reads these out over a phone or writes them on a slip — transcription
// failure is the real attack on usability. The credential is single-use in
// spirit: first login cannot proceed past the forced password change.
const WORDS = [
  'amber', 'aster', 'birch', 'cedar', 'coral', 'delta', 'ember', 'fable', 'falcon', 'fern',
  'garnet', 'hazel', 'indigo', 'jasper', 'juniper', 'lotus', 'maple', 'meadow', 'nectar', 'ochre',
  'onyx', 'opal', 'orchid', 'pearl', 'pebble', 'quartz', 'raven', 'sage', 'sierra', 'sparrow',
  'summit', 'tigris', 'topaz', 'tulip', 'velvet', 'walnut', 'willow', 'zephyr',
];

export function generateTempPassword(): string {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  const digits = crypto.randomInt(10, 100);
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-${digits}-${b}`;
}

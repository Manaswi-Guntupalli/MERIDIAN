import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, type JwtPayload } from '../lib/auth.js';
import { comparePassword } from '../lib/auth.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { STAFF } from '../utils/constants.js';

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Present when the request was authenticated as a device (reader
       *  API key) instead of a logged-in user — see authenticateReader. */
      reader?: { id: string; schoolId: string; name: string };
    }
  }
}

/**
 * Authentication now checks the LIVE account, not just the token's claims.
 *
 * A JWT is a snapshot: it says what was true at login. Deactivation, "log out
 * everywhere", password resets and role changes all happen *after* that
 * snapshot, and a system that only verifies signatures keeps honouring
 * credentials the school has already revoked. So every request pays one
 * indexed primary-key read (microseconds on SQLite) to confirm:
 *
 *   active        — deactivated accounts stop working mid-session, not at expiry
 *   tokenVersion  — bumping it on the user row revokes every token instantly
 *   role          — taken from the row, so a demotion applies to the next request
 *   mustChange    — a temp-credential holder can reach nothing but the
 *                   password-change endpoint until they set their own
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(unauthorized('Missing bearer token'));

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }

  void prisma.user
    .findUnique({
      where: { id: payload.sub },
      select: { active: true, tokenVersion: true, role: true, mustChangePassword: true, name: true },
    })
    .then((user) => {
      if (!user || !user.active) return next(unauthorized('This account has been deactivated.'));
      if (user.tokenVersion !== (payload.tv ?? 0)) {
        return next(unauthorized('Your session was signed out. Please log in again.'));
      }
      if (user.mustChangePassword && !isPasswordChangeExempt(req)) {
        // 428 Precondition Required — the client reads this status and routes
        // to the forced password-change screen.
        return next(new AppError(428, 'You must set a new password before continuing.'));
      }
      req.user = { ...payload, role: user.role, name: user.name };
      next();
    })
    .catch(next);
}

/** The only doors open to a temp-credential holder. */
function isPasswordChangeExempt(req: Request): boolean {
  const url = req.originalUrl.split('?')[0];
  return (
    url === '/api/auth/change-password' ||
    url === '/api/auth/me' ||
    url === '/api/auth/logout'
  );
}

// Restrict a route to specific roles.
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(forbidden(`Requires role: ${roles.join(', ')}`));
    }
    next();
  };
}

/**
 * Device authentication for RFID readers — the seam real hardware uses
 * instead of a user JWT. The reader id comes from the route param
 * (`:id/heartbeat`) or the request body (`/presence/scan`); the secret is
 * the `x-reader-key` header, checked against the bcrypt hash stored on the
 * reader row. Never trust a client-supplied schoolId — it comes from the
 * authenticated reader's own record.
 */
export function authenticateReader(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-reader-key'];
  const readerId = req.params.id || (req.body as { readerId?: string } | undefined)?.readerId;
  if (!key || typeof key !== 'string' || !readerId) return next(unauthorized('Missing reader credentials'));

  void prisma.rFIDReader
    .findUnique({ where: { id: readerId } })
    .then(async (reader) => {
      if (!reader) return next(unauthorized('Unknown reader'));
      const ok = await comparePassword(key, reader.apiKeyHash);
      if (!ok) return next(unauthorized('Invalid reader key'));
      req.reader = { id: reader.id, schoolId: reader.schoolId, name: reader.name };
      next();
    })
    .catch(next);
}

/**
 * Accepts EITHER a reader API key (device/simulator scanning) OR a staff
 * JWT (manual correction). Exactly one of req.reader / req.user is set for
 * the rest of the chain to branch on.
 */
export function authenticateReaderOrStaff(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-reader-key']) return authenticateReader(req, res, next);
  return authenticate(req, res, (err?: unknown) => {
    if (err) return next(err);
    return authorize(...STAFF)(req, res, next);
  });
}

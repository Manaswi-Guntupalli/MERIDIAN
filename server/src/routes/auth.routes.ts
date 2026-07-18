// Identity & access — login, sessions, credentials, impersonation.
//
// Design decisions worth stating:
//
//  · Lockout counts failures on the ACCOUNT, not the IP — the attack this
//    stops is someone guessing a specific child's password, and attackers
//    have many IPs while the account has one row. 5 misses = 15 minutes,
//    or an admin unlock.
//  · Every security-significant change (reset, lock, revoke, impersonation)
//    lands in the Trust ledger as an Event. Routine logins go to AuditLog —
//    still queryable, but they don't drown the Time Machine in noise.
//  · "Remember me" is the difference between a 12-hour and a 7-day token.
//  · Impersonation is SUPER_ADMIN-only, time-boxed to 1 hour, cannot target
//    another SUPER_ADMIN, and the token carries the impersonator's identity
//    so every audit row written during the session names the real actor.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { comparePassword, hashPassword, signToken, type JwtPayload } from '../lib/auth.js';
import { asyncHandler, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { validateBody } from '../utils/validate.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { auditLog } from '../services/trustLedger.js';
import { recordEvent } from '../services/eventStore.js';
import { ALL_ROLES, ROLES, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const SESSION_SHORT = '12h';
const SESSION_LONG = '7d';
const IMPERSONATION_TTL = '1h';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, rememberMe } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email }, include: { school: true } });

    // One generic message for "no such user" and "wrong password" — the
    // difference is exactly what an enumeration attacker wants to learn.
    if (!user || !user.active) throw unauthorized('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw unauthorized(`Account locked after repeated failed attempts. Try again in ${mins} min, or ask an admin to unlock it.`);
    }

    const ok = await comparePassword(password, user.password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const locking = failed >= MAX_FAILED;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: locking ? 0 : failed,
          ...(locking ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : {}),
        },
      });
      if (locking) {
        await recordEvent({
          schoolId: user.schoolId,
          type: 'ACCOUNT_LOCKED',
          aggregate: 'User',
          aggregateId: user.id,
          payload: { email: user.email, reason: `${MAX_FAILED} failed login attempts`, minutes: LOCK_MINUTES },
          reversible: false,
        });
        throw unauthorized(`Account locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED} failed attempts.`);
      }
      throw unauthorized('Invalid credentials');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), lastLoginIp: ip, failedLogins: 0, lockedUntil: null },
    });
    await auditLog({ schoolId: user.schoolId, actorId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, meta: { ip, rememberMe: Boolean(rememberMe) } });

    const token = signToken(
      { sub: user.id, schoolId: user.schoolId, role: user.role, name: user.name, tv: user.tokenVersion },
      rememberMe ? SESSION_LONG : SESSION_SHORT,
    );
    res.json({ token, user: publicUser(user), mustChangePassword: user.mustChangePassword });
  }),
);

// ─────────────────────────  password lifecycle  ─────────────────────────

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw unauthorized();

    const ok = await comparePassword(currentPassword, user.password);
    if (!ok) throw badRequest('Your current password is incorrect.');
    if (currentPassword === newPassword) throw badRequest('The new password must be different from the current one.');

    // Rotating the password revokes every other session (tokenVersion++) and
    // hands THIS device a fresh token — change your password on one device,
    // and a stolen phone's session dies with the old version.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } },
      include: { school: true },
    });

    await recordEvent({
      schoolId: user.schoolId,
      type: 'PASSWORD_CHANGED',
      aggregate: 'User',
      aggregateId: user.id,
      payload: { email: user.email, byTempCredential: user.mustChangePassword },
      actorId: user.id,
      actorName: user.name,
      reversible: false,
    });

    const token = signToken(
      { sub: updated.id, schoolId: updated.schoolId, role: updated.role, name: updated.name, tv: updated.tokenVersion },
      SESSION_SHORT,
    );
    res.json({ token, user: publicUser(updated) });
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await auditLog({ schoolId: req.user!.schoolId, actorId: req.user!.sub, action: 'LOGOUT', entity: 'User', entityId: req.user!.sub });
    res.json({ ok: true });
  }),
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    // Kill every session including this one; the client returns to the login
    // screen knowing nothing else in the world still holds a working token.
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { tokenVersion: { increment: 1 } },
    });
    await recordEvent({
      schoolId: user.schoolId,
      type: 'SESSIONS_REVOKED',
      aggregate: 'User',
      aggregateId: user.id,
      payload: { email: user.email, scope: 'all devices' },
      actorId: user.id,
      actorName: user.name,
      reversible: false,
    });
    res.json({ ok: true });
  }),
);

// ─────────────────────────  impersonation  ─────────────────────────

router.post(
  '/impersonate/:userId',
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    // The impersonation token must not be mintable *from* an impersonation
    // token — no chains, no laundering the real actor's identity.
    if (req.user!.imp) throw forbidden('Already impersonating — exit first.');

    const target = await prisma.user.findFirst({
      where: { id: req.params.userId, schoolId: req.user!.schoolId },
      include: { school: true },
    });
    if (!target) throw badRequest('User not found in your school.');
    if (target.role === ROLES.SUPER_ADMIN) throw forbidden('Super Admin accounts cannot be impersonated.');
    if (!target.active) throw badRequest('This account is deactivated — activate it first.');

    await recordEvent({
      schoolId: target.schoolId,
      type: 'IMPERSONATION_STARTED',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { target: target.email, targetRole: target.role },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });

    const payload: JwtPayload = {
      sub: target.id,
      schoolId: target.schoolId,
      role: target.role,
      name: target.name,
      tv: target.tokenVersion,
      imp: { id: req.user!.sub, name: req.user!.name },
    };
    res.json({
      token: signToken(payload, IMPERSONATION_TTL),
      user: { ...publicUser(target), impersonator: payload.imp },
      expiresIn: IMPERSONATION_TTL,
    });
  }),
);

// ─────────────────────────  provisioning  ─────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
});

/**
 * Provisioning a user is an ADMINISTRATIVE action, never public self-signup.
 * Cardinality is enforced here, where records are made — not in the UI:
 * exactly one SUPER_ADMIN exists, and each school has exactly one PRINCIPAL.
 */
router.post(
  '/register',
  authenticate,
  authorize(...STAFF_ADMIN),
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const actor = req.user!;

    if (body.role === ROLES.SUPER_ADMIN) {
      throw forbidden('There is exactly one Super Admin. Additional Super Admin accounts cannot be created.');
    }
    if (body.role === ROLES.PRINCIPAL) {
      const existing = await prisma.user.findFirst({
        where: { schoolId: actor.schoolId, role: ROLES.PRINCIPAL, active: true },
        select: { name: true },
      });
      if (existing) {
        throw badRequest(`This school already has a principal (${existing.name}). A school has exactly one principal — transfer the role instead.`);
      }
      if (actor.role !== ROLES.SUPER_ADMIN) throw forbidden('Only the Super Admin can appoint a principal.');
    }
    if (body.role === ROLES.ADMIN && actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.PRINCIPAL) {
      throw forbidden('Only the Super Admin or the principal can create admin accounts.');
    }

    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw badRequest('Email already registered');

    const user = await prisma.user.create({
      data: {
        schoolId: actor.schoolId, // scoped to the caller's school — not client input
        email: body.email,
        password: await hashPassword(body.password),
        name: body.name,
        role: body.role,
        mustChangePassword: true, // admin-set passwords are temporary by definition
      },
      include: { school: true },
    });
    await auditLog({
      schoolId: actor.schoolId,
      actorId: actor.sub,
      action: 'CREATE_USER',
      entity: 'User',
      entityId: user.id,
      meta: { role: user.role, email: user.email },
    });
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      include: { school: true, teacher: true, student: { include: { class: true } }, parent: true },
    });
    if (!user) throw unauthorized();
    res.json({
      user: {
        ...publicUser(user),
        impersonator: req.user!.imp,
      },
      mustChangePassword: user.mustChangePassword,
    });
  }),
);

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    avatarUrl: u.avatarUrl,
    phone: u.phone,
    schoolId: u.schoolId,
    mustChangePassword: u.mustChangePassword,
    school: u.school ? { id: u.school.id, name: u.school.name, code: u.school.code } : undefined,
    teacher: u.teacher ?? undefined,
    student: u.student ?? undefined,
    parent: u.parent ?? undefined,
  };
}

export default router;

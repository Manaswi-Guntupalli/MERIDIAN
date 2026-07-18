// User management — the admin's side of identity.
//
// The rule that governs everything here is the MANAGEMENT HIERARCHY:
//
//   SUPER_ADMIN  manages everyone (except deleting/demoting itself — the
//                system guarantees exactly one, forever reachable)
//   PRINCIPAL    manages admins, teachers, students, parents in their school
//   ADMIN        manages teachers, students, parents
//
// Nobody manages upward, nobody manages themselves into a corner, and every
// action lands in the Trust ledger. UI hiding is never the enforcement —
// these checks are.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { hashPassword, generateTempPassword } from '../lib/auth.js';
import { recordEvent } from '../services/eventStore.js';
import { auditLog } from '../services/trustLedger.js';
import { ROLES, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF_ADMIN));

/** May `actorRole` manage an account of `targetRole`? */
function canManage(actorRole: string, targetRole: string): boolean {
  if (targetRole === ROLES.SUPER_ADMIN) return false; // nobody manages the root account
  if (actorRole === ROLES.SUPER_ADMIN) return true;
  if (actorRole === ROLES.PRINCIPAL) return targetRole !== ROLES.PRINCIPAL;
  if (actorRole === ROLES.ADMIN) {
    return [ROLES.TEACHER, ROLES.STUDENT, ROLES.PARENT].includes(targetRole as never);
  }
  return false;
}

/** Load a target inside the actor's school and verify the hierarchy allows it. */
async function manageable(req: { user?: { schoolId: string; role: string; sub: string } }, id: string) {
  const target = await prisma.user.findFirst({ where: { id, schoolId: req.user!.schoolId } });
  if (!target) throw notFound('User not found in your school');
  if (target.id === req.user!.sub) throw badRequest('Use your profile settings to manage your own account.');
  if (!canManage(req.user!.role, target.role)) {
    throw forbidden(`Your role cannot manage ${target.role.toLowerCase().replace('_', ' ')} accounts.`);
  }
  return target;
}

// ─────────────────────────────  listing  ─────────────────────────────

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, q, status } = req.query as { role?: string; q?: string; status?: string };
    const users = await prisma.user.findMany({
      where: {
        schoolId: req.user!.schoolId,
        ...(role ? { role } : {}),
        ...(status === 'active' ? { active: true } : status === 'inactive' ? { active: false } : {}),
        ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      take: 500,
      include: {
        teacher: { select: { employeeId: true, department: true } },
        student: { select: { admissionNo: true, class: { select: { name: true } } } },
        parent: { select: { children: { select: { student: { select: { name: true } } } } } },
      },
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        phone: u.phone,
        lastLogin: u.lastLogin,
        lastLoginIp: u.lastLoginIp,
        locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
        mustChangePassword: u.mustChangePassword,
        createdAt: u.createdAt,
        // The line that makes the row meaningful at a glance:
        detail:
          u.teacher ? `${u.teacher.employeeId} · ${u.teacher.department}`
          : u.student ? `${u.student.admissionNo}${u.student.class ? ` · ${u.student.class.name}` : ''}`
          : u.parent?.children.length ? `Parent of ${u.parent.children.map((c) => c.student.name).join(', ')}`
          : null,
        manageable: u.id !== req.user!.sub && canManage(req.user!.role, u.role),
      })),
    });
  }),
);

// ─────────────────────────────  actions  ─────────────────────────────

router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const target = await manageable(req, req.params.id);
    const tempPassword = generateTempPassword();
    await prisma.user.update({
      where: { id: target.id },
      data: {
        password: await hashPassword(tempPassword),
        mustChangePassword: true,
        tokenVersion: { increment: 1 }, // every existing session dies with the old password
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await recordEvent({
      schoolId: target.schoolId,
      type: 'PASSWORD_RESET',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { email: target.email, forRole: target.role },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    // The temp password appears exactly once, in this response. It is not
    // stored anywhere in plaintext and not logged.
    res.json({ tempPassword, email: target.email, name: target.name });
  }),
);

router.post(
  '/:id/deactivate',
  asyncHandler(async (req, res) => {
    const target = await manageable(req, req.params.id);
    if (target.role === ROLES.PRINCIPAL && req.user!.role !== ROLES.SUPER_ADMIN) {
      throw forbidden('Only the Super Admin can deactivate a principal.');
    }
    await prisma.user.update({
      where: { id: target.id },
      // tokenVersion++ makes deactivation immediate: their next request 401s,
      // not their next login.
      data: { active: false, tokenVersion: { increment: 1 } },
    });
    await recordEvent({
      schoolId: target.schoolId,
      type: 'ACCOUNT_DEACTIVATED',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { email: target.email, role: target.role },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    const target = await manageable(req, req.params.id);
    await prisma.user.update({ where: { id: target.id }, data: { active: true, failedLogins: 0, lockedUntil: null } });
    await recordEvent({
      schoolId: target.schoolId,
      type: 'ACCOUNT_ACTIVATED',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { email: target.email, role: target.role },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/unlock',
  asyncHandler(async (req, res) => {
    const target = await manageable(req, req.params.id);
    await prisma.user.update({ where: { id: target.id }, data: { failedLogins: 0, lockedUntil: null } });
    await auditLog({
      schoolId: target.schoolId,
      actorId: req.user!.sub,
      action: 'ACCOUNT_UNLOCKED',
      entity: 'User',
      entityId: target.id,
      meta: { email: target.email },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/logout-all',
  asyncHandler(async (req, res) => {
    const target = await manageable(req, req.params.id);
    await prisma.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
    await recordEvent({
      schoolId: target.schoolId,
      type: 'SESSIONS_REVOKED',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { email: target.email, scope: 'all devices', by: 'admin' },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    res.json({ ok: true });
  }),
);

const roleSchema = z.object({
  role: z.enum([ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT, ROLES.PARENT] as [string, ...string[]]),
});
router.patch(
  '/:id/role',
  authorize(ROLES.SUPER_ADMIN, ROLES.PRINCIPAL),
  asyncHandler(async (req, res) => {
    const { role } = roleSchema.parse(req.body);
    const target = await manageable(req, req.params.id);
    // SUPER_ADMIN and PRINCIPAL are excluded from the schema on purpose:
    // singleton roles are appointed through their own guarded flows, never
    // through a generic dropdown.
    const before = target.role;
    await prisma.user.update({ where: { id: target.id }, data: { role, tokenVersion: { increment: 1 } } });
    await recordEvent({
      schoolId: target.schoolId,
      type: 'ROLE_CHANGED',
      aggregate: 'User',
      aggregateId: target.id,
      payload: { email: target.email, from: before, to: role },
      actorId: req.user!.sub,
      actorName: req.user!.name,
      reversible: false,
    });
    res.json({ ok: true });
  }),
);

export default router;

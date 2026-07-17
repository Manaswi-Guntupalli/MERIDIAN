import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { asyncHandler, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { validateBody } from '../utils/validate.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { auditLog } from '../services/trustLedger.js';
import { ALL_ROLES, ROLES, STAFF_ADMIN } from '../utils/constants.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
});

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email }, include: { school: true } });
    if (!user || !user.active) throw unauthorized('Invalid credentials');
    const ok = await comparePassword(password, user.password);
    if (!ok) throw unauthorized('Invalid credentials');

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await auditLog({ schoolId: user.schoolId, actorId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id });

    const token = signToken({ sub: user.id, schoolId: user.schoolId, role: user.role, name: user.name });
    res.json({ token, user: publicUser(user) });
  }),
);

/**
 * Provisioning a user is an ADMINISTRATIVE action, never public self-signup.
 * Previously anyone who knew a school code could mint themselves SUPER_ADMIN.
 * Now: caller must be an authenticated admin, the new user is always created
 * inside the CALLER's school (never a client-supplied one), and only a
 * SUPER_ADMIN may create another SUPER_ADMIN (no privilege escalation).
 */
router.post(
  '/register',
  authenticate,
  authorize(...STAFF_ADMIN),
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const actor = req.user!;

    if (body.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      throw forbidden('Only a Super Admin can create another Super Admin');
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
    res.json({ user: publicUser(user) });
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
    school: u.school ? { id: u.school.id, name: u.school.name, code: u.school.code } : undefined,
    teacher: u.teacher ?? undefined,
    student: u.student ?? undefined,
    parent: u.parent ?? undefined,
  };
}

export default router;

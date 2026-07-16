import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { asyncHandler, badRequest, unauthorized } from '../lib/errors.js';
import { validateBody } from '../utils/validate.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/trustLedger.js';
import { ALL_ROLES } from '../utils/constants.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
  schoolCode: z.string().min(1),
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

router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const school = await prisma.school.findUnique({ where: { code: body.schoolCode } });
    if (!school) throw badRequest('Unknown school code');
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw badRequest('Email already registered');

    const user = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: body.email,
        password: await hashPassword(body.password),
        name: body.name,
        role: body.role,
      },
      include: { school: true },
    });
    const token = signToken({ sub: user.id, schoolId: user.schoolId, role: user.role, name: user.name });
    res.status(201).json({ token, user: publicUser(user) });
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

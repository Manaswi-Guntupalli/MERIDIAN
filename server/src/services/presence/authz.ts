import { prisma } from '../../lib/prisma.js';
import { forbidden } from '../../lib/errors.js';

// "Teacher: Manual Corrections (only own class)" — Principal/Admin bypass
// this entirely (checked by the caller before reaching here); a TEACHER may
// only correct attendance for the class where they are the class teacher.
export async function assertOwnClass(user: { sub: string; role: string }, classTeacherId: string | null | undefined) {
  if (user.role !== 'TEACHER') return;
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.sub } });
  if (!teacher || classTeacherId !== teacher.id) {
    throw forbidden('Teachers may only correct attendance for their own class');
  }
}

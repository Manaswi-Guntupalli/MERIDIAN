import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, signToken } from '../src/lib/auth.js';

/**
 * Every test builds its own School-scoped fixture with a random suffix.
 * Since virtually every query in this codebase is schoolId-scoped, distinct
 * fixtures never interfere with each other even though they share one
 * SQLite file — no truncate-between-tests machinery needed.
 */
export async function createFixture() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const school = await prisma.school.create({ data: { name: `Test School ${suffix}`, code: `TST-${suffix}` } });
  const hash = await hashPassword('password123');

  const mkUser = (role: string, label: string) =>
    prisma.user.create({ data: { schoolId: school.id, email: `${label}-${suffix}@test.school`, password: hash, name: `${label} ${suffix}`, role } });

  const [principalUser, adminUser, teacherUser, otherTeacherUser, parentUser, studentUser] = await Promise.all([
    mkUser('PRINCIPAL', 'principal'),
    mkUser('ADMIN', 'admin'),
    mkUser('TEACHER', 'teacher'),
    mkUser('TEACHER', 'other-teacher'),
    mkUser('PARENT', 'parent'),
    mkUser('STUDENT', 'student'),
  ]);

  const teacher = await prisma.teacher.create({ data: { schoolId: school.id, userId: teacherUser.id, employeeId: `T-${suffix}`, department: 'General' } });
  const otherTeacher = await prisma.teacher.create({ data: { schoolId: school.id, userId: otherTeacherUser.id, employeeId: `T2-${suffix}`, department: 'General' } });

  const cls = await prisma.class.create({ data: { schoolId: school.id, grade: 6, section: 'A', name: `6A-${suffix}`, classTeacherId: teacher.id } });
  const otherClass = await prisma.class.create({ data: { schoolId: school.id, grade: 7, section: 'A', name: `7A-${suffix}`, classTeacherId: otherTeacher.id } });

  const student = await prisma.student.create({
    data: { schoolId: school.id, userId: studentUser.id, admissionNo: `ADM-${suffix}`, rollNo: 1, name: `Test Student ${suffix}`, classId: cls.id },
  });
  const studentInOtherClass = await prisma.student.create({
    data: { schoolId: school.id, admissionNo: `ADM2-${suffix}`, rollNo: 1, name: `Other Class Student ${suffix}`, classId: otherClass.id },
  });

  const parent = await prisma.parent.create({ data: { schoolId: school.id, userId: parentUser.id, relation: 'Guardian' } });
  await prisma.studentParent.create({ data: { studentId: student.id, parentId: parent.id } });

  const tokenFor = (user: { id: string; role: string; name: string }) => signToken({ sub: user.id, schoolId: school.id, role: user.role, name: user.name, tv: 0 });

  return {
    suffix,
    school,
    principal: { user: principalUser, token: tokenFor(principalUser) },
    admin: { user: adminUser, token: tokenFor(adminUser) },
    teacher: { user: teacherUser, teacher, token: tokenFor(teacherUser) },
    otherTeacher: { user: otherTeacherUser, teacher: otherTeacher, token: tokenFor(otherTeacherUser) },
    parent: { user: parentUser, parent, token: tokenFor(parentUser) },
    student: { ...student, userToken: tokenFor(studentUser) },
    studentInOtherClass,
    class: cls,
    otherClass,
  };
}

/** Enroll a synthetic face template for a subject (tests can't run a camera). */
export async function enrollTestFace(schoolId: string, subjectType: 'STUDENT' | 'TEACHER', subjectId: string, name: string, vector: number[]) {
  const enrollment = await prisma.faceEnrollment.upsert({
    where: { subjectType_subjectId: { subjectType, subjectId } },
    create: { schoolId, subjectType, subjectId, name, model: 'insightface-buffalo_l' },
    update: {},
  });
  await prisma.faceEmbedding.create({
    data: { schoolId, enrollmentId: enrollment.id, subjectType, subjectId, name, vectorString: JSON.stringify(vector), model: 'insightface-buffalo_l', dim: 512, label: 'front', quality: 0.9 },
  });
  if (subjectType === 'STUDENT') await prisma.student.update({ where: { id: subjectId }, data: { faceEnrolled: true, faceCount: 1 } });
}

/** A synthetic 512-D unit vector, seeded. */
export function unitVector(seed: number, dim = 512): number[] {
  const v: number[] = [];
  let h = (seed * 2654435761) >>> 0;
  for (let i = 0; i < dim; i++) {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + i) >>> 0;
    v.push((h / 0xffffffff) * 2 - 1);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function recapture(vec: number[], sigma = 0.02): number[] {
  const v = vec.map((x) => x + (Math.random() * 2 - 1) * sigma);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

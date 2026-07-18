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

  const readerApiKey = `test-key-${suffix}`;
  const reader = await prisma.rFIDReader.create({
    data: { schoolId: school.id, name: `Gate ${suffix}`, location: 'Test Gate', direction: 'BOTH', online: true, lastHeartbeat: new Date(), apiKeyHash: await hashPassword(readerApiKey) },
  });
  const offlineReader = await prisma.rFIDReader.create({
    data: { schoolId: school.id, name: `Offline Gate ${suffix}`, location: 'Offline Gate', direction: 'BOTH', online: false, apiKeyHash: await hashPassword('unused') },
  });

  const card = await prisma.rFIDCard.create({ data: { schoolId: school.id, studentId: student.id, uid: `UID-${suffix}-1`, status: 'ACTIVE' } });

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
    reader,
    readerApiKey,
    offlineReader,
    card,
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

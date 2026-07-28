import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import {
  audiencesFor,
  canSendNotices,
  hasSchoolWideReach,
  resolveAudience,
  teacherClassIds,
  type Sender,
} from './audience.js';

// ─────────────────────────────────────────────────────────────────────────────
// AI Notice permissions, against a real (test) database.
//
// This is the security boundary of the feature: the client picks an audience,
// but the server decides who — if anyone — that means. A teacher must never be
// able to reach beyond their own classes, however the request is shaped.
// ─────────────────────────────────────────────────────────────────────────────

let schoolId = '';
let principal: Sender;
let classTeacher: Sender;     // class teacher of 6A
let subjectTeacher: Sender;   // teaches 7A in the timetable, leads nothing
let strangerTeacher: Sender;  // teaches nothing at all
let parent: Sender;
let class6A = '';
let class7A = '';

/** Every student in a class, plus one linked guardian each. */
async function seedClass(name: string, grade: number, count: number, teacherId?: string) {
  const cls = await prisma.class.create({
    data: { schoolId, grade, section: 'A', name, classTeacherId: teacherId },
  });
  for (let i = 1; i <= count; i++) {
    const studentUser = await prisma.user.create({
      data: { schoolId, email: `stu-${name}-${i}-${Date.now()}@t.local`, password: 'x', name: `S${i}`, role: 'STUDENT' },
    });
    const student = await prisma.student.create({
      data: {
        schoolId, classId: cls.id, userId: studentUser.id,
        name: `Student ${name}${i}`, admissionNo: `AD-${name}-${i}-${Date.now()}`, rollNo: i,
      },
    });
    const parentUser = await prisma.user.create({
      data: { schoolId, email: `par-${name}-${i}-${Date.now()}@t.local`, password: 'x', name: `P${i}`, role: 'PARENT' },
    });
    const p = await prisma.parent.create({ data: { schoolId, userId: parentUser.id, relation: 'Guardian' } });
    await prisma.studentParent.create({ data: { studentId: student.id, parentId: p.id } });
  }
  return cls.id;
}

async function seedTeacher(name: string): Promise<{ sender: Sender; teacherId: string }> {
  const user = await prisma.user.create({
    data: { schoolId, email: `t-${name}-${Date.now()}@t.local`, password: 'x', name, role: 'TEACHER' },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId, userId: user.id, employeeId: `E-${name}-${Date.now()}`, department: 'General' },
  });
  return {
    sender: { sub: user.id, role: 'TEACHER', schoolId },
    teacherId: teacher.id,
  };
}

beforeAll(async () => {
  const school = await prisma.school.create({
    data: { name: 'Notice Test School', code: `NT-${Date.now()}` },
  });
  schoolId = school.id;

  const principalUser = await prisma.user.create({
    data: { schoolId, email: `pri-${Date.now()}@t.local`, password: 'x', name: 'Principal', role: 'PRINCIPAL' },
  });
  principal = { sub: principalUser.id, role: 'PRINCIPAL', schoolId };

  const ct = await seedTeacher('ClassTeacher');
  classTeacher = ct.sender;
  const st = await seedTeacher('SubjectTeacher');
  subjectTeacher = st.sender;
  strangerTeacher = (await seedTeacher('Stranger')).sender;

  class6A = await seedClass('6A', 6, 3, ct.teacherId);
  class7A = await seedClass('7A', 7, 2);

  // The subject teacher reaches 7A only through the published timetable.
  const subject = await prisma.subject.create({
    data: { schoolId, name: 'Chemistry', code: `CHEM-${Date.now()}`, color: '#0E7C6B' },
  });
  const timetable = await prisma.timetable.create({
    data: { schoolId, name: 'V1', status: 'PUBLISHED', version: 1, active: true, score: 90 },
  });
  await prisma.timetableSlot.create({
    data: { timetableId: timetable.id, day: 0, period: 1, classId: class7A, subjectId: subject.id, teacherId: st.teacherId },
  });

  const parentUser = await prisma.user.create({
    data: { schoolId, email: `p-${Date.now()}@t.local`, password: 'x', name: 'Parent', role: 'PARENT' },
  });
  parent = { sub: parentUser.id, role: 'PARENT', schoolId };
});

describe('who may use AI Notice at all', () => {
  it('staff who send notices are allowed', () => {
    expect(canSendNotices('PRINCIPAL')).toBe(true);
    expect(canSendNotices('ADMIN')).toBe(true);
    expect(canSendNotices('SUPER_ADMIN')).toBe(true);
    expect(canSendNotices('TEACHER')).toBe(true);
  });

  it('families never can', () => {
    expect(canSendNotices('STUDENT')).toBe(false);
    expect(canSendNotices('PARENT')).toBe(false);
  });

  it('school-wide reach is administrative only', () => {
    expect(hasSchoolWideReach('PRINCIPAL')).toBe(true);
    expect(hasSchoolWideReach('ADMIN')).toBe(true);
    expect(hasSchoolWideReach('TEACHER')).toBe(false);
  });
});

describe('the audiences offered to each role', () => {
  it('a principal is offered school, grade and class', async () => {
    const scopes = (await audiencesFor(principal)).map((a) => a.scope);
    expect(scopes).toEqual(['SCHOOL', 'GRADE', 'CLASS']);
  });

  it('a principal may address staff', async () => {
    const school = (await audiencesFor(principal)).find((a) => a.scope === 'SCHOOL')!;
    expect(school.recipients).toContain('TEACHERS');
  });

  it('a teacher is offered classes only — never school or grade', async () => {
    const scopes = (await audiencesFor(classTeacher)).map((a) => a.scope);
    expect(scopes).toEqual(['CLASS']);
  });

  it('a teacher is never offered a staff broadcast', async () => {
    const opts = await audiencesFor(classTeacher);
    expect(opts.flatMap((a) => a.recipients)).not.toContain('TEACHERS');
  });

  it('a teacher sees the class they lead', async () => {
    const cls = (await audiencesFor(classTeacher))[0];
    expect(cls.options.map((o) => o.id)).toContain(class6A);
  });

  it('a teacher sees a class they only teach in the timetable', async () => {
    const cls = (await audiencesFor(subjectTeacher))[0];
    expect(cls.options.map((o) => o.id)).toContain(class7A);
  });

  it('a teacher with no classes is offered nothing', async () => {
    expect(await audiencesFor(strangerTeacher)).toEqual([]);
  });

  it('a parent is offered nothing', async () => {
    expect(await audiencesFor(parent)).toEqual([]);
  });
});

describe('teacher scope resolution', () => {
  it('unions classes led and classes taught', async () => {
    expect(await teacherClassIds(classTeacher)).toEqual([class6A]);
    expect(await teacherClassIds(subjectTeacher)).toEqual([class7A]);
  });

  it('a user with no teacher record has no classes', async () => {
    expect(await teacherClassIds(parent)).toEqual([]);
  });
});

describe('resolving an audience to real recipients', () => {
  it('a class + students reaches exactly that class', async () => {
    const out = await resolveAudience(principal, {
      scope: 'CLASS', scopeId: class6A, recipients: 'STUDENTS',
    });
    expect(out.userIds).toHaveLength(3);
    expect(out.description).toContain('6A');
  });

  it('parents-only reaches guardians, not students', async () => {
    const students = await resolveAudience(principal, {
      scope: 'CLASS', scopeId: class6A, recipients: 'STUDENTS',
    });
    const parents = await resolveAudience(principal, {
      scope: 'CLASS', scopeId: class6A, recipients: 'PARENTS',
    });
    expect(parents.userIds).toHaveLength(3);
    expect(parents.userIds.some((id) => students.userIds.includes(id))).toBe(false);
  });

  it('both reaches students and guardians together', async () => {
    const out = await resolveAudience(principal, {
      scope: 'CLASS', scopeId: class6A, recipients: 'BOTH',
    });
    expect(out.userIds).toHaveLength(6);
  });

  it('a grade reaches only that grade', async () => {
    const out = await resolveAudience(principal, {
      scope: 'GRADE', scopeId: '7', recipients: 'STUDENTS',
    });
    expect(out.userIds).toHaveLength(2);
    expect(out.description).toContain('Grade 7');
  });

  it('the whole school reaches every class', async () => {
    const out = await resolveAudience(principal, {
      scope: 'SCHOOL', recipients: 'STUDENTS',
    });
    expect(out.userIds).toHaveLength(5); // 3 in 6A + 2 in 7A
  });

  it('a staff notice reaches teachers', async () => {
    const out = await resolveAudience(principal, {
      scope: 'SCHOOL', recipients: 'TEACHERS',
    });
    expect(out.userIds.length).toBeGreaterThanOrEqual(3);
    expect(out.description).toBe('All teaching staff');
  });

  it('recipient ids are unique even when a guardian has two children', async () => {
    const out = await resolveAudience(principal, { scope: 'SCHOOL', recipients: 'BOTH' });
    expect(new Set(out.userIds).size).toBe(out.userIds.length);
  });
});

describe('a teacher cannot over-reach, however the request is shaped', () => {
  it('school-wide is refused', async () => {
    await expect(
      resolveAudience(classTeacher, { scope: 'SCHOOL', recipients: 'STUDENTS' }),
    ).rejects.toThrow(/own classes/i);
  });

  it('grade-wide is refused', async () => {
    await expect(
      resolveAudience(classTeacher, { scope: 'GRADE', scopeId: '6', recipients: 'STUDENTS' }),
    ).rejects.toThrow(/own classes/i);
  });

  it('a class they do not teach is refused', async () => {
    await expect(
      resolveAudience(classTeacher, { scope: 'CLASS', scopeId: class7A, recipients: 'STUDENTS' }),
    ).rejects.toThrow(/classes you teach/i);
  });

  it('a staff broadcast is refused', async () => {
    await expect(
      resolveAudience(classTeacher, { scope: 'CLASS', scopeId: class6A, recipients: 'TEACHERS' }),
    ).rejects.toThrow(/may not send notices to staff/i);
  });

  it('their own class is allowed', async () => {
    const out = await resolveAudience(classTeacher, {
      scope: 'CLASS', scopeId: class6A, recipients: 'BOTH',
    });
    expect(out.userIds).toHaveLength(6);
  });

  it('a class reached only through the timetable is allowed', async () => {
    const out = await resolveAudience(subjectTeacher, {
      scope: 'CLASS', scopeId: class7A, recipients: 'STUDENTS',
    });
    expect(out.userIds).toHaveLength(2);
  });
});

describe('families are refused outright', () => {
  it('a parent cannot resolve any audience', async () => {
    await expect(
      resolveAudience(parent, { scope: 'CLASS', scopeId: class6A, recipients: 'STUDENTS' }),
    ).rejects.toThrow(/cannot send school notices/i);
  });

  it('a student cannot either', async () => {
    await expect(
      resolveAudience({ sub: 'x', role: 'STUDENT', schoolId }, { scope: 'SCHOOL', recipients: 'BOTH' }),
    ).rejects.toThrow(/cannot send school notices/i);
  });
});

describe('malformed selections are rejected, not guessed', () => {
  it('a class scope with no class id', async () => {
    await expect(
      resolveAudience(principal, { scope: 'CLASS', recipients: 'STUDENTS' }),
    ).rejects.toThrow(/class must be selected/i);
  });

  it('a grade scope with a non-numeric grade', async () => {
    await expect(
      resolveAudience(principal, { scope: 'GRADE', scopeId: 'six', recipients: 'STUDENTS' }),
    ).rejects.toThrow(/grade must be selected/i);
  });

  it('a class from another school', async () => {
    const other = await prisma.school.create({
      data: { name: 'Other', code: `OT-${Date.now()}` },
    });
    const foreign = await prisma.class.create({
      data: { schoolId: other.id, grade: 6, section: 'A', name: '6A' },
    });
    await expect(
      resolveAudience(principal, { scope: 'CLASS', scopeId: foreign.id, recipients: 'STUDENTS' }),
    ).rejects.toThrow(/not in your school/i);
  });

  it('a staff notice scoped to a class is rejected as incoherent', async () => {
    await expect(
      resolveAudience(principal, { scope: 'CLASS', scopeId: class6A, recipients: 'TEACHERS' }),
    ).rejects.toThrow(/school-wide/i);
  });
});

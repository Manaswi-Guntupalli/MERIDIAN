import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { ROLES, type Role } from '../../utils/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Who a member of staff is allowed to address, and who that resolves to.
//
// The client is never trusted with this. It asks what it may send to (so the
// UI can offer only valid choices), but every send re-derives the audience and
// its recipients here from the sender's own role and assignments. A teacher
// cannot broadcast school-wide by posting a hand-made payload.
// ─────────────────────────────────────────────────────────────────────────────

/** Who the notice is about. */
export type NoticeScope = 'SCHOOL' | 'GRADE' | 'CLASS';

/** Which people inside that scope receive it. */
export type NoticeRecipients = 'STUDENTS' | 'PARENTS' | 'BOTH' | 'TEACHERS';

export interface AudienceSelection {
  scope: NoticeScope;
  /** Grade number for GRADE, class id for CLASS, absent for SCHOOL. */
  scopeId?: string;
  recipients: NoticeRecipients;
}

export interface Sender {
  sub: string;
  role: Role;
  schoolId: string;
}

/** A scope the sender may choose, with the concrete options inside it. */
export interface AudienceOption {
  scope: NoticeScope;
  label: string;
  /** Selectable values for this scope (empty for SCHOOL). */
  options: { id: string; label: string }[];
  /** Recipient groups valid for this scope, for this sender. */
  recipients: NoticeRecipients[];
}

const ADMIN_ROLES: Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL];

/** School-wide reach: principals and admins only, never teachers. */
export function hasSchoolWideReach(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Whether this role may use the notice feature at all. */
export function canSendNotices(role: Role): boolean {
  return hasSchoolWideReach(role) || role === ROLES.TEACHER;
}

/**
 * The classes a teacher may address: the ones they are class teacher of, plus
 * the ones they actually teach in the published timetable ("students of their
 * subjects"). Same two sources the teacher dashboard already derives its
 * scope from.
 */
export async function teacherClassIds(sender: Sender): Promise<string[]> {
  const teacher = await prisma.teacher.findFirst({
    where: { schoolId: sender.schoolId, userId: sender.sub },
    select: { id: true },
  });
  if (!teacher) return [];

  const [led, slots] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId: sender.schoolId, classTeacherId: teacher.id },
      select: { id: true },
    }),
    prisma.timetableSlot.findMany({
      where: { timetable: { schoolId: sender.schoolId, active: true }, teacherId: teacher.id },
      select: { classId: true },
      distinct: ['classId'],
    }),
  ]);

  return [...new Set([...led.map((c) => c.id), ...slots.map((s) => s.classId)])];
}

/**
 * The audiences this sender may choose from — the shape the UI renders. A
 * teacher only ever sees their own classes; the school-wide and grade scopes
 * are simply absent for them rather than shown and rejected.
 */
export async function audiencesFor(sender: Sender): Promise<AudienceOption[]> {
  if (!canSendNotices(sender.role)) return [];

  if (hasSchoolWideReach(sender.role)) {
    const classes = await prisma.class.findMany({
      where: { schoolId: sender.schoolId },
      select: { id: true, name: true, grade: true },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });
    const grades = [...new Set(classes.map((c) => c.grade))].sort((a, b) => a - b);

    return [
      {
        scope: 'SCHOOL',
        label: 'Entire school',
        options: [],
        recipients: ['STUDENTS', 'PARENTS', 'BOTH', 'TEACHERS'],
      },
      {
        scope: 'GRADE',
        label: 'A grade',
        options: grades.map((g) => ({ id: String(g), label: `Grade ${g}` })),
        recipients: ['STUDENTS', 'PARENTS', 'BOTH'],
      },
      {
        scope: 'CLASS',
        label: 'A class',
        options: classes.map((c) => ({ id: c.id, label: c.name })),
        recipients: ['STUDENTS', 'PARENTS', 'BOTH'],
      },
    ];
  }

  // Teacher: classes only. No school-wide, no grade-wide, no staff broadcast.
  const ids = await teacherClassIds(sender);
  if (ids.length === 0) return [];
  const classes = await prisma.class.findMany({
    where: { schoolId: sender.schoolId, id: { in: ids } },
    select: { id: true, name: true },
    orderBy: [{ grade: 'asc' }, { section: 'asc' }],
  });

  return [
    {
      scope: 'CLASS',
      label: 'A class you teach',
      options: classes.map((c) => ({ id: c.id, label: c.name })),
      recipients: ['STUDENTS', 'PARENTS', 'BOTH'],
    },
  ];
}

/** A resolved audience: the user ids to notify and how to describe the reach. */
export interface ResolvedAudience {
  userIds: string[];
  /** Human description stored in the ledger, e.g. "Class 6A · students and parents". */
  description: string;
}

/**
 * Validate the selection against the sender's permissions and resolve it to
 * concrete recipients. Throws rather than silently narrowing, so an attempt to
 * over-reach is a visible 403 rather than a quietly smaller send.
 */
export async function resolveAudience(
  sender: Sender,
  selection: AudienceSelection,
): Promise<ResolvedAudience> {
  if (!canSendNotices(sender.role)) {
    throw forbidden('Your role cannot send school notices.');
  }

  const admin = hasSchoolWideReach(sender.role);
  if (!admin && selection.scope !== 'CLASS') {
    throw forbidden('Teachers may only send notices to their own classes.');
  }
  if (!admin && selection.recipients === 'TEACHERS') {
    throw forbidden('Teachers may not send notices to staff.');
  }
  if (selection.scope !== 'SCHOOL' && selection.recipients === 'TEACHERS') {
    throw badRequest('Staff notices are school-wide; choose "Entire school".');
  }

  const classWhere = await classFilterFor(sender, selection, admin);

  const userIds = new Set<string>();

  // ── Staff ──
  if (selection.recipients === 'TEACHERS') {
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: sender.schoolId },
      select: { userId: true },
    });
    teachers.forEach((t) => userIds.add(t.userId));
    return { userIds: [...userIds], description: 'All teaching staff' };
  }

  // ── Students and/or their guardians ──
  const students = await prisma.student.findMany({
    where: { schoolId: sender.schoolId, active: true, ...classWhere },
    select: {
      userId: true,
      parents: { select: { parent: { select: { userId: true } } } },
    },
  });

  const wantsStudents = selection.recipients === 'STUDENTS' || selection.recipients === 'BOTH';
  const wantsParents = selection.recipients === 'PARENTS' || selection.recipients === 'BOTH';

  for (const s of students) {
    if (wantsStudents && s.userId) userIds.add(s.userId);
    if (wantsParents) for (const link of s.parents) userIds.add(link.parent.userId);
  }

  return { userIds: [...userIds], description: await describe(sender, selection) };
}

/** The Prisma `where` fragment narrowing students to the chosen scope. */
async function classFilterFor(
  sender: Sender,
  selection: AudienceSelection,
  admin: boolean,
): Promise<Record<string, unknown>> {
  switch (selection.scope) {
    case 'SCHOOL':
      return {};

    case 'GRADE': {
      const grade = Number(selection.scopeId);
      if (!Number.isFinite(grade)) throw badRequest('A grade must be selected.');
      return { class: { grade } };
    }

    case 'CLASS': {
      const classId = selection.scopeId;
      if (!classId) throw badRequest('A class must be selected.');
      const owned = await prisma.class.findFirst({
        where: { id: classId, schoolId: sender.schoolId },
        select: { id: true },
      });
      if (!owned) throw badRequest('That class is not in your school.');
      if (!admin) {
        const allowed = await teacherClassIds(sender);
        if (!allowed.includes(classId)) {
          throw forbidden('You can only send notices to classes you teach.');
        }
      }
      return { classId };
    }
  }
}

/** Ledger-facing description of the reach. */
async function describe(sender: Sender, selection: AudienceSelection): Promise<string> {
  const who =
    selection.recipients === 'BOTH'
      ? 'students and parents'
      : selection.recipients.toLowerCase();

  switch (selection.scope) {
    case 'SCHOOL':
      return `Entire school · ${who}`;
    case 'GRADE':
      return `Grade ${selection.scopeId} · ${who}`;
    case 'CLASS': {
      const cls = await prisma.class.findFirst({
        where: { id: selection.scopeId, schoolId: sender.schoolId },
        select: { name: true },
      });
      return `Class ${cls?.name ?? selection.scopeId} · ${who}`;
    }
  }
}

// Lumen — committing a verified document into the school's live records.
//
// This is the step that closes the loop: paper → extraction → human review →
// an actual Student/Teacher record, with no retyping in between. Because it
// *creates real records*, it is also the most dangerous step, so the rules are
// strict and enforced here rather than trusted to the UI:
//
//   1. Only VERIFIED documents commit. A document still carrying unreviewed
//      fields cannot become a record, full stop.
//   2. Commits are idempotent — a double-click must not create two students.
//   3. The record, the document's status flip, the Trust event and the
//      activity entry land in ONE transaction. An earlier version mutated
//      first and recorded the event afterwards — a crash in the gap left a
//      record the undo system had never heard of. Atomic or nothing.
//   4. Blocking duplicates (same admission number / employee ID / email) stop
//      the commit with a clear message. The clerk resolves them, not us.
//   5. Nothing extracted is thrown away. Addresses, guardians, emergency
//      contacts become first-class columns; a guardian with an email gets a
//      parent portal account linked to the child. What can't become a column
//      is still on the archived document, one click away.

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { hashPassword, generateTempPassword } from '../../lib/auth.js';
import { recordEvent } from '../eventStore.js';
import { templateFor } from './templates.js';
import { getCommitPolicy, commitReadiness } from './policy.js';

type Tx = Prisma.TransactionClient;

/** A freshly-minted login. Shown to the clerk exactly once, never stored. */
export interface IssuedCredential {
  label: string;
  email: string;
  tempPassword: string;
}

export interface CommitResult {
  kind: 'STUDENT' | 'TEACHER';
  id: string;
  name: string;
  summary: string;
  /** Facts the clerk should know about how the record was assembled. */
  notes: string[];
  /** Logins created by this commit — temp passwords, forced to rotate at
   *  first sign-in. The response is their only existence in plaintext. */
  credentials: IssuedCredential[];
  /** Fired after the transaction commits — announces the Trust event. */
  emitEvent: () => void;
}

interface FieldRow {
  key: string;
  value: string;
  status: string;
}

function get(fields: FieldRow[], key: string): string {
  return fields.find((f) => f.key === key)?.value.trim() ?? '';
}

function parseDob(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Every account this module creates gets a memorable temporary password and
 * `mustChangePassword` — usable immediately, forced to rotate at first login.
 * (An earlier version created accounts with random unusable hashes; they were
 * "secure" in the way a bricked phone is secure. Accounts exist to be used.)
 */
async function provisionUser(
  tx: Tx,
  data: { schoolId: string; email: string; name: string; role: string; phone?: string },
  credentials: IssuedCredential[],
  label: string,
): Promise<{ id: string }> {
  const tempPassword = generateTempPassword();
  const user = await tx.user.create({
    data: {
      ...data,
      password: await hashPassword(tempPassword),
      mustChangePassword: true,
    },
  });
  credentials.push({ label, email: data.email, tempPassword });
  return user;
}

/**
 * Students rarely arrive with their own email, so the login is synthesized
 * from the admission number — unique by construction, printable on the ID
 * card, and obvious to everyone who needs to know it.
 */
function studentEmail(admissionNo: string): string {
  return `${admissionNo.toLowerCase().replace(/[^a-z0-9-]/g, '')}@student.meridian.school`;
}

async function commitStudent(
  tx: Tx,
  schoolId: string,
  fields: FieldRow[],
  notes: string[],
  credentials: IssuedCredential[],
): Promise<{ id: string; name: string; summary: string; createdParentId?: string; createdStudentUserId?: string }> {
  const name = get(fields, 'studentName');
  if (!name) throw badRequest('Cannot commit: the student name field is empty.');

  let admissionNo = get(fields, 'admissionNo');
  if (admissionNo) {
    const clash = await tx.student.findFirst({ where: { schoolId, admissionNo }, select: { name: true } });
    if (clash) {
      throw badRequest(
        `Admission number ${admissionNo} already belongs to ${clash.name}. Resolve the duplicate before committing.`,
      );
    }
  } else {
    // The form had no admission number — mint the next one rather than fail,
    // but say so; the clerk may want to overwrite it with the official one.
    const year = new Date().getFullYear();
    const count = await tx.student.count({ where: { schoolId } });
    admissionNo = `ADM-${year}-${String(count + 1).padStart(3, '0')}`;
    notes.push(`No admission number on the form — assigned ${admissionNo}.`);
  }

  // Resolve the form's class to a real class in this school. A form naming a
  // class the school doesn't have (e.g. "9C" when only 9A and 9B exist) stops
  // the commit with a message listing the valid sections — the clerk corrects
  // the class field and re-commits. We never silently file the student as
  // unassigned when a class WAS written, nor invent a phantom class.
  const classText = get(fields, 'className');
  const grade = Number((classText.match(/\d{1,2}/) ?? [])[0]);
  const section = (get(fields, 'section') || (classText.match(/[A-Za-z]$/) ?? [])[0] || '').toUpperCase();
  let classId: string | undefined;

  if (classText && !Number.isNaN(grade) && grade >= 1) {
    const gradeClasses = await tx.class.findMany({
      where: { schoolId, grade },
      select: { id: true, name: true, section: true },
      orderBy: { section: 'asc' },
    });
    if (gradeClasses.length === 0) {
      const all = await tx.class.findMany({ where: { schoolId }, select: { name: true }, orderBy: { name: 'asc' } });
      throw badRequest(
        `The form lists class "${classText}", but this school has no grade ${grade}. ` +
          `Existing classes are: ${all.map((c) => c.name).join(', ') || 'none'}. Correct the class field before committing.`,
      );
    }
    if (section) {
      const match = gradeClasses.find((c) => c.section.toUpperCase() === section);
      if (!match) {
        const sections = gradeClasses.map((c) => c.section).join(', ');
        throw badRequest(
          `The form lists class "${classText}", but grade ${grade} only has section ${sections} ` +
            `(${gradeClasses.map((c) => c.name).join(', ')}). Change the class field to a valid section before committing.`,
        );
      }
      classId = match.id;
      notes.push(`Assigned to class ${match.name}.`);
    } else if (gradeClasses.length === 1) {
      classId = gradeClasses[0].id;
      notes.push(`Assigned to class ${gradeClasses[0].name}.`);
    } else {
      const sections = gradeClasses.map((c) => c.section).join(', ');
      throw badRequest(
        `The form lists grade ${grade} but no section, and grade ${grade} has sections ${sections}. ` +
          `Specify which section on the class field before committing.`,
      );
    }
  } else if (classText) {
    throw badRequest(`Could not read a valid class from "${classText}". Enter it as e.g. "8A" before committing.`);
  } else {
    notes.push('No class on the form — student left unassigned.');
  }

  // Roll number: next free within the class (or school-wide when unassigned).
  const last = await tx.student.findFirst({
    where: { schoolId, ...(classId ? { classId } : {}) },
    orderBy: { rollNo: 'desc' },
    select: { rollNo: true },
  });
  const rollNo = (last?.rollNo ?? 0) + 1;

  // The contact block — the fields an earlier version dropped on the floor.
  // These are what the office actually dials in an emergency.
  const guardianName = get(fields, 'guardianName') || get(fields, 'fatherName') || get(fields, 'motherName');

  // ── The student's own login. ──
  // The synthesized email is unique within a school by construction (the
  // admission number is), but User.email is GLOBALLY unique — two schools can
  // legitimately mint the same admission number. On a cross-tenant collision,
  // suffix until free rather than exploding mid-commit.
  let loginEmail = studentEmail(admissionNo);
  for (let n = 2; await tx.user.findUnique({ where: { email: loginEmail }, select: { id: true } }); n++) {
    if (n > 50) throw badRequest('Could not derive a unique login email — set an admission number on the form.');
    loginEmail = studentEmail(`${admissionNo}-${n}`);
  }
  if (loginEmail !== studentEmail(admissionNo)) notes.push(`Login email adjusted to ${loginEmail} (address already in use).`);
  const studentUser = await provisionUser(
    tx,
    { schoolId, email: loginEmail, name, role: 'STUDENT' },
    credentials,
    `Student · ${name}`,
  );
  const createdStudentUserId = studentUser.id;

  const student = await tx.student.create({
    data: {
      schoolId,
      name,
      admissionNo,
      rollNo,
      classId,
      userId: studentUser.id,
      gender: get(fields, 'gender') || undefined,
      dob: parseDob(get(fields, 'dob')),
      bloodGroup: get(fields, 'bloodGroup') || undefined,
      email: get(fields, 'email').toLowerCase() || undefined,
      phone: get(fields, 'phone') || undefined,
      address: get(fields, 'address') || undefined,
      pincode: get(fields, 'pincode') || undefined,
      guardianName: guardianName || undefined,
      fatherName: get(fields, 'fatherName') || undefined,
      motherName: get(fields, 'motherName') || undefined,
      emergencyContact: get(fields, 'emergencyContact') || undefined,
    },
  });

  // ── Parent portal account ──
  // A guardian with an email on the form gets a real login linked to the
  // child — that is what "no retyping" means for the family side. Rules:
  //   · existing PARENT user in this school → link them (the sibling case);
  //   · email owned by a non-parent account → do nothing, tell the clerk;
  //   · fresh email → create the account (unusable password until an admin
  //     sets one) and link it.
  let createdParentId: string | undefined;
  const guardianEmail = get(fields, 'email').toLowerCase();
  if (guardianEmail && guardianName) {
    const existing = await tx.user.findUnique({
      where: { email: guardianEmail },
      select: { id: true, role: true, schoolId: true, name: true, parent: { select: { id: true } } },
    });
    if (existing?.parent && existing.schoolId === schoolId) {
      await tx.studentParent.create({ data: { studentId: student.id, parentId: existing.parent.id } });
      notes.push(`Linked to existing parent account ${existing.name} (${guardianEmail}).`);
    } else if (existing) {
      notes.push(`${guardianEmail} already belongs to a non-parent account — no parent login created.`);
    } else {
      const relation = get(fields, 'fatherName') === guardianName ? 'Father'
        : get(fields, 'motherName') === guardianName ? 'Mother' : 'Guardian';
      const user = await provisionUser(
        tx,
        { schoolId, email: guardianEmail, name: guardianName, role: 'PARENT', phone: get(fields, 'phone') || undefined },
        credentials,
        `Parent · ${guardianName}`,
      );
      const parent = await tx.parent.create({ data: { schoolId, userId: user.id, relation } });
      await tx.studentParent.create({ data: { studentId: student.id, parentId: parent.id } });
      createdParentId = parent.id;
      notes.push(`Parent portal account created for ${guardianName} (${guardianEmail}).`);
    }
  } else if (guardianName) {
    notes.push('Guardian stored on the record; no portal account created (the form carried no email).');
  }

  return { id: student.id, name, summary: `${name} · ${admissionNo} · roll ${rollNo}`, createdParentId, createdStudentUserId };
}

async function commitTeacher(
  tx: Tx,
  schoolId: string,
  fields: FieldRow[],
  notes: string[],
  credentials: IssuedCredential[],
): Promise<{ id: string; name: string; summary: string }> {
  const name = get(fields, 'teacherName');
  if (!name) throw badRequest('Cannot commit: the name field is empty.');

  const email = get(fields, 'email').toLowerCase();
  if (!email) throw badRequest('Cannot commit: staff records need an email address.');
  const emailClash = await tx.user.findUnique({ where: { email }, select: { name: true } });
  if (emailClash) {
    throw badRequest(`${email} is already registered to ${emailClash.name}. Resolve the duplicate before committing.`);
  }

  let employeeId = get(fields, 'employeeId');
  if (employeeId) {
    const clash = await tx.teacher.findFirst({
      where: { schoolId, employeeId },
      select: { user: { select: { name: true } } },
    });
    if (clash) {
      throw badRequest(`Employee ID ${employeeId} already belongs to ${clash.user.name}.`);
    }
  } else {
    const year = new Date().getFullYear();
    const count = await tx.teacher.count({ where: { schoolId } });
    employeeId = `EMP-${year}-${String(count + 1).padStart(3, '0')}`;
    notes.push(`No employee ID on the form — assigned ${employeeId}.`);
  }

  const department = get(fields, 'department') || get(fields, 'subject') || 'General';

  const user = await provisionUser(
    tx,
    { schoolId, email, name, role: 'TEACHER', phone: get(fields, 'phone') || undefined },
    credentials,
    `Teacher · ${name}`,
  );

  const teacher = await tx.teacher.create({
    data: {
      schoolId,
      userId: user.id,
      employeeId,
      department,
      qualification: get(fields, 'qualification') || undefined,
    },
  });

  return { id: teacher.id, name, summary: `${name} · ${employeeId} · ${department}` };
}

export async function commitDocument(
  documentId: string,
  schoolId: string,
  actor: { id: string; name: string },
): Promise<CommitResult> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, schoolId },
    include: { fields: true },
  });
  if (!doc) throw badRequest('Document not found.');

  // Idempotency: a committed document is done. Report what it became rather
  // than silently creating a sibling record.
  if (doc.status === 'COMMITTED') {
    throw badRequest(`This document was already committed${doc.committedRefId ? ' to a record' : ''}. Undo that commit first if it was a mistake.`);
  }
  if (doc.status !== 'VERIFIED') {
    const pending = doc.fields.filter((f) => f.status === 'REVIEW' || f.status === 'MISSING').length;
    throw badRequest(
      `Only verified documents can be committed. ${pending} field${pending === 1 ? '' : 's'} still need${pending === 1 ? 's' : ''} review.`,
    );
  }

  // An unidentified document must never ride templateFor's fallback into a
  // student/teacher commit — a human sets the real type first.
  if (doc.type === 'UNKNOWN') {
    throw badRequest('This document’s type could not be identified. Set the correct type and reprocess it before committing.');
  }
  const template = templateFor(doc.type);
  if (!template.commits) {
    throw badRequest(`${template.label} documents are records in themselves — there is nothing to commit them into.`);
  }

  // School commit policy — the ERP's own bar, separate from document
  // structure. The pipeline never failed because these were off the form;
  // but the school has said a record may not be CREATED without them.
  const policy = await getCommitPolicy(doc.schoolId, template.commits);
  const readiness = commitReadiness(policy, doc.fields);
  if (!readiness.ready) {
    const names = readiness.missing.map((m) => m.label).join(', ');
    throw badRequest(
      `School policy requires ${names} before a ${template.commits === 'STUDENT' ? 'student' : 'staff'} record is created. ` +
        'Fill the field(s) in review, or adjust the commit policy in Lumen settings.',
    );
  }

  const rows: FieldRow[] = doc.fields.map((f) => ({ key: f.key, value: f.value, status: f.status }));
  const notes: string[] = [];
  const credentials: IssuedCredential[] = [];
  const kind = template.commits;

  // Everything that changes state lives inside this one transaction: the new
  // record (and its accounts), the document flip, the Trust event, the
  // activity entry. If any line fails, the school's data is exactly as it was.
  const { result, event } = await prisma.$transaction(async (tx) => {
    const created =
      kind === 'STUDENT'
        ? await commitStudent(tx, schoolId, rows, notes, credentials)
        : await commitTeacher(tx, schoolId, rows, notes, credentials);

    await tx.document.update({
      where: { id: doc.id },
      data: { status: 'COMMITTED', committedAt: new Date(), committedKind: kind, committedRefId: created.id },
    });

    const evt = await recordEvent(
      {
        schoolId,
        type: 'DOCUMENT_COMMITTED',
        aggregate: kind === 'STUDENT' ? 'Student' : 'Teacher',
        aggregateId: created.id,
        payload: {
          documentId: doc.id,
          kind,
          refId: created.id,
          name: created.name,
          ...('createdParentId' in created && created.createdParentId
            ? { createdParentId: created.createdParentId }
            : {}),
          ...('createdStudentUserId' in created && created.createdStudentUserId
            ? { createdStudentUserId: created.createdStudentUserId }
            : {}),
        },
        actorId: actor.id,
        actorName: actor.name,
      },
      tx,
    );

    await tx.documentActivity.create({
      data: {
        documentId: doc.id,
        kind: 'COMMITTED',
        actorId: actor.id,
        actorName: actor.name,
        // Which logins were issued is audit-worthy; their passwords are not
        // stored here or anywhere else.
        detailString: JSON.stringify({
          kind,
          refId: created.id,
          summary: created.summary,
          accountsCreated: credentials.map((c) => c.email),
        }),
      },
    });

    return { result: created, event: evt };
  });

  return {
    kind,
    id: result.id,
    name: result.name,
    summary: result.summary,
    notes,
    credentials,
    emitEvent: event.emit,
  };
}

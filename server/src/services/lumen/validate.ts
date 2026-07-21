// Lumen — validation.
//
// Validation here is not about rejecting data. A school clerk with a stack of
// paper does not want the software to refuse the stack; they want it to say
// *which three fields to look at*. So every check produces a message aimed at a
// human, and a failure routes the field to review rather than dropping it.
//
// Field checks catch "this isn't a phone number". Cross-field checks catch the
// subtler and more damaging class of error: values that are each individually
// plausible but cannot all be true at once — a date of birth that disagrees
// with the stated age, a leave application that ends before it starts. Those
// are the ones that quietly corrupt a student record for years.

import type { ExtractedValue, FieldSpec } from './types.js';
import type { Insight } from './types.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const ok: ValidationResult = { valid: true };
const bad = (message: string): ValidationResult => ({ valid: false, message });

// Deliberately permissive: matches RFC-shaped addresses without pretending to
// implement RFC 5322, which no regex actually does.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
// Indian mobile numbers: 10 digits starting 6-9, optionally +91-prefixed.
const PHONE_RE = /^(\+91\s)?[6-9]\d{9}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const BLOOD_RE = /^(A|B|AB|O)[+-]$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MIN_STUDENT_YEAR = 1950;

export function validateField(value: string, spec: FieldSpec): ValidationResult {
  const v = value.trim();

  if (!v) {
    return spec.expected ? bad(`${spec.label} is expected on this document but was not found.`) : ok;
  }

  switch (spec.type) {
    case 'email':
      return EMAIL_RE.test(v) ? ok : bad('Not a valid email address.');

    case 'phone':
      if (PHONE_RE.test(v)) return ok;
      return bad(
        /^\+91\s\d{10}$/.test(v)
          ? 'Indian mobile numbers start with 6-9.'
          : 'Not a valid 10-digit mobile number.',
      );

    case 'pincode':
      return PINCODE_RE.test(v) ? ok : bad('PIN code must be 6 digits and cannot start with 0.');

    case 'bloodGroup':
      if (BLOOD_RE.test(v)) return ok;
      return bad(/^(A|B|AB|O)$/.test(v) ? 'Blood group is missing its + or −.' : 'Not a valid blood group.');

    case 'gender':
      return ['Male', 'Female', 'Other'].includes(v) ? ok : bad('Gender could not be interpreted.');

    case 'date': {
      if (!ISO_DATE_RE.test(v)) return bad('Could not be read as a date.');
      const d = new Date(v + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) return bad('Not a real calendar date.');
      const year = d.getUTCFullYear();
      if (year < MIN_STUDENT_YEAR) return bad(`Year ${year} looks too far in the past.`);
      if (d.getTime() > Date.now() + 366 * 864e5) return bad('Date is more than a year in the future.');
      return ok;
    }

    case 'integer': {
      if (!/^-?\d+$/.test(v)) return bad('Must be a whole number.');
      const n = Number(v);
      if (spec.min !== undefined && n < spec.min) return bad(`Must be at least ${spec.min}.`);
      if (spec.max !== undefined && n > spec.max) return bad(`Must be at most ${spec.max}.`);
      return ok;
    }

    case 'decimal':
    case 'money': {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return bad('Must be a number.');
      const n = Number(v);
      if (spec.type === 'money' && n < 0) return bad('Amount cannot be negative.');
      if (spec.min !== undefined && n < spec.min) return bad(`Must be at least ${spec.min}.`);
      if (spec.max !== undefined && n > spec.max) return bad(`Must be at most ${spec.max}.`);
      return ok;
    }

    case 'percentage': {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return bad('Must be a number.');
      const n = Number(v);
      if (n < 0 || n > 100) return bad('Percentage must be between 0 and 100.');
      return ok;
    }

    case 'name': {
      if (v.length < 2) return bad('Name looks too short to be real.');
      if (v.length > 80) return bad('Name is implausibly long — the field may have over-read.');
      if (!/[A-Za-z]{2,}/.test(v)) return bad('Name contains no readable letters.');
      if (/\d/.test(v)) return bad('Name still contains digits.');
      return ok;
    }

    case 'address':
      if (v.length < 6) return bad('Address looks incomplete.');
      return ok;

    case 'id':
      if (v.length < 2) return bad('Identifier looks too short.');
      if (v.length > 32) return bad('Identifier is implausibly long.');
      return ok;

    case 'checkbox':
      if (spec.options?.length && !spec.options.some((o) => o.toLowerCase() === v.toLowerCase())) {
        return bad(`Expected one of: ${spec.options.join(', ')}.`);
      }
      return ok;

    case 'signature':
      return ok;

    case 'text':
    default:
      if (spec.options?.length && !spec.options.some((o) => o.toLowerCase() === v.toLowerCase())) {
        return bad(`Expected one of: ${spec.options.join(', ')}.`);
      }
      if (v.length > 400) return bad('Value is implausibly long — the field may have over-read.');
      return ok;
  }
}

// ───────────────────────  cross-field consistency  ──────────────────────

function get(fields: ExtractedValue[], key: string): ExtractedValue | undefined {
  return fields.find((f) => f.key === key && f.value.trim());
}

function yearsBetween(iso: string, to = new Date()): number {
  const d = new Date(iso + 'T00:00:00Z');
  return (to.getTime() - d.getTime()) / (365.2425 * 864e5);
}

/**
 * Contradictions between fields that each look fine on their own.
 * Returns insights, and the keys that should be flagged for human review.
 */
export function crossValidate(
  fields: ExtractedValue[],
  docType: string,
): { insights: Insight[]; flagKeys: Set<string> } {
  const insights: Insight[] = [];
  const flagKeys = new Set<string>();

  const flag = (keys: string[], severity: Insight['severity'], message: string, detail?: unknown) => {
    insights.push({ kind: 'INCONSISTENCY', severity, message, detail });
    keys.forEach((k) => flagKeys.add(k));
  };

  // ── Age plausibility ──
  const dob = get(fields, 'dob');
  if (dob && ISO_DATE_RE.test(dob.value)) {
    const age = yearsBetween(dob.value);
    if (age < 0) {
      flag(['dob'], 'CRITICAL', 'Date of birth is in the future.');
    } else if (docType === 'TEACHER_APPLICATION' || docType === 'EMPLOYEE_REGISTRATION') {
      if (age < 18) flag(['dob'], 'WARNING', `Date of birth implies an age of ${age.toFixed(0)} — below working age.`);
      if (age > 75) flag(['dob'], 'WARNING', `Date of birth implies an age of ${age.toFixed(0)}, which is unusual for staff.`);
    } else if (age > 25) {
      flag(['dob'], 'WARNING', `Date of birth implies an age of ${age.toFixed(0)}, which is unusual for a student.`);
    } else if (age < 2) {
      flag(['dob'], 'WARNING', `Date of birth implies an age of ${age.toFixed(1)}, which is too young for enrolment.`);
    }

    // Class vs age — a class 9 student who is 6 means one of the two is misread.
    const cls = get(fields, 'className');
    const grade = cls ? Number((cls.value.match(/\d{1,2}/) ?? [])[0]) : NaN;
    if (!Number.isNaN(grade) && grade >= 1 && grade <= 12 && age >= 2) {
      // Indian norm: class N is roughly age N+5, ±3 for repeats and late starts.
      const expected = grade + 5;
      if (Math.abs(age - expected) > 3.5) {
        flag(
          ['dob', 'className'],
          'WARNING',
          `Class ${grade} normally means age ~${expected}, but the date of birth implies ${age.toFixed(0)}.`,
          { grade, expectedAge: expected, impliedAge: Number(age.toFixed(1)) },
        );
      }
    }
  }

  // ── Explicit age vs DOB ──
  const ageField = get(fields, 'age');
  if (ageField && dob && ISO_DATE_RE.test(dob.value) && /^\d+$/.test(ageField.value)) {
    const stated = Number(ageField.value);
    const derived = yearsBetween(dob.value);
    if (Math.abs(stated - derived) > 1.5) {
      flag(['age', 'dob'], 'CRITICAL', `Stated age (${stated}) disagrees with the date of birth (implies ${derived.toFixed(0)}).`);
    }
  }

  // ── Date ranges ──
  const from = get(fields, 'fromDate');
  const to = get(fields, 'toDate');
  if (from && to && ISO_DATE_RE.test(from.value) && ISO_DATE_RE.test(to.value)) {
    const f = new Date(from.value).getTime();
    const t = new Date(to.value).getTime();
    if (t < f) {
      flag(['fromDate', 'toDate'], 'CRITICAL', 'Leave ends before it starts.');
    } else {
      const days = get(fields, 'days');
      if (days && /^\d+$/.test(days.value)) {
        const spanned = Math.round((t - f) / 864e5) + 1; // inclusive of both days
        if (Number(days.value) !== spanned) {
          flag(['days', 'fromDate', 'toDate'], 'WARNING',
            `Stated ${days.value} day(s), but the dates span ${spanned}.`, { stated: Number(days.value), spanned });
        }
      }
    }
  }

  // ── Admission after birth, leaving after admission ──
  const admission = get(fields, 'admissionDate');
  if (admission && dob && ISO_DATE_RE.test(admission.value) && ISO_DATE_RE.test(dob.value)) {
    if (new Date(admission.value) < new Date(dob.value)) {
      flag(['admissionDate', 'dob'], 'CRITICAL', 'Admission date precedes the date of birth.');
    }
  }
  const leaving = get(fields, 'leavingDate');
  if (leaving && admission && ISO_DATE_RE.test(leaving.value) && ISO_DATE_RE.test(admission.value)) {
    if (new Date(leaving.value) < new Date(admission.value)) {
      flag(['leavingDate', 'admissionDate'], 'CRITICAL', 'Leaving date precedes the admission date.');
    }
  }
  const issue = get(fields, 'issueDate');
  const due = get(fields, 'dueDate');
  if (issue && due && ISO_DATE_RE.test(issue.value) && ISO_DATE_RE.test(due.value)) {
    if (new Date(due.value) < new Date(issue.value)) {
      flag(['dueDate', 'issueDate'], 'WARNING', 'Return date is before the issue date.');
    }
  }

  // ── Marks arithmetic: the percentage should follow from the marks ──
  const total = get(fields, 'totalMarks');
  const max = get(fields, 'maxMarks');
  const pct = get(fields, 'percentage');
  if (total && max && Number(max.value) > 0) {
    if (Number(total.value) > Number(max.value)) {
      flag(['totalMarks', 'maxMarks'], 'CRITICAL', `Marks obtained (${total.value}) exceed the maximum (${max.value}).`);
    } else if (pct) {
      const derived = (Number(total.value) / Number(max.value)) * 100;
      if (Math.abs(derived - Number(pct.value)) > 1.5) {
        flag(['percentage', 'totalMarks', 'maxMarks'], 'WARNING',
          `Percentage reads ${pct.value}%, but ${total.value}/${max.value} works out to ${derived.toFixed(1)}%.`,
          { stated: Number(pct.value), derived: Number(derived.toFixed(2)) });
      }
    }
  }

  // ── Money sanity ──
  const amount = get(fields, 'amount');
  const balance = get(fields, 'balance');
  if (amount && balance && Number(balance.value) < 0) {
    flag(['balance'], 'WARNING', 'Balance due is negative.');
  }

  // ── Two contacts that are the same number defeat the point ──
  const phone = get(fields, 'phone');
  const emergency = get(fields, 'emergencyContact');
  if (phone && emergency && phone.value === emergency.value) {
    flag(['emergencyContact'], 'INFO',
      'Emergency contact is the same as the primary number — a second contact is safer.');
  }

  // ── Guardian named as themselves ──
  const father = get(fields, 'fatherName');
  const mother = get(fields, 'motherName');
  const student = get(fields, 'studentName');
  if (student && father && student.value.toLowerCase() === father.value.toLowerCase()) {
    flag(['fatherName', 'studentName'], 'WARNING', "Student and father's name are identical — one may have over-read.");
  }
  if (father && mother && father.value.toLowerCase() === mother.value.toLowerCase()) {
    flag(['motherName', 'fatherName'], 'WARNING', "Father's and mother's names are identical.");
  }

  return { insights, flagKeys };
}

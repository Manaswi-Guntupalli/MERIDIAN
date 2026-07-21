// Lumen — the school's COMMIT POLICY. Deliberately not part of the template
// registry: templates describe what a *document* looks like; this describes
// what the *school* insists on knowing before a record may be created. School
// A can require a blood group, School B can shrug — same templates, same
// pipeline, different policy rows.
//
// Storage is the existing per-school Setting table (no new table, no rule
// engine): key `lumen.commitPolicy.<KIND>`, value a JSON array of field keys.
// Absent row → the code defaults below, which mirror what the ERP genuinely
// cannot function without plus the fields the front office always chases.

import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { TEMPLATES } from './templates.js';

export type CommitKind = 'STUDENT' | 'TEACHER';

export const DEFAULT_COMMIT_POLICY: Record<CommitKind, string[]> = {
  // A student record without a name or birth date is unusable; without a
  // contact number the school cannot reach the family on day one.
  STUDENT: ['studentName', 'dob', 'phone'],
  // A teacher account is keyed on email (it becomes their login).
  TEACHER: ['teacherName', 'email'],
};

const settingKey = (kind: CommitKind) => `lumen.commitPolicy.${kind}`;

/** Every field key a policy may legally reference, with labels for the UI. */
export function policyFieldChoices(kind: CommitKind): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const tpl of TEMPLATES) {
    if (tpl.commits !== kind) continue;
    for (const f of tpl.fields) if (!seen.has(f.key)) seen.set(f.key, f.label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

export async function getCommitPolicy(schoolId: string, kind: CommitKind): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { schoolId_key: { schoolId, key: settingKey(kind) } } });
  if (!row) return [...DEFAULT_COMMIT_POLICY[kind]];
  try {
    const parsed = JSON.parse(row.valueString);
    if (Array.isArray(parsed) && parsed.every((k) => typeof k === 'string')) return parsed;
  } catch {
    /* fall through to defaults on a corrupt row */
  }
  return [...DEFAULT_COMMIT_POLICY[kind]];
}

export async function setCommitPolicy(schoolId: string, kind: CommitKind, keys: string[]): Promise<string[]> {
  const legal = new Set(policyFieldChoices(kind).map((c) => c.key));
  const unknown = keys.filter((k) => !legal.has(k));
  if (unknown.length) throw badRequest(`Unknown field key(s) for ${kind} policy: ${unknown.join(', ')}`);
  const unique = [...new Set(keys)];
  await prisma.setting.upsert({
    where: { schoolId_key: { schoolId, key: settingKey(kind) } },
    create: { schoolId, key: settingKey(kind), valueString: JSON.stringify(unique) },
    update: { valueString: JSON.stringify(unique) },
  });
  return unique;
}

export interface CommitReadiness {
  ready: boolean;
  /** Policy fields with no usable value — each names itself for the UI. */
  missing: { key: string; label: string }[];
  /** The policy that was applied (so the UI can show *why*). */
  policy: string[];
}

/**
 * Pure comparison: the school's required-for-commit keys vs what was actually
 * extracted/entered. A field satisfies policy when it holds a non-empty value
 * (the commit gate already guarantees the document is VERIFIED, i.e. no field
 * is still awaiting review). ABSENT/MISSING fields, or policy keys this form
 * version never carried at all, are what block — with names, not a shrug.
 */
export function commitReadiness(
  policy: string[],
  fields: { key: string; label: string; value: string }[],
  labelFallback: (key: string) => string = (k) => k,
): CommitReadiness {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const missing = policy
    .filter((key) => !byKey.get(key)?.value.trim())
    .map((key) => ({ key, label: byKey.get(key)?.label ?? labelFallback(key) }));
  return { ready: missing.length === 0, missing, policy };
}

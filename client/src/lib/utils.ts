import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// Honorifics/titles that precede a real name — stripped before we derive a
// first name or initials, so "Dr. Kavita Menon" greets as "Kavita", not "Dr."
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'miss', 'sir', 'madam', 'rev', 'fr', 'capt', 'col', 'lt', 'sgt']);

function nameParts(name: string): string[] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  // Drop a leading honorific only when it isn't the whole name.
  if (parts.length > 1 && HONORIFICS.has(parts[0].replace(/\.$/, '').toLowerCase())) {
    return parts.slice(1);
  }
  return parts;
}

/** The person's given name, skipping any honorific ("Dr. Kavita Menon" → "Kavita"). */
export function firstName(name: string): string {
  return nameParts(name)[0] ?? name;
}

export function initials(name: string): string {
  return nameParts(name)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const severityColor: Record<string, string> = {
  INFO: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
  SUCCESS: 'text-mint-400 border-mint-400/30 bg-mint-400/10',
  WARNING: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  CRITICAL: 'text-rose-400 border-rose-400/30 bg-rose-400/10',
};

export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrator',
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
};

export function confColor(c: number): string {
  if (c >= 0.9) return 'text-mint-400';
  if (c >= 0.75) return 'text-cyan-400';
  if (c >= 0.6) return 'text-amber-400';
  return 'text-rose-400';
}

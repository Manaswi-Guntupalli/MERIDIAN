import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { EventDirection, VerificationStatus, CardStatus, StudentRow } from '@/types';

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-3.5 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StudentPicker({ value, onChange, classId }: { value: string; onChange: (id: string) => void; classId?: string }) {
  const students = useQuery({
    queryKey: ['students', 'presence-picker', classId],
    queryFn: async () => (await api.get('/students', { params: classId ? { classId } : {} })).data.students as StudentRow[],
  });
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)} className="input w-full">
      <option value="">Select a student…</option>
      {students.data?.map((s) => (
        <option key={s.id} value={s.id}>{s.class?.name ?? '—'} · Roll {s.rollNo} · {s.name}</option>
      ))}
    </select>
  );
}

export function Modal({ title, onClose, children, width = 'max-w-md' }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl border border-line bg-surface p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const EVENT_BADGE: Record<VerificationStatus, { label: string; severity: 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'INFO' }> = {
  VERIFIED: { label: 'Present', severity: 'SUCCESS' },
  LATE: { label: 'Late', severity: 'WARNING' },
  DUPLICATE: { label: 'Duplicate', severity: 'INFO' },
  UNKNOWN: { label: 'Needs review', severity: 'CRITICAL' },
  REJECTED: { label: 'Rejected', severity: 'CRITICAL' },
  PROXY: { label: 'Proxy blocked', severity: 'CRITICAL' },
};

export const CARD_BADGE: Record<CardStatus, { label: string; severity: 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'INFO' }> = {
  ACTIVE: { label: 'Active', severity: 'SUCCESS' },
  DISABLED: { label: 'Disabled', severity: 'INFO' },
  LOST: { label: 'Lost', severity: 'CRITICAL' },
  BROKEN: { label: 'Broken', severity: 'WARNING' },
  REPLACED: { label: 'Replaced', severity: 'INFO' },
};

export function directionLabel(d: EventDirection): string {
  switch (d) {
    case 'ENTRY':
      return 'Entry';
    case 'EXIT':
      return 'Exit';
    case 'REENTRY':
      return 'Re-entry';
    default:
      return 'Unknown';
  }
}

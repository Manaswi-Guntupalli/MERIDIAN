import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VerificationState, VerificationStatus } from '@/types';

type Severity = 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'INFO';

// The per-student verification state, for the live session grid.
export const STATE_BADGE: Record<VerificationState, { label: string; severity: Severity }> = {
  PENDING: { label: 'Waiting', severity: 'INFO' },
  QR_VERIFIED: { label: 'QR · awaiting face', severity: 'WARNING' },
  FACE_VERIFIED: { label: 'Face verified', severity: 'SUCCESS' },
  PRESENT: { label: 'Present', severity: 'SUCCESS' },
  PROXY_ATTEMPT: { label: 'Proxy blocked', severity: 'CRITICAL' },
  UNVERIFIED_QR: { label: 'Unverified QR', severity: 'CRITICAL' },
  ABSENT: { label: 'Absent', severity: 'INFO' },
};

// The append-only event log status, for the Activity feed.
export const EVENT_BADGE: Record<VerificationStatus, { label: string; severity: Severity }> = {
  VERIFIED: { label: 'Present', severity: 'SUCCESS' },
  LATE: { label: 'Late', severity: 'WARNING' },
  DUPLICATE: { label: 'Duplicate', severity: 'INFO' },
  PROXY: { label: 'Proxy blocked', severity: 'CRITICAL' },
  UNVERIFIED_QR: { label: 'Unverified QR', severity: 'CRITICAL' },
  REJECTED: { label: 'Rejected', severity: 'CRITICAL' },
};

export const METHOD_LABEL: Record<string, string> = { FACE: 'Face', QR: 'QR', MANUAL: 'Manual' };

export function Modal({ title, onClose, children, width = 'max-w-md' }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cn('w-full rounded-2xl border border-line bg-surface p-5 shadow-xl', width)} onClick={(e) => e.stopPropagation()}>
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

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface SchoolHours {
  configured: boolean;
  dayStart: string;
  dayEnd: string;
  workingDays: number;
  periods: { label: string; start: string; end: string }[];
  breaks: { name: string; minutes: number; start: string }[];
  holidays: string[];
  todayIsHoliday: boolean;
}

export type SchoolPhase = 'IN_SESSION' | 'BREAK' | 'BEFORE' | 'AFTER' | 'WEEKEND' | 'HOLIDAY' | 'LOADING';

export interface SchoolStatus {
  phase: SchoolPhase;
  inSession: boolean;
  label: string; // short chip label
  detail: string; // one-line context
  tone: 'mint' | 'cyan' | 'amber' | 'slate';
  currentPeriod: string | null;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function appDayOf(d: Date): number {
  const js = d.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 6 : js - 1; // Mon=0..Sun=6
}

// Friendly label for the next day school is actually in session.
function nextResumeLabel(h: SchoolHours, from: Date): string {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (appDayOf(d) < h.workingDays && !h.holidays.includes(iso)) {
      const when = i === 1 ? 'tomorrow' : DAYS[appDayOf(d)];
      return `resumes ${when} ${fmt12(h.dayStart)}`;
    }
  }
  return `resumes ${fmt12(h.dayStart)}`;
}

/** Live school-day status, recomputed each minute from the school's real hours. */
export function useSchoolStatus(): SchoolStatus {
  const { data } = useQuery({
    queryKey: ['school-hours'],
    queryFn: async () => (await api.get('/school/hours')).data as SchoolHours,
    staleTime: 60 * 60 * 1000,
  });

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return { phase: 'LOADING', inSession: false, label: 'School status', detail: '', tone: 'slate', currentPeriod: null };

  if (data.todayIsHoliday) {
    return { phase: 'HOLIDAY', inSession: false, label: 'Holiday', detail: `School closed today · ${nextResumeLabel(data, now)}`, tone: 'slate', currentPeriod: null };
  }
  if (appDayOf(now) >= data.workingDays) {
    return { phase: 'WEEKEND', inSession: false, label: 'Weekend', detail: `School closed · ${nextResumeLabel(data, now)}`, tone: 'slate', currentPeriod: null };
  }

  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMin(data.dayStart);
  const end = toMin(data.dayEnd);

  if (cur < start) {
    return { phase: 'BEFORE', inSession: false, label: 'Before school', detail: `Starts ${fmt12(data.dayStart)}`, tone: 'amber', currentPeriod: null };
  }
  if (cur >= end) {
    return { phase: 'AFTER', inSession: false, label: 'After school', detail: `School day complete · ${nextResumeLabel(data, now)}`, tone: 'slate', currentPeriod: null };
  }

  // Within the school day: are we inside a period, or on a break between them?
  const period = data.periods.find((p) => cur >= toMin(p.start) && cur < toMin(p.end));
  if (period) {
    return { phase: 'IN_SESSION', inSession: true, label: 'In session', detail: `${period.label} · ends ${fmt12(period.end)}`, tone: 'mint', currentPeriod: period.label };
  }
  const brk = data.breaks.find((b) => cur >= toMin(b.start) && cur < toMin(b.start) + b.minutes);
  if (brk) {
    return { phase: 'BREAK', inSession: true, label: 'On break', detail: `${brk.name} · classes resume shortly`, tone: 'cyan', currentPeriod: null };
  }
  // Between periods with no named break — still the school day.
  return { phase: 'IN_SESSION', inSession: true, label: 'In session', detail: 'Between periods', tone: 'mint', currentPeriod: null };
}

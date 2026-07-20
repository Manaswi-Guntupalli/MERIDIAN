// Kairos client types — mirrors server/src/routes/timetable.routes.ts payloads.

export interface KExplain {
  reasons: string[];
  alternatives: { teachers: number; rooms: number };
  confidence: number;
}

export interface KSlot {
  id: string;
  day: number;
  period: number;
  classId: string;
  className: string;
  subjectId: string;
  subject: string;
  subjectColor: string;
  teacherId: string;
  teacher: string;
  roomId?: string | null;
  room?: string | null;
  locked: boolean;
  explain?: KExplain | null;
}

export interface KUnplaced {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  count: number;
  cause: string;
  fixes: { label: string; detail: string }[];
}

export interface KConflictAnalysis {
  conflicts: string[];
  fixes: { label: string; detail: string; costRank: number; costLabel: string; addresses: number }[];
  cheapestFix: { label: string; detail: string; costLabel: string } | null;
}

export interface KHealth {
  score: number;
  breakdown: { placement: number; balance: number; preferences: number };
  unplaced: KUnplaced[];
  warnings: string[];
  recommendations: string[];
  conflictAnalysis?: KConflictAnalysis | null;
}

export interface KTimetableMeta {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
  version: number;
  active: boolean;
  score: number;
  solveMs: number;
  health: KHealth | null;
  generatedByName?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  publishedByName?: string | null;
  publishedAt?: string | null;
  createdAt: string;
}

export interface KTimetable extends KTimetableMeta {
  days: string[];
  periods: string[];
  periodTimes: { start: string; end: string }[];
  breaks: { after: number; name: string; minutes: number }[];
  blocked: { day: number; period: number; reason: string }[];
  slots: KSlot[];
}

export interface KIssue {
  severity: 'BLOCKER' | 'WARNING';
  code: string;
  title: string;
  detail: string;
  fix?: string;
}

export interface KOverview {
  active: KTimetableMeta | null;
  draft: KTimetableMeta | null;
  issues: KIssue[];
  setup: {
    hasConfig: boolean;
    academicYear: string;
    workingDays: number;
    periodsPerDay: number;
    dayStart: string;
    periodMinutes: number;
    classesTotal: number;
    classesWithPlan: number;
    teachers: number;
    rooms: number;
    labs: number;
  };
  versions: KTimetableMeta[];
}

export interface KConfig {
  academicYear: string;
  terms: { name: string; start: string; end: string }[];
  workingDays: number;
  dayStart: string;
  periodMinutes: number;
  periodsPerDay: number;
  breaks: { after: number; name: string; minutes: number }[];
  blocked: { day: number; period: number; reason: string }[];
  holidays: string[];
  examWeeks: { name: string; start: string; end: string }[];
}

export interface KCurriculumClass {
  id: string;
  name: string;
  students: number;
  plans: { subjectId: string; subject: string; weeklyPeriods: number; requiresLab: boolean; elective: boolean }[];
}

export interface KSubject {
  id: string;
  code: string;
  name: string;
  color: string;
  requiresLab: boolean;
}

export interface KTeacherConstraint {
  id: string;
  name: string;
  subjects: string[];
  maxWeekly: number;
  maxDaily: number;
  maxConsecutive: number;
  partTime: boolean;
  unavailable: { day: number; period: number }[];
  preferredFree: { day: number; period: number }[];
  currentLoad: number;
}

export interface KSubSuggestion {
  slot: {
    day: number;
    period: number;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    roomName?: string;
  };
  candidate: { teacherId: string; teacherName: string; reasons: string[]; confidence: number } | null;
  alternatives: { teacherId: string; teacherName: string; reasons: string[]; confidence: number }[];
}

export interface KSlotOptions {
  teachers: { id: string; name: string; ok: boolean }[];
  rooms: { id: string; name: string; ok: boolean }[];
  cells: { day: number; period: number }[];
}

export interface KVersionCompare {
  a: { id: string; version: number; name: string };
  b: { id: string; version: number; name: string };
  unchanged: number;
  total: number;
  changeCount: number;
  changes: { className: string; day: number; period: number; from: string | null; to: string | null }[];
}

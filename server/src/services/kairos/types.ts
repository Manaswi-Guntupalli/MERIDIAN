// ─────────────────────────────────────────────────────────────────────────────
// Kairos — shared types for the timetable engine.
//
// The engine itself is pure: it takes a SolverInput (no database handles) and
// returns assignments + diagnostics. Everything DB-shaped lives in input.ts
// and workflow.ts. That split is what makes the constraint logic testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface CellRef {
  day: number;
  period: number;
}

export interface BreakDef {
  after: number; // break sits after this 0-indexed period
  name: string;
  minutes: number;
}

export interface GridShape {
  days: string[]; // labels, e.g. ['Mon'..'Fri']
  periodsPerDay: number;
  periodLabels: string[]; // ['P1'..]
  periodTimes: { start: string; end: string }[];
  breaks: BreakDef[];
  /** Cells blocked for everyone (assembly, exams…). */
  blocked: (CellRef & { reason: string })[];
}

/** One class-subject line of the curriculum: "9A studies Physics 6×/week". */
export interface LessonDemand {
  classId: string;
  className: string;
  classSize: number;
  homeRoomId?: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  color: string;
  cognitiveLoad: number; // 1..5
  requiresLab: boolean;
  elective: boolean;
  weeklyPeriods: number;
}

export interface TeacherInfo {
  id: string;
  name: string;
  subjects: string[]; // qualified subject codes
  maxWeekly: number;
  maxDaily: number;
  maxConsecutive: number;
  partTime: boolean;
  unavailable: CellRef[];
  preferredFree: CellRef[];
}

export interface RoomInfo {
  id: string;
  name: string;
  type: string; // CLASSROOM | LAB | ...
  capacity: number;
  unavailable: CellRef[];
}

export interface SolverInput {
  schoolId: string;
  grid: GridShape;
  lessons: LessonDemand[];
  teachers: TeacherInfo[];
  rooms: RoomInfo[];
}

/** Everything the loader knows that validation wants but the solver doesn't. */
export interface LoadedData extends SolverInput {
  classesWithoutPlan: { id: string; name: string }[];
  hasConfig: boolean;
}

export interface SlotExplanation {
  /** Plain-English reasons, ready to render behind the "Why?" button. */
  reasons: string[];
  alternatives: { teachers: number; rooms: number };
  confidence: number; // 0..1
}

export interface Assignment {
  classId: string;
  subjectId: string;
  day: number;
  period: number;
  teacherId: string;
  roomId?: string;
  locked?: boolean;
  explain?: SlotExplanation;
}

/** A pre-validation finding, in administrator language. */
export interface Issue {
  severity: 'BLOCKER' | 'WARNING';
  code: string;
  title: string;
  detail: string;
  fix?: string;
}

export interface UnplacedLesson {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  count: number; // periods that could not be placed
  cause: string;
  fixes: { label: string; detail: string }[];
}

export interface SolveResult {
  assignments: Assignment[];
  unplaced: UnplacedLesson[];
  score: number; // 0..100 health
  breakdown: { placement: number; balance: number; preferences: number };
  warnings: string[];
  recommendations: string[];
  solveMs: number;
  stats: { placed: number; total: number; restarts: number };
}

/** The "why it broke, and the cheapest way out" summary. Cost ranks are
 *  DECLARED planning constants (1 = a one-field change, 2 = a staffing
 *  change, 3 = infrastructure/hiring) — deterministic and auditable. */
export interface ConflictAnalysis {
  /** The smallest set of distinct causes blocking a full schedule. */
  conflicts: string[];
  /** Every distinct fix, cheapest first, with how many conflicts it addresses. */
  fixes: { label: string; detail: string; costRank: number; costLabel: string; addresses: number }[];
  cheapestFix: { label: string; detail: string; costLabel: string } | null;
}

/** Stored on Timetable.healthString. */
export interface HealthReport {
  score: number;
  breakdown: SolveResult['breakdown'];
  unplaced: UnplacedLesson[];
  warnings: string[];
  recommendations: string[];
  conflictAnalysis?: ConflictAnalysis | null;
}

export interface SubstituteSuggestion {
  slot: {
    day: number;
    period: number;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    roomName?: string;
  };
  candidate: {
    teacherId: string;
    teacherName: string;
    reasons: string[];
    confidence: number;
  } | null;
  /** Runner-ups, so the admin can override with one click. */
  alternatives: { teacherId: string; teacherName: string; reasons: string[]; confidence: number }[];
}

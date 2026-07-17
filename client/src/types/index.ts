export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'STUDENT' | 'PARENT';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl?: string;
  phone?: string;
  schoolId: string;
  school?: { id: string; name: string; code: string };
  teacher?: unknown;
  student?: { id: string; name: string; class?: { name: string } };
  parent?: unknown;
}

export interface DashboardStats {
  students: number;
  teachers: number;
  classes: number;
  attendanceRate: number; // representative-day rate (powers Health)
  attendanceDate: string;
  present: number;
  totalMarked: number;
  /** Live, real-time progress for today — may be partial mid-roll-call. */
  today: {
    date: string;
    marked: number;
    present: number;
    absent: number;
    rate: number;
    coverage: number;
    inProgress: boolean;
  };
  outstanding: number;
  overdueCount: number;
  docsInReview: number;
  health: number;
  healthBreakdown: { attendance: number; finance: number; people: number; operations: number };
  feeCollectionRate: number;
  automatedActions: number;
  timeSavedHours: number;
  uncoveredToday: number;
  emergencyActive: boolean;
}

export type Severity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  severity: Severity;
  icon: string;
  title: string;
  detail: string;
  recommendation?: string;
  confidence?: number;
  action?: { label: string; to: string };
}

export interface Insight {
  severity: Severity;
  title: string;
  cause: string;
  confidence: number;
}

export interface StudentRow {
  id: string;
  name: string;
  rollNo: number;
  admissionNo: string;
  bloodGroup?: string;
  gender?: string;
  rfidTag?: string;
  class?: { id: string; name: string };
}

export interface TeacherRow {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  department: string;
  qualification?: string;
  maxHours: number;
  weeklyHours: number;
  subjects: string[];
  classesLed: string[];
  load: number;
  overloaded: boolean;
}

export interface ClassRow {
  id: string;
  name: string;
  grade: number;
  section: string;
  room?: string;
  classTeacher?: string;
  students: number;
}

export interface RosterEntry {
  studentId: string;
  name: string;
  rollNo: number;
  rfidTag?: string;
  status: string;
  source?: string | null;
  attendanceId?: string | null;
}

export interface TimetableSlot {
  id: string;
  day: number;
  period: number;
  classId: string;
  className: string;
  subject: string;
  subjectColor: string;
  teacher: string;
  room?: string;
}

export interface Timetable {
  id: string;
  name: string;
  score: number;
  solveMs: number;
  days: string[];
  periods: string[];
  slots: TimetableSlot[];
}

export interface Conflict {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  reason: string;
  cause: string;
  fixes: { label: string; detail: string }[];
}

export interface FeeRow {
  id: string;
  title: string;
  amount: number;
  paid: number;
  due: number;
  dueDate: string;
  status: string;
  student: string;
  studentId: string;
  class?: string;
}

export interface Prediction {
  id: string;
  kind: string;
  label: string;
  value: number;
  confidence: number;
  targetDate: string;
  drivers: { factor: string; impact: number }[];
}

export interface DocSummary {
  id: string;
  type: string;
  typeLabel: string;
  fileName: string;
  status: 'QUEUED' | 'PROCESSING' | 'REVIEW' | 'VERIFIED' | 'COMMITTED' | 'FAILED';
  overallConfidence: number;
  typeConfidence: number;
  pageCount: number;
  processingMs: number;
  createdAt: string;
  committedKind: string | null;
  fieldCount: number;
  needsReview: number;
  criticalInsights: number;
  errorMessage: string | null;
}

export interface ExtractedField {
  id: string;
  key: string;
  label: string;
  value: string;
  rawValue: string | null;
  confidence: number;
  ocrConfidence: number;
  page: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  status: 'AUTO' | 'REVIEW' | 'CONFIRMED' | 'MISSING';
  source: 'TEXT_LAYER' | 'OCR' | 'REGEX' | 'AI' | 'DERIVED';
  valid: boolean;
  validationMessage: string | null;
  corrected: boolean;
  required: boolean;
}

export interface DocPage {
  id: string;
  index: number;
  width: number;
  height: number;
  source: 'TEXT_LAYER' | 'OCR';
  rotation: number;
  skewDeg: number;
  ocrConfidence: number;
  quality: {
    sharpness: number;
    contrast: number;
    dpi: number;
    verdict: 'GOOD' | 'FAIR' | 'POOR';
    notes: string[];
  } | null;
}

export interface DocInsight {
  id: string;
  kind: 'DUPLICATE' | 'INCONSISTENCY' | 'MISSING' | 'CORRECTION' | 'QUALITY';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  detail: unknown;
}

export interface DocDetail extends Omit<DocSummary, 'fieldCount' | 'needsReview' | 'criticalInsights'> {
  commits: 'STUDENT' | 'TEACHER' | null;
  correctionCount: number;
  fields: ExtractedField[];
  pages: DocPage[];
  insights: DocInsight[];
  pipeline: { timings: { stage: string; ms: number; note?: string }[] } | null;
}

export interface DocActivity {
  id: string;
  kind:
    | 'UPLOADED'
    | 'PROCESSED'
    | 'FAILED'
    | 'REPROCESSED'
    | 'FIELD_CORRECTED'
    | 'FIELD_CONFIRMED'
    | 'VERIFIED'
    | 'COMMITTED'
    | 'COMMIT_UNDONE';
  actorName: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface LumenStats {
  total: number;
  queued: number;
  needsReview: number;
  verified: number;
  committed: number;
  failed: number;
  successRate: number;
  avgConfidence: number;
  avgMs: number;
  corrections: number;
  timeSavedMinutes: number;
}

export interface EventItem {
  id: string;
  type: string;
  aggregate: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  actorName?: string;
  reversible: boolean;
  reverted: boolean;
  createdAt: string;
}

export interface AILogItem {
  id: string;
  engine: string;
  action: string;
  reason?: string;
  confidence?: number;
  input?: unknown;
  output?: unknown;
  reversible: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  category: string;
  action?: { label: string; to: string } | null;
  read: boolean;
  createdAt: string;
}

export interface TwinRoom {
  id: string;
  name: string;
  type: string;
  className: string | null;
  subject: string | null;
  teacher: string | null;
  teacherPresent: boolean;
  occupied: boolean;
  attendancePct: number | null;
  power: string;
}

export interface TwinBuilding {
  id: string;
  name: string;
  x: number;
  y: number;
  floors: number;
  rooms: TwinRoom[];
}

export interface CopilotResult {
  answer: string;
  grounded: boolean;
  data?: unknown;
  source: 'openai' | 'rules';
  confidence: number;
}

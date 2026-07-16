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
  attendanceRate: number;
  present: number;
  totalMarked: number;
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
  fileName: string;
  status: string;
  overallConfidence: number;
  createdAt: string;
  fieldCount: number;
  needsReview: number;
}

export interface ExtractedField {
  id: string;
  key: string;
  label: string;
  value: string;
  confidence: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  status: 'AUTO' | 'REVIEW' | 'CONFIRMED';
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

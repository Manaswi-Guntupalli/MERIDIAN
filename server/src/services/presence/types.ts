export type AttendanceSource = 'RFID' | 'MANUAL' | 'CV' | 'FUSION';
export type Direction = 'ENTRY' | 'EXIT' | 'REENTRY' | 'UNKNOWN';
export type VerificationStatus = 'VERIFIED' | 'DUPLICATE' | 'UNKNOWN' | 'LATE' | 'REJECTED' | 'PROXY';

/**
 * Fusion verification block — the anti-proxy loop. The RFID tap CLAIMS an
 * identity (the cardholder); the camera's face descriptor must CONFIRM that
 * same identity. `similarity` is the best cosine similarity of the live
 * descriptor against the cardholder's own enrolled templates (1:1 verify);
 * `matchedSubjectId/Name` is who the face actually best-matched across the
 * whole school (1:N), so a proxy rejection can honestly say who showed up.
 */
export interface FusionCheck {
  similarity: number; // 1:1 cosine vs the cardholder's templates
  threshold: number; // the pass bar actually applied
  samples: number; // enrolled templates compared against
  /** Strict gates (kiosk Gate mode): a cardholder with zero enrolled
   *  templates is REJECTED instead of degrading to RFID. */
  required?: boolean;
  matchedSubjectId?: string | null;
  matchedName?: string | null;
}

// The one shape every input source normalizes to before it reaches the
// engine. A real RFID reader, the simulator, a teacher's manual mark, and the
// face-recognition kiosk all build one of these and call processScan() —
// nothing downstream branches on `source` except to label the resulting
// AttendanceEvent.
export interface ScanInput {
  schoolId: string;
  source: AttendanceSource;
  cardUid?: string; // RFID
  studentId?: string; // MANUAL | CV (already resolved by the caller)
  readerId?: string; // RFID — required; MANUAL/CV never carry one
  direction?: 'ENTRY' | 'EXIT'; // explicit override; otherwise inferred
  createdBy?: string; // userId, when staff-originated (MANUAL)
  notes?: string;
  confidence?: number; // CV/FUSION match confidence, carried into the AILog
  /** Required when source is FUSION and the card resolved to a student —
   *  the engine rejects the scan as PROXY when the face fails to verify. */
  fusion?: FusionCheck;
  /** Only ever honored via the STAFF_ADMIN-only simulate routes — never on
   *  the reader-key-authenticated device ingest path, so hardware can't
   *  spoof time to dodge the late-arrival policy. */
  simulateAt?: Date;
}

export interface ScanResult {
  status: VerificationStatus | 'REJECTED';
  eventId: string;
  reason?: string; // populated for REJECTED / DUPLICATE / UNKNOWN
  student?: { id: string; name: string; rollNo: number };
  direction: Direction;
  late: boolean;
  lateMinutes: number | null;
  timestamp: Date;
}

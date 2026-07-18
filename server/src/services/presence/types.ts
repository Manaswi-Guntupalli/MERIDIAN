export type AttendanceSource = 'RFID' | 'QR' | 'MANUAL' | 'CV';
export type Direction = 'ENTRY' | 'EXIT' | 'REENTRY' | 'UNKNOWN';
export type VerificationStatus = 'VERIFIED' | 'DUPLICATE' | 'UNKNOWN' | 'LATE' | 'REJECTED';

// The one shape every input source normalizes to before it reaches the
// engine. A real RFID reader, the simulator, a QR kiosk, a teacher's manual
// mark, and the face-recognition kiosk all build one of these and call
// processScan() — nothing downstream branches on `source` except to label
// the resulting AttendanceEvent.
export interface ScanInput {
  schoolId: string;
  source: AttendanceSource;
  cardUid?: string; // RFID | QR
  studentId?: string; // MANUAL | CV (already resolved by the caller)
  readerId?: string; // RFID | QR — required; MANUAL/CV never carry one
  direction?: 'ENTRY' | 'EXIT'; // explicit override; otherwise inferred
  createdBy?: string; // userId, when staff-originated (MANUAL)
  notes?: string;
  confidence?: number; // CV match confidence, carried into the AILog
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

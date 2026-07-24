// Presence · Attendance Sessions — the type surface.
//
// Face recognition is the PRIMARY identity method; the session QR is the
// verification / fallback. Every attendance action flows through one engine
// (engine.ts) and advances one AttendanceVerification state machine, exactly
// the way every other Meridian engine funnels through a single write path.

export type AttendanceSource = 'FACE' | 'QR' | 'MANUAL';

// The per-(session, student) state machine.
//   PENDING → FACE_VERIFIED → PRESENT              (face is sufficient)
//   PENDING → QR_VERIFIED → FACE_VERIFIED → PRESENT
//   QR_VERIFIED at expiry → UNVERIFIED_QR          (QR alone never = present)
//   QR claims A but face is B → PROXY_ATTEMPT      (no attendance, alert)
export type VerificationState =
  | 'PENDING'
  | 'QR_VERIFIED'
  | 'FACE_VERIFIED'
  | 'PRESENT'
  | 'PROXY_ATTEMPT'
  | 'UNVERIFIED_QR'
  | 'ABSENT';

export type SessionStatus = 'ACTIVE' | 'CLOSED' | 'EXPIRED';

// The AttendanceEvent.verificationStatus vocabulary (append-only log).
export type EventStatus = 'VERIFIED' | 'LATE' | 'DUPLICATE' | 'PROXY' | 'UNVERIFIED_QR' | 'REJECTED';

/** What the QR encodes — ONLY this. It dies with the session. */
export interface SessionQrPayload {
  sessionId: string;
  token: string;
}

/** Face-match evidence attached to a verification transition (Trust Ledger). */
export interface FaceEvidence {
  confidence: number; // cosine similarity of the winning match
  distance: number; // 1 - similarity
  threshold: number; // the pass bar applied
  samples?: number; // templates compared against (1:1 verify)
  matchedName?: string | null; // who the face actually matched (1:N), for proxy reasons
  matchedSubjectId?: string | null;
}

export interface MarkResult {
  state: VerificationState;
  studentId: string;
  studentName: string;
  sessionId: string;
  reason?: string;
  face?: FaceEvidence;
  eventId?: string;
  /** Present only for a PROXY_ATTEMPT — who the QR claimed. */
  claimedName?: string;
}

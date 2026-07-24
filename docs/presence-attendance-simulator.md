# Presence — Attendance Sessions & the Simulator

> **What this is:** face-recognition attendance with a **session QR fallback**, and a Simulator that drives the *real* engine through every scenario without a webcam.
>
> **Where:** `Presence → Sessions` (start/close, live grid, QR) · `Presence → Simulator` (9 scenarios) · `Face Recognition → Live Kiosk` (real camera) / `→ Enrollment`.

---

## 1. The honest boundary first

Attendance is **session-scoped**. A teacher opens a session for a class; it mints a cryptographically random token, seeds a `PENDING` row for every student, and auto-expires (default 5 min). **No attendance can be marked outside an active, unexpired session** — that is the anti-replay boundary, and a photographed QR can't be replayed against a later session.

Every mark — kiosk face, student QR, manual — flows through **one engine** in **one transaction**, and lands as: an `AttendanceVerification` state change, an append-only `AttendanceEvent`, the materialised daily `Attendance` row, a Trust-Ledger entry, and (on present) a reversible `ATTENDANCE_MARKED` event. Nothing is faked; a blocked proxy is a real, audited security record.

**What the Simulator simulates:** only the camera pixel. Without a webcam, a "capture" is a synthetic 512-D face template plus small noise (what a genuine re-capture produces). The verification state machine, 1:N / 1:1 matching, anti-proxy gate, events, audit and notifications are all the production code paths.

---

## 2. The state machine

```
PENDING ─face recognised──────────────▶ PRESENT        (face alone is enough)
PENDING ─QR scanned──▶ QR_VERIFIED ─matching face──▶ PRESENT   (both factors)
QR_VERIFIED ─session expires───────────▶ UNVERIFIED_QR   (QR alone ≠ present)
PENDING ─QR claims A, face is B────────▶ PROXY_ATTEMPT   (blocked + alert)
```

| Result badge | Meaning |
|---|---|
| 🟢 **Present** | Face verified (kiosk), or QR + face verified together |
| 🟡 **QR · awaiting face** | QR scanned, face not yet shown — pending |
| 🔴 **Unverified QR** | Session ended with a QR-only mark — never counts as present |
| 🔴 **Proxy blocked** | QR claimed one student, the live face was someone else — no attendance, admins alerted |

---

## 3. How to run it (live camera)

1. **Start a session.** Presence → Sessions → pick a class → **Start attendance**. The QR appears (project it); the live grid shows the whole class as *Waiting*.
2. **Mark by face.** Face Recognition → **Live Kiosk** → Start kiosk. Students step up and blink (liveness); each recognised face flips **Waiting → Present** on the grid in real time.
3. **Or mark by QR + face.** A student scans the projected QR with their app; if their face is captured and matches, they're present; if it's someone else's face, it's a **proxy**.
4. **Close (or let it expire).** Any QR-only marks that never showed a face become **Unverified QR**.

**Enrollment first:** a face can only be recognised if the student is enrolled (Face Recognition → Enrollment → capture 2-3 frames → consent → Enroll). Frames are embedded server-side in memory and discarded — only the vector is stored.

---

## 4. The Simulator — 9 scenarios (no camera needed)

Presence → Simulator → pick a class → **Start session**, then:

**Everyday flow**
- **Correct face** → a student's face is recognised → **Present**.
- **QR + face** → QR scanned and the face matches → **Present** (both factors).
- **QR only** → QR scanned, no face → **QR verified**, pending; becomes **Unverified QR** at expiry.
- **No face detected** → an empty frame — nothing marked.

**Edge cases the engine must catch**
- **Proxy attempt** → QR claims student A but the face is B → **Proxy blocked**, no attendance, admins alerted, and it names who actually showed up.
- **Unknown face** → a face nobody enrolled → recognised as no-one, not marked.
- **Expired session** → forces expiry, then a scan — **refused** (no mark outside a live session).
- **Camera offline** → the face service is unreachable → honest "offline", never a fabricated mark.

Every result lands in the feed *and* in Sessions, Activity and the dashboards — same events, one source of truth.

---

## 5. Where the results show up

- **Presence → Sessions** — the live grid (grey → green as students are marked).
- **Presence → Activity** — the append-only event feed (filter by status/method).
- **Presence → Analytics** — capture-method breakdown + proxy/unverified counts.
- **Dashboard / Foresight** — attendance figures and the capture-integrity health signal.
- **Trust ledger** — every mark auditable; a present mark is undoable.
- **Notifications** — parents on present; admins on a blocked proxy (CRITICAL).

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Kiosk: "face service unreachable" | Start it — `npm run faceservice` (:8020). The kiosk says so honestly rather than faking a match. |
| A student's face isn't recognised | They aren't enrolled, or aren't on this session's class register. Enroll under Face Recognition → Enrollment. |
| "This session is no longer active" | It expired (default 5 min) or was closed. Start a new one. |
| Every simulator scenario says "start a session first" | Click **Start session** at the top of the Simulator. |
| Proxy demo marks present instead of blocking | Both students must be enrolled first — the simulator auto-enrolls them, so just retry. |

---

## 7. Code map (for developers)

| Concern | File |
|---|---|
| Session lifecycle + token + expiry | [`server/src/services/presence/session.ts`](../server/src/services/presence/session.ts) |
| The attendance engine (state machine, anti-proxy) | [`server/src/services/presence/engine.ts`](../server/src/services/presence/engine.ts) |
| Face matching (1:N / 1:1) + embed client | [`server/src/services/face.ts`](../server/src/services/face.ts) |
| Python face service (pixels → 512-D) | [`faceservice/app.py`](../faceservice/app.py) |
| Session + mark API | [`server/src/routes/presence/session.routes.ts`](../server/src/routes/presence/session.routes.ts) |
| Simulator API | [`server/src/routes/presence/simulate.routes.ts`](../server/src/routes/presence/simulate.routes.ts) |
| Teacher session UI | [`client/src/pages/presence/Sessions.tsx`](../client/src/pages/presence/Sessions.tsx) |
| Live kiosk + enrollment | [`client/src/pages/FaceRecognition.tsx`](../client/src/pages/FaceRecognition.tsx) |

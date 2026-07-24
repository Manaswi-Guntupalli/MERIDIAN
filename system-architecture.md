# Meridian — System Architecture

**Scope:** the complete technical design — process topology, data flow, engine internals, the trust model, security, and the reasoning behind each decision.

> Companion to [`README.md`](README.md) (*what it does*) and [`techstack.md`](techstack.md) (*what it's built with*). This document is *why it's built this way*.

---

## Table of contents

1. [Design thesis](#1-design-thesis)
2. [Process topology](#2-process-topology)
3. [Request & event lifecycle](#3-request--event-lifecycle)
4. [The Trust Core](#4-the-trust-core)
5. [Engine internals](#5-engine-internals)
6. [The intelligence engine](#6-the-intelligence-engine)
7. [Data model](#7-data-model)
8. [Security model](#8-security-model)
9. [Realtime & reactive state](#9-realtime--reactive-state)
10. [Failure modes & degradation](#10-failure-modes--degradation)
11. [Design decisions & trade-offs](#11-design-decisions--trade-offs)
12. [Testing strategy](#12-testing-strategy)
13. [Scaling path](#13-scaling-path)

---

## 1. Design thesis

Three invariants apply to every automated action. They are not aspirations — each is enforced by a specific mechanism, at a named place in the code where it would break if violated.

| Invariant | Mechanism | Enforcement point |
|---|---|---|
| **Explainable** | Every score ships with its formula and inputs; every placement carries its reasons | `lumen/confidence.ts`, `kairos/engine.ts::buildExplanations`, `intelligence/scoring/health.py` |
| **Auditable** | The append-only event store *is* the audit trail; AI decisions land in a separate ledger | `services/eventStore.ts`, `services/trustLedger.ts` |
| **Reversible** | An event is advertised reversible **only if a reverser exists** for its type | `eventStore.ts::canReverse` — callers may force `false`, never `true` |
| **Honest** | Deterministic where reliability outranks cleverness; explicit "offline" / "insufficient evidence" instead of invented values | `services/intelligence.ts`, `presence/channels.ts`, every Python trace |

The fourth is the one most systems skip. A dashboard that invents a number when its analytics service dies has destroyed the value of every number it ever showed.

---

## 2. Process topology

Three processes, each with one clear ownership boundary.

```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENT — React 18 + TypeScript + Vite            :5173               │
│                                                                      │
│  TanStack Query ── server-state cache (the only server truth)        │
│  Zustand ──────── UI/session state (auth, toasts, palette)           │
│  Socket.io client ─ pushed events invalidate query caches            │
│  face-api.js ──── on-device detection + blink liveness (UX only)     │
│                                                                      │
│  Owns: presentation, camera capture. Nothing authoritative.          │
│  Never talks to Python.                                              │
└────────────┬──────────────────────────────────┬──────────────────────┘
             │ REST /api (JWT)                  │ WebSocket (JWT)
┌────────────▼──────────────────────────────────▼──────────────────────┐
│ SERVER — Node 20 + Express + Socket.io           :4000               │
│                                                                      │
│  Middleware:  helmet · CORS · compression · rate limit · JWT · RBAC  │
│                                                                      │
│  ENGINES              TRUST CORE          ORCHESTRATION              │
│  ├ Lumen (19 mods)    ├ event store       ├ intelligence client      │
│  ├ Kairos             ├ AI trust ledger   ├ copilot (LLM as parser)  │
│  ├ Presence           └ audit log         └ notifications            │
│  ├ Pulse (ERP)                                                       │
│  └ actions/execute                                                   │
│                                                                      │
│  Owns: transactions, authorization, realtime, ALL state changes      │
└────────────┬──────────────────────────────────┬──────────────────────┘
             │ Prisma (read-write)              │ HTTP POST (30s cache)
┌────────────▼───────────────────┐  ┌───────────▼──────────────────────┐
│ DATABASE                       │  │ INTELLIGENCE — FastAPI    :8010  │
│ SQLite (dev) / Postgres-ready  │  │                                  │
│ 40 models                      │  │  feature_engineering/ (7 modules)│
│ Event table = system of record │◄─┤  anomaly_detection/ (IsolationF.)│
│   AND the complete audit log   │  │  forecasting/ (OLS/Poisson/aging)│
│                                │  │  scoring/health.py               │
│ Encrypted document storage     │  │  recommendation_engine/          │
│ on disk (AES-256-GCM)          │  │  inference/engine.py ─ orchestr. │
└────────────────────────────────┘  │                                  │
                                    │  Opens SQLite READ-ONLY (mode=ro)│
                                    │  Cannot write. Structurally.     │
                                    └──────────────────────────────────┘
```

### Why this split

**Node owns every write.** One process holding the transaction boundary makes *"everything happens in one transaction"* a property you can verify, not a hope spread across services.

**Python owns everything model-shaped.** That is where scikit-learn, scipy and pandas live. Isolating it keeps the core API boring and reliable — and lets analytics crash without taking attendance capture down with it.

**Python opens the database read-only** (`mode=ro` in the connection string). Not by convention — by construction. The intelligence engine *cannot* corrupt operational data even if its code is wrong.

**React never calls Python.** The browser holds a JWT for Node; the engine needs no auth layer of its own. Node authenticates, forwards, caches for 30 s, and is the single place that decides what "offline" looks like.

---

## 3. Request & event lifecycle

### A write, end to end

Using *"mark a teacher absent → cascade"* as the canonical example:

```
1. CLIENT      POST /api/staff/absence/cascade  { teacherId, date }
                  ↓ Authorization: Bearer <JWT>
2. MIDDLEWARE  helmet → CORS → rate limit (300/min) → authenticate → authorize(STAFF_ADMIN)
                  ↓ req.user = { sub, schoolId, role, name, tv }
3. ROUTE       zod validateBody → service call
                  ↓
4. SERVICE     kairos/cascade.ts — ONE prisma.$transaction:
                  a. create StaffAbsence
                  b. read live timetable slots for that teacher/day
                  c. rank qualified & free candidates → create Substitutions
                  d. compute freed rooms
                  e. recordEvent(STAFF_ABSENCE_CASCADE, …, tx)   ← INSIDE the tx
                  ↓ commit
5. POST-COMMIT emit() the deferred socket broadcast
               notify substitutes + affected families
               logAI(engine: KAIROS, reason, confidence)
                  ↓
6. REALTIME    io.to(`school:<id>`).emit('event:new', …)
                  ↓
7. CLIENT      useRealtime → queryClient.invalidateQueries(...)
               affected screens refetch; every open tab converges
```

**Two subtleties that carry the whole design:**

- The event is written **inside** the transaction (4e). A commit that mutates first and records the event separately can crash in between — leaving a record the Trust ledger doesn't know how to undo.
- The socket broadcast is **deferred** until after commit (5). Emitting inside the transaction would announce an event that might still roll back, and every open dashboard would show a change that never happened.

### A read with intelligence

```
GET /api/dashboard/intelligence
  → authenticate → 30 s cache hit? → return
  → POST http://localhost:8010/intelligence/dashboard { schoolId }   (15 s timeout)
      → Python: load frames (read-only) → 7 feature modules
        → health · insights · recommendations · anomalies · forecasts · at-risk
        → assemble with traces
  → cache + return { engine: 'online', payload }
  → on ANY failure: { engine: 'offline', error }   ← never a fabricated fallback
```

---

## 4. The Trust Core

### 4.1 Three append-only layers

| Layer | Model | Question it answers | Written by |
|---|---|---|---|
| Event store | `Event` | What happened, in order — and can it be undone? | `recordEvent()` |
| AI Trust Ledger | `AILog` | Which engine decided what, why, at what confidence? | `logAI()` |
| Audit log | `AuditLog` | Which human touched which record? | `auditLog()` |

Keeping them separate matters: an AI decision and a human action are different kinds of accountability, and conflating them makes both harder to answer for.

### 4.2 The reversibility contract

```ts
const reversible = input.reversible === false ? false : canReverse(input.type);
```

`canReverse` is a lookup into the `reversers` map — the single source of truth for what "reversible" means. A type with no handler is not reversible, and the API and UI both say so.

This replaced a design where everything defaulted to `reversible: true` and undo silently no-op'd. That is precisely the failure a trust product cannot ship: a promise of rollback that doesn't roll back.

**Implemented reversers**, each restoring genuine prior state:

| Event | Undo behaviour |
|---|---|
| `ATTENDANCE_MARKED` | Restores the previous status, or deletes if newly created |
| `FEE_PAYMENT_RECORDED` | Deletes the payment, recomputes `paid` and status |
| `STUDENT_CREATED` | Deletes the student |
| `DOCUMENT_COMMITTED` | Deletes the created record **and the accounts it minted** — unlinking guardians first (FK), and keeping a parent account that still has other children (the sibling case) |
| `DOCUMENT_VERIFIED` | Returns the document to REVIEW |
| `STAFF_ABSENCE_CASCADE` | Removes substitutions + the absence atomically |
| `FACE_ENROLLED` | Erases the biometric templates — doubles as the right-to-erasure path |

Undo itself runs in a transaction (reverse + mark-reverted must both land), then records a **compensating `EVENT_REVERTED`** so the ledger stays append-only. History is added to, never edited.

### 4.3 What undo deliberately does *not* do

The cascade's undo removes substitutions and the absence — but it does **not** pretend the notifications were never sent. The route sends an explicit correction ("your cover assignment was cancelled") *after* state is restored. Un-sending a message is not something software can do, and claiming otherwise would be the same class of lie as a fake rollback.

---

## 5. Engine internals

### 5.1 Lumen — document pipeline

19 modules. The ordering *is* the design:

```
ingest → classify → extract → cross-validate → AI repair → duplicates → score
```

Classification precedes extraction because you cannot know which labels to look for until you know what you are holding. AI repair follows cross-validation so the model sees which fields are already distrusted.

**Ingest** (`ingest.ts`) — two paths, chosen by evidence:

```
PDF? ── text layer ≥ 60 chars? ──yes──▶ FAST PATH
  │                                      read positioned words from the content stream
  │                                      + merge the ANNOTATION layer (form fields /
  │                                        markup) — where digitally-typed values live
  │                                        and getTextContent() never looks
  │                                      + fall back to OCR if annotations exist but
  │                                        carry no readable text (appearance-only)
  └── no ───────────────────────────▶ SCAN PATH
Image? ──────────────────────────────▶ SCAN PATH
                                         perspective correction (paper detection —
                                           un-warps a photo shot at an angle)
                                         → orientation → deskew → adaptive binarisation
                                         → upscale to ~300 DPI → Tesseract (pooled workers)
                                         → multi-pass rescue: if the read looks weak, try
                                           binarised + downscaled variants, keep the most
                                           legible outcome
```

Accepted formats are verified by **magic bytes, not extension** (`storage.ts`): PDF, PNG, JPEG, WEBP, TIFF. Known-but-unsupported types get named remedies — HEIC ("export as JPEG"), ZIP/Office ("print to PDF"). Caps: 16 MB per file, 12 files per batch, 20 pages per PDF (rejected *with the counts*, never silently truncated).

**Classify** (`classify.ts`) — *position is evidence*: signals matched in the top 22% headline band score ×2.2. Confidence combines **absolute** evidence (did we see enough?) with the **relative margin** over the runner-up, so an ambiguous report-card/mark-sheet pair honestly reports as uncertain rather than 95% on a coin flip. No match at all → type `UNKNOWN`, never a silent default.

**Extract** (`extract.ts`) — anchor-based, never coordinate-based. Schools print the same form on a dozen letterheads; coordinate templates shatter the first time a logo changes size. Each field lists real-world label variants ("Student Name", "Name of Student", "Pupil Name"), with fuzzy matching for OCR slips. A garbage labelled read can be rescued by a typed pattern search elsewhere on the page — a string that *is* a phone number beats one that is not. Low-confidence regions get a magnified second OCR pass.

**Confidence** (`confidence.ts`) — multiplicative, because every additional way to be wrong can only lower the score:

```
score = ocrConfidence
      × (0.35 + 0.65 × labelMatch)      ← did we read the right box?
      × sourceTrust                      ← TEXT_LAYER 1.0 … AI 0.8 … DERIVED 0.75
      × 0.94 if repaired
      × 0.62 if genuinely ambiguous
      × qualityCap                       ← page legibility ceiling
 then   min(0.45) if invalid             ← decisive
        min(0.70) if contradicted
```

`AUTO_ACCEPT = 0.90`, set high on purpose: a false review wastes five seconds of a clerk's time; a false accept puts a wrong blood group on a child's record and nobody looks again.

**The two-layer field model** — the architectural fix for an ambiguity that plagues form pipelines:

| Layer | Property | Owner | Means |
|---|---|---|---|
| Document structure | `expected` | template registry | "this form type normally carries this field" |
| Business rule | commit policy | the school (a `Setting` row) | "the ERP requires this before creating a record" |

Consequences: an empty field that *is* expected → `MISSING` (a human should know the form lacks it). An empty field that is not → **`ABSENT`**: excluded from the review queue, from verification gates, and from document confidence entirely — *a form cannot lose marks for boxes it never had*. Policy is compared **only at commit**, naming its blockers; it never fails extraction, review or verification.

**Commit** (`commit.ts`) — one transaction creates the Student/Teacher, provisions login accounts (temp password + forced rotation), links guardians, flips the document, and records the reversible event. Class resolution refuses to invent: a form naming "9C" when only 9A/9B exist stops with the valid sections listed. Login emails are derived from the admission number and suffix-resolved on collision (globally-unique `User.email` vs per-school admission numbers).

### 5.2 Kairos — constraint solver

```
1. expand curriculum → lesson units, ordered hardest-first
     (most-constrained-variable heuristic: labs, scarce teachers, big loads)
2. constructive pass — place each unit at its cheapest feasible (day, period, teacher, room)
3. repair pass — single-level displacement: evict a blocker if it can relocate legally
4. random restarts — keep the best of N attempts
5. hill-climb the weighted soft cost within the time budget
6. verifySolution() — independent re-check of EVERY hard constraint from a clean
   state; a draft that fails NEVER reaches the database
```

**Hard constraints (never violated):** class/teacher/room double-booking, qualification, teacher unavailability, weekly cap, daily cap, max consecutive periods, lab requirement, room capacity, blocked cells, ≤2 periods of a subject per class per day, and **never 3 consecutive periods of the same subject**.

**Defence in depth** — the same guarantees exist at three independent levels:

1. `canPlace()` during search,
2. `verifySolution()` before persistence,
3. **`@@unique` constraints in the database** on (timetable, class, day, period), (timetable, teacher, day, period), (timetable, room, day, period).

Level 3 is the one that matters most: a solver bug *physically cannot* write a double-booked schedule.

**Soft costs** (hill-climbed, not enforced): same-subject-same-day spread, teacher preferred-free periods, cognitively heavy subjects late in the day, teacher gaps, load balance, home-room preference.

**Explainable infeasibility** — `analyzeConflicts()` collects the distinct blocking causes plus the fixes the engine's own diagnosis emits, ranked by *declared* cost constants:

| Cost rank | Class of fix | Example |
|---|---|---|
| 1 | one-field change | raise a weekly cap; relax an unavailability |
| 2 | staffing change | qualify another teacher for the subject |
| 3 | infrastructure | free a lab period; hire |

The UI surfaces the cheapest fix and the full ranked list. These are constants, not model output — deterministic and auditable.

**Lifecycle:** generation writes a DRAFT and never touches the live timetable. Publishing is one transaction: verify → archive current → activate draft → recompute teacher loads. Any failure rolls the whole thing back, so the school always has exactly one live timetable. Manual edits are re-validated against every hard constraint and lock the slot against regeneration.

**The cascade** (`cascade.ts`) composes Kairos with Presence and notifications into a single reversible unit — the clearest demonstration of why one event spine matters: absence → cover plan → room map → notifications → ledger, as one atomic, undoable action.

### 5.3 Presence — attendance integrity

Attendance is **session-scoped**. A teacher opens an `AttendanceSession` for a class: it mints a cryptographically random token, seeds a `PENDING` `AttendanceVerification` per student, and auto-expires (default 5 min). *No mark exists outside an active, unexpired session* — the anti-replay boundary. `markFace` / `markQr` / `markManual` are the single ingest points; each runs in one transaction and advances the per-student state machine.

```
OPEN SESSION  → token + PENDING row per student, expires in N min

markFace(session, embedding):                       ── kiosk, PRIMARY
   1:N match (server-side, InsightFace) → student on this register?
      confident match  → PRESENT           (face alone is sufficient)
      no match         → ABSENT + FaceEvent(UNKNOWN)

markQr(session, token, studentId, embedding?):       ── student device / fallback
   validate token · active · not expired  (else refused — replay-proof)
      + face verifies 1:1 vs the claimed student  → PRESENT (both factors)
      + face is someone else (1:N)  → PROXY_ATTEMPT + FaceEvent + CRITICAL alert
                                       (names who actually showed up)
      + no face  → QR_VERIFIED → UNVERIFIED_QR at expiry (QR alone ≠ present)

ON PRESENT  WRITE AttendanceEvent + upsert daily Attendance
            + reversible ATTENDANCE_MARKED event  (all in one tx)
POST-COMMIT socket broadcast · trust ledger · notify parents / alert admins
```

Every notable outcome — present, proxy, unverified-QR — is written as its own event row. *"Audit every action"* means a blocked proxy stays visible to admins instead of being silently dropped, and a `PRESENT` mark is genuinely undoable (its reverser resets both the daily row and the verification state).

**The anti-proxy insight:** the QR supplies the *claim*; the live camera supplies the *proof*. This converts face recognition from a 1:N search across the whole school (slow, error-prone at scale, privacy-hostile) into a **1:1 verification** against one student's templates — collapsing both error rate and compute, because the system asks only "is this who the QR says?".

**Where the pixels go.** The browser detects a face for UX (bounding box, blink liveness) but sends the *frame* to Node, which forwards it to a Python **face service** (`:8020`, InsightFace 512-D ArcFace). The image is embedded in memory and discarded; only the vector is stored. This is a deliberate security choice: a browser-computed descriptor is trivially forgeable, which would defeat the whole anti-proxy design. Node keeps all matching and DB access. Enrollment is consent-first (`FaceEnrollment` carries a timestamped consent record), and un-enrolling truly erases the templates (the GDPR/DPDP erasure path).

### 5.4 Pulse — ERP & command centre

Less a module than the composition of everything else through one event spine. The dashboard is an **exception queue**: recommendations ranked by a transparent priority formula, each carrying its evidence and a one-click resolve that invokes the owning engine via `/api/actions/execute` (assign-cover, fee-reminders, at-risk-outreach, counselling-flag). After execution the dashboard recomputes — the card disappears *because reality changed*, not because it was dismissed.

### 5.5 Copilot — LLM as parser, never as source of truth

```
question → CLASSIFY (LLM picks an intent + params; keyword fallback)
         → RESOLVE  (Node fetches FACTS from the DB / Python engine)
         → FORMAT   (LLM phrases an answer from those FACTS ONLY)
```

With no `OPENAI_API_KEY`, both LLM steps degrade to deterministic paths (keyword classification, templated answers) — the product never depends on an external service to function. Intents return **executable actions**, so an answer can complete the task rather than describe it.

---

## 6. The intelligence engine

Python, FastAPI, read-only. `POST /intelligence/dashboard { schoolId }` returns one traced payload:

| Key | Contents |
|---|---|
| `meta` | engine version, `computedAt`, `anchorDate`, `llmPolished` flag |
| `healthScore` | overall + per-category `{ score, formula, inputs, weight, contribution }` |
| `insights` | evidence, computed confidence, affected entities, trace |
| `recommendations` | `priority = impact × urgency × confidence × affected × risk`, breakdown included |
| `anomalies` | seeded IsolationForest — same data in, same result out |
| `forecasts` | prediction intervals + the model named |
| `atRisk` | per-student risk, band, reasons in words, confidence arithmetic |
| `featureSummaries` | the raw computed features, for audit |

**Health score** — a weighted mean over categories *that have data*:

```
overall = Σ(weight × categoryScore) / Σ(weights of categories with data)
```

| Category | Weight | Window | Formula |
|---|---|---|---|
| Attendance | 0.35 | all fully-marked school days | `rate × 100`; days below 50% roll-call coverage excluded, not averaged in |
| Finance | 0.28 | snapshot (no window) | `(1 − outstanding/billed) × 100` |
| Timetable | 0.20 | frozen at publish time | the solver's own score for the live version |
| Documents | 0.08 | current queue | `meanConfidence × (1 − reviewQueue/total) × 100` |
| Operations | 0.09 | now | `captureIntegrity × (0.6 + 0.4 × face-enrollment coverage) × 100` |

A category with no data contributes nothing rather than a fake 100. Weights are overridable via `HEALTH_WEIGHTS`. **Staffing is deliberately not a category** — uncovered classes and teacher overload already surface as insights and recommendations, and scoring them again double-counted the same facts in the headline number.

**Honesty rules encoded in the engine:**

1. **No hardcoded confidence** — `confidence.py` computes every value and returns the arithmetic in `components` + `explanation`.
2. **No invented causes** — explanations cite class/grade/weekday deviations, late counts and fee aging. Where evidence is insufficient the payload says *"insufficient evidence"* (e.g. a trend with fewer than 4 school days).
3. **Models match the data** — at ~24 school days, interpretable statistics + IsolationForest, with the model named in every trace. `train_fee_risk.py` **refuses to train** a supervised model until enough labelled history exists, and records why.
4. **Reproducible** — fixed seeds; same database in → same payload out.

---

## 7. Data model

40 models, portable by construction: no native enums, no scalar lists — String constants and String columns, so the identical schema runs on SQLite and Postgres.

**Domains:** tenancy (`School`) · identity (`User` → `Teacher`/`Student`/`Parent`, `StudentParent`) · academic (`Class`, `Subject`, `AcademicConfig`, `ClassSubjectPlan`) · scheduling (`Timetable` → `TimetableSlot`, `StaffAbsence` → `Substitution`) · attendance (`AttendanceSession` + `AttendanceVerification` state machine, `AttendanceEvent` raw + `Attendance` materialised) · biometrics (`FaceEnrollment` consent → `FaceEmbedding` 512-D, `FaceEvent`) · documents (`Document` → `ExtractedField`/`DocumentPage`/`DocumentInsight`/`DocumentActivity`) · biometrics (`FaceEmbedding`, `FaceEvent`) · finance (`Fee` → `Payment`) · trust (`Event`, `AILog`, `AuditLog`) · ops (`Notification`/`NotificationRead`, `EmergencyIncident`/`Ack`/`Event`, `Building`/`Room`, `Setting`).

**Modelling decisions worth their reasoning:**

- **Raw + materialised attendance.** `AttendanceEvent` is the append-only truth (every tap, including rejections); `Attendance` is the daily view every other engine reads. Analytics never has to re-derive a day from a scan log, and the scan log never has to be edited.
- **`NotificationRead` as receipts.** Read state is a fact about the *reader*, not the message. A boolean on the notification meant the first person to open a school-wide announcement marked it read for everyone — observed in practice, then fixed structurally.
- **Attendance = session + verification + event.** The mutable `AttendanceVerification` holds the per-student state machine within a session; the append-only `AttendanceEvent` logs each notable outcome; the daily `Attendance` row is the materialised view every other engine reads. Three roles, never conflated.
- **`ExtractedField.rawValue` + crop box.** The final value, what OCR actually saw before repair, and the pixels it came from — provenance you can point at.
- **`@map("required")` on `expected`.** The `required` → `expected` rename happened in code with zero data migration.
- **Contact block as first-class columns** on `Student` (guardian, phone, emergency contact, address). These are what the front office dials in an emergency; they do not belong buried in extraction JSON.
- **Hard scheduling guarantees as `@@unique`** — see §5.2.

---

## 8. Security model

| Layer | Implementation |
|---|---|
| **Transport / headers** | helmet; CORS locked to `CLIENT_ORIGIN`; compression |
| **Rate limiting** | 300 req/min across `/api` |
| **Authentication** | JWT (7 d default) carrying `sub`, `schoolId`, `role`, `name`, `tv` |
| **Token invalidation** | `User.tokenVersion` — bumping it invalidates every outstanding token (logout-all, deactivation, password reset) |
| **Brute force** | `failedLogins` + `lockedUntil` on the user record |
| **Provisioned accounts** | temp password + `mustChangePassword` — usable immediately, forced to rotate at first login |
| **Authorization** | `authorize(...roles)` guards; 6 roles; `STAFF_ADMIN` / `STAFF` groupings |
| **Ownership** | teachers are constrained to their own classes (`presence/authz.ts`) |
| **Tenancy** | virtually every query is `schoolId`-scoped **from the token**, never from the body |
| **Face pixels** | frames are embedded server-side in memory and discarded; only the 512-D vector is stored — never a raw image, and never a client-supplied (forgeable) descriptor |
| **Replay-proof QR** | a session token is validated for existence, active status and expiry on every mark — a photographed QR can't be replayed against a later session |
| **Documents at rest** | AES-256-GCM encrypted; path traversal blocked by ID validation; retention sweep for failed/abandoned uploads |
| **Biometrics** | 128-D embeddings only, never an image; enrolment is undoable = erasure |
| **Uploads** | magic-byte verification *before* storage; size/count/page caps |
| **Realtime** | socket rooms are joined from the **verified token**, not a client-supplied school ID |
| **Production guard** | the server refuses to boot without a 32+ character `JWT_SECRET` |

---

## 9. Realtime & reactive state

The brief asks for robust reactive state keeping UI components in sync. This is the web-native answer, chosen deliberately rather than by default:

```
Server: state change → recordEvent → (after commit) io.to(`school:<id>`).emit(...)
Client: useRealtime subscribes → queryClient.invalidateQueries([...affected keys])
        → TanStack Query refetches → every open screen converges
```

- **Server-authoritative.** Sockets carry *invalidation signals*, not state. The server stays the single source of truth; no client store can drift out of sync with the database.
- **Two rooms per socket:** `school:<id>` for broadcasts and `user:<id>` for personal notifications, both joined from the verified JWT.
- **Zustand holds only UI state** — auth session, toasts, command palette. Server data lives exclusively in the query cache.

This is why two browsers side by side converge within about a second with no refresh: consistency comes from the server being the only writer, rather than from client-side discipline. (A screen whose socket has dropped falls back to TanStack Query's normal refetch — it lags, it does not diverge permanently.)

---

## 10. Failure modes & degradation

Every degradation is explicit and visible. Nothing fails to a fabricated value.

| Failure | Behaviour |
|---|---|
| Intelligence engine down/slow | 15 s timeout → `{ engine: 'offline' }` → the dashboard renders an explicit offline panel. **Never a local fallback number.** |
| No `OPENAI_API_KEY` | Copilot classification falls back to keywords; answers use templated phrasing over the same facts. Lumen's AI repair pass is skipped. |
| Face service (:8020) unreachable | The kiosk shows an explicit offline state; the Simulator still exercises every path with synthetic embeddings. Never a fabricated match. |
| Student not enrolled / not on the register | The kiosk reports it (ABSENT / UNKNOWN FaceEvent) rather than marking the wrong person. |
| OCR reads poorly | Low confidence → review queue with the original crop. Never a confident wrong value. |
| Document type unidentifiable | Typed `UNKNOWN`; commit blocked until a human sets the type. |
| No qualified substitute | The cascade reports it honestly and frees the room instead of assigning an unqualified teacher. |
| Timetable infeasible | Names the minimal conflicting rules + the cheapest fix. Never a silent "infeasible". |
| SMS / email / push | No provider configured → a structured "would send" entry with the exact payload lands in the Trust Ledger. In-app + socket delivery is real. |
| Transaction failure anywhere | The whole unit rolls back; the deferred socket emit never fires. |

---

## 11. Design decisions & trade-offs

| Decision | Alternative | Why this way | Cost accepted |
|---|---|---|---|
| Modular monolith + one Python sidecar | Microservices | A four-person team can actually operate it; one transaction boundary | Vertical scaling first |
| Custom constraint solver | OR-Tools CP-SAT | No heavy native dependency; full control over the *explanation* layer, which is the differentiator | Not industrial-grade CP; heuristic search |
| Tesseract | Cloud OCR / docTR | Runs locally — no per-page cost, **no student data leaving the box** | Weaker on cursive; English only |
| Event sourcing | CRUD + a logs page | The audit trail exists by construction; undo and Time Machine become possible at all | More write complexity per operation |
| Materialised `Attendance` beside raw events | Derive on read | Analytics stay fast; the scan log stays immutable | Two places to keep consistent (one transaction does it) |
| Interpretable statistics | Deep models | Honest at ~24 days of history; every output can be read aloud to a parent | Lower ceiling once years of data exist |
| Declared-weight risk index | Trained classifier | No labelled outcomes exist yet; weights are inspectable | Not learned from outcomes |
| SQLite in dev | Postgres from day one | Zero-setup clone-and-run; the schema stays portable | Single-writer; swap for production |
| TanStack Query + sockets | A large client store | Server-authoritative; no client state to drift | Requires disciplined query keys |
| Hard constraints as DB `@@unique` | Application checks only | A solver bug cannot corrupt the timetable | Slightly more rigid schema |
| Read-only DB connection for Python | Shared read-write | The analytics service structurally cannot corrupt data | The engine can't cache results in the DB |

**Deliberately omitted:** Kafka (school-scale volume doesn't need it), a microservice mesh, a vector database, and any agent framework. Every dependency in the stack exists because a specific feature requires it — and being able to defend an omission as sharply as an inclusion is part of the design.

---

## 12. Testing strategy

**71 tests across 12 files**, in two layers:

- **Pure unit tests** (`src/services/**/*.test.ts`) — no database. The Kairos engine is tested by *independently re-auditing* its output against every hard constraint from a clean state, plus targeted tests per constraint (qualification, caps, unavailability, locks, lab starvation, subject runs). Lumen's confidence/status/policy logic and intake hardening are tested the same way.
- **End-to-end suites** (`tests/`) — real HTTP through supertest against the real app and database: auth/RBAC boundaries, presence attendance sessions (face→present, QR-only→unverified-QR, QR+face, anti-proxy, expiry refusal, undo), the cascade with undo, Lumen commit + class validation + **commit policy** (School A blocks, School B commits — the same document), emergency coordination.

Every test builds its own school-scoped fixture with a random suffix. Because virtually every query is `schoolId`-scoped, distinct fixtures never interfere despite sharing one SQLite file — no truncate-between-tests machinery is needed.

Beyond tests: `scripts/audit-db.ts` checks live database integrity and feature-data coverage (ledger arithmetic, orphans, business-rule consistency, history depth); `scripts/audit-kairos.ts` re-audits the published timetable against every constraint.

---

## 13. Scaling path

The architecture is deliberately sized for one school, with a stated route beyond it:

1. **Database** — change the Prisma provider to `postgresql` and point `DATABASE_URL` at the instance in `docker-compose.yml`. The schema is already portable; no code changes.
2. **Realtime** — add the Socket.io Redis adapter so rooms span multiple Node instances.
3. **Node** — stateless behind a load balancer (JWT auth, no server sessions).
4. **Intelligence** — already isolated and read-only; scale horizontally against a read replica.
5. **Documents** — swap the encrypted local store for S3/MinIO behind the existing `storage.ts` seam.
6. **Multi-tenant** — `schoolId` scoping is already pervasive; the remaining work is provisioning and per-tenant configuration, not data isolation.

The seams that would be needed already exist: `channels.ts` for real SMS/email/push providers, `storage.ts` for object storage, `intelligence.ts` for a remote engine.

---

*Meridian — automate everything, explain everything, trust everything.*

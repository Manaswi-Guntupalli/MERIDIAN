# ⬦ Meridian

**The trust-first operating system for school administration.**

Six integrated engines replace disconnected school software with one platform where every automated decision is **explainable** (it shows its reasoning) and **auditable** (who, when, on what evidence) — and every state change is **reversible wherever a reverser exists**, with the UI refusing to offer undo where one doesn't.

Every module writes through a shared **event-sourced trust core**. That is what makes audit, time-travel and genuine undo possible at all, rather than bolted on afterwards.

### Core capabilities

| | Engine | What it does |
|---|---|---|
| 📄 | **Lumen** | Document intelligence — paper forms become verified records with pixel-level proof |
| 🕰 | **Kairos** | Timetable optimisation — conflict-free schedules that explain themselves, and explain failure |
| 📡 | **Presence** | Attendance integrity — face recognition + session QR, fused against proxy attendance |
| 📈 | **Foresight** | Predictive operations — forecasts and early warning, with the arithmetic on the page |
| 💬 | **Copilot** | Actionable assistant — asks answered from live data, then *executed* in one click |
| 🫀 | **Pulse** | ERP command centre — an exception queue, not a chart museum |

### At a glance

```
        React + TypeScript  (:5173)
                 │  REST + WebSocket
                 ▼
      Node + Express + Prisma  (:4000)   ← all writes, auth, realtime
                 │
        ┌────────┴─────────┐
        ▼                  ▼
   SQLite / Postgres   Python Intelligence  (:8010)  read-only · scikit-learn
   event-sourced core   Python Face service  (:8020)  InsightFace · embeddings
```

### 30-second start

```bash
npm run setup && npm run dev     # → http://localhost:5173
```

Log in with one tap as `principal@meridian.school` (password `meridian123`).

---

## Table of contents

1. [Why Meridian is different](#1-why-meridian-is-different)
2. [The problem we actually solve](#2-the-problem-we-actually-solve)
3. [Quick start](#3-quick-start)
4. [The six engines](#4-the-six-engines)
5. [The Trust Core](#5-the-trust-core)
6. [Requirement coverage](#6-requirement-coverage)
7. [The four demo moments](#7-the-four-demo-moments)
8. [Screenshots](#8-screenshots)
9. [Architecture at a glance](#9-architecture-at-a-glance)
10. [Project structure](#10-project-structure)
11. [API surface](#11-api-surface)
12. [Data model](#12-data-model)
13. [Configuration](#13-configuration)
14. [Testing & quality](#14-testing--quality)
15. [Honest limits](#15-honest-limits)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Why Meridian is different

| Typical school ERP | Meridian |
|---|---|
| Six modules over six CRUD tables; the same student typed into each | One append-only event core; every module is a projection of it |
| A bolted-on "logs" page, incomplete and unqueried | The event log **is** the database — "who changed what, when" is one query |
| Passive dashboard: pie charts nobody acts on | Exception queue: only what is wrong today, each card with a one-click fix that *executes* |
| Black-box AI, or "AI-powered" stickers on rule-based features | Explainable AI where it earns its place — and explicit determinism where reliability outranks cleverness |
| Manual document entry, errors found at certificate time | Confidence-scored intake with human review and pixel provenance |
| No undo — mistakes are permanent or need a DBA | Event-backed undo, offered only where a reverser genuinely exists |
| Timetable generator that says "infeasible" and shrugs | Names the minimal conflicting rules **and the cheapest fix** |
| RFID attendance nobody reconciles; buddy-punching is an open secret | Face + QR fusion — the QR claims, the live camera confirms |

---

## 2. The problem we actually solve

Schools don't suffer from a shortage of software. They suffer from a **surplus of disconnected software** — an admissions spreadsheet, a fee register, a timetable in Excel, a WhatsApp group for circulars, a paper substitution diary, and an attendance register that agrees with none of them. Every gap between those tools is bridged by a human re-typing data.

But the deeper problem isn't the typing — it's that **schools operate reactively**. A teacher calls in sick and the morning becomes a scramble. A student quietly slips for six weeks and nobody notices until the report card. Fees fall behind and chasing them feels like an accusation.

And the reason schools don't adopt AI to fix this is **trust**. A wrong attendance record is a safeguarding failure. A wrong fee reminder is a reputational one. Nobody hands a child's records — or tomorrow's timetable — to a black box.

**So Meridian is built on one thesis:**

| Principle | What it means in the code |
|---|---|
| **Proactive** | The home screen is a ranked queue of *what needs you now*, each with a one-click action that actually performs the operation — not a chart museum. |
| **Explainable** | Every score ships with its formula and inputs. Every timetable slot answers "why is this lesson here?". Every risk flag narrates its evidence. |
| **Reversible** | State changes are events; events have reversers; the UI only claims "undo" when a reverser genuinely exists. |
| **Honest** | Where AI would be irresponsible, we use deterministic logic **and say so**. When a service is down we render "offline" — never an invented number. |

---

## 3. Quick start

**Prerequisites:** Node.js **20+** (22 recommended — see `.nvmrc`) and npm. Python **3.11+** is optional, for the intelligence engine. No database server, no Redis, no API keys required.

```bash
git clone <repo> && cd MERIDIAN

npm run setup    # installs all deps, creates server/.env, builds + seeds the SQLite DB
npm run dev      # server :4000 + client :5173
```

Open **http://localhost:5173**.

> `npm run setup` is idempotent: it auto-creates `server/.env` from the example and generates the Prisma client on install, so a fresh clone doesn't hit the classic "Environment variable not found: DATABASE_URL" wall. Re-running `npm run seed` restores a clean, **deterministic** demo school (same seed → same data).

### The intelligence engine (optional but recommended)

Insights, forecasts, the health score and the at-risk index are computed by a read-only Python service. Without it those panels show an explicit **"engine offline"** state — everything else works.

```bash
npm run intelligence:install   # one-time: pip install -r intelligence/requirements.txt
npm run intelligence           # runs on :8010
```

### The face service (for live face attendance)

The Live Kiosk and enrollment embed camera frames via a Python InsightFace microservice. Without it, the kiosk shows an explicit offline state; the **Simulator still exercises every attendance scenario** with synthetic embeddings, so a live demo never needs a webcam.

```bash
npm run faceservice:install    # one-time: pip install (downloads the model on first run)
npm run faceservice            # runs on :8020
```

⚠️ The engine has **no hot reload** — restart it after editing Python.

### Demo logins — password `meridian123`

| Role | Email | Sees |
|---|---|---|
| Principal | `principal@meridian.school` | Everything, including approve/publish and undo |
| Admin | `admin@meridian.school` | School-wide operations |
| Teacher | `teacher@meridian.school` | Their classes, attendance, timetable |
| Student | `student@meridian.school` | Own record, timetable, fees |
| Parent | `parent@meridian.school` | Their children (this account has two — the sibling case) |

The login screen has one-tap role buttons; no typing needed.

### Every command

| Command | Does |
|---|---|
| `npm run setup` | Full first-run: install → `.env` → DB → seed |
| `npm run dev` | Server + client together |
| `npm run seed` | Reset to the clean demo school |
| `npm run intelligence` | Start the Python intelligence engine (:8010) |
| `npm run faceservice` | Start the Python face service (:8020) |
| `npm test` *(in `server/`)* | 71 tests |
| `npm run typecheck` | Per workspace |
| `npx tsx scripts/audit-db.ts` *(in `server/`)* | Database integrity + coverage audit |
| `npm run build` | Production build of both workspaces |

---

## 4. The six engines

### 🔦 Lumen — Document Intelligence
**Paper becomes verified data, with pixel-level proof.** `/lumen`

Upload up to 12 files (PDF/PNG/JPEG/WEBP/TIFF, ≤16 MB, ≤20 pages). Lumen runs a 19-module pipeline:

```
ingest → classify → extract → cross-validate → AI repair → duplicates → score
```

- **Ingest** takes the fast path when a PDF has a text layer, and the hard path otherwise: paper-edge detection + **perspective correction** (a photo shot at an angle is flattened back into a scan), orientation detection, deskew, binarisation, upscale to ~300 DPI, then OCR with pooled workers. Digitally-filled PDFs are handled too — values typed into **form fields / annotations** are read from the annotation layer and merged in at their true coordinates.
- **Classify** identifies **16 document types** from the page's own words, weighting the headline band, and reports ambiguity honestly (a report card vs a mark sheet scores as the coin-flip it is). Unidentifiable pages are typed **`UNKNOWN`** — never silently defaulted.
- **Extract** finds fields by their *printed label* (never fixed coordinates), with multiple anchor variants per field and fuzzy matching for OCR slips. A garbage labelled read can be rescued by a pattern search elsewhere on the page.
- **Confidence** is composite and deliberately conservative — engine confidence × label-match × source trust × quality cap, floored hard on validation failure. Above `AUTO_ACCEPT` (0.90) a field auto-verifies; below it queues for review.
- **Provenance**: every value stores the normalised crop box it came from. Tap a field → see the exact pixels. `rawValue` keeps what OCR actually read before repair.
- **Commit** creates a real Student/Teacher (with login credentials, forced password rotation) in one transaction — and it's undoable from the Trust ledger.

**Two-layer field model** (a design we deliberately split):
- `expected` — *document* structure: "this form type normally carries this field."
- **Commit policy** — *school* business rule: "the ERP requires this before creating a record."

So a field absent from one school's form version is `ABSENT` (a non-event, excluded from review and from the confidence score) — while School A can require a blood group and School B needn't, without touching a single template.

### 🕰 Kairos — Scheduling Intelligence
**Conflict-free timetables that explain themselves.** `/kairos`

A custom constraint solver: most-constrained-first construction → repair by single-level displacement → random restarts → hill-climbing on weighted soft costs, inside a time budget.

- **Hard constraints are never violated** — and they're guaranteed *at the database level*: `@@unique` on (timetable, class, day, period), (timetable, teacher, day, period), (timetable, room, day, period). A solver bug physically cannot write a double-booking.
- Enforced: qualification, teacher availability, weekly/daily caps, max consecutive periods, lab requirements, room capacity, blocked cells, **max 2 periods of the same subject per class per day _and_ never 3 back-to-back**.
- **Every slot explains itself** — qualification, current load, why this teacher over the alternatives, how many other options existed, with a confidence.
- **Explainable infeasibility**: when a full schedule is impossible, Kairos names the smallest set of conflicting rules and ranks the fixes by declared cost (one-field change → staffing change → infrastructure), surfacing the **cheapest way out**.
- **Lifecycle**: draft → approve → publish → rollback, transactional. Publishing archives the old version and activates the new one atomically; the school is never without a live timetable. Manual edits are re-validated against every hard constraint and lock the slot against regeneration.

### ⚡ The absence cascade
**One click, a whole morning handled — and one undo.** `/staff` → *Absent → cascade*

Mark a teacher absent and a single call: records the absence → scans the live timetable → auto-assigns substitutes (qualified, free that period, under load caps, with reasons) → recomputes freed rooms → notifies substitutes *and* affected families → writes the whole thing as **one reversible event**.

Undo restores state atomically and sends honest corrections — it never pretends the first messages weren't sent. When no qualified cover exists, it says so and frees the room rather than assigning an unqualified teacher to look good.

### 📡 Presence — Attendance Integrity
**Face recognition with a session QR fallback, fused against proxy attendance.** `/presence`, `/face-recognition`

A teacher opens an **attendance session** for a class; it mints a cryptographically random token, seeds a `PENDING` row for every student, and auto-expires (default 5 min). **No attendance can be marked outside an active, unexpired session** — the anti-replay boundary. One engine is the single ingest point for every mark (kiosk face, student QR, manual), each in **one transaction**.

**Face is the primary method; QR is the fallback.** The per-student state machine:

| Path | Result |
|---|---|
| Face recognised (1:N) | → **PRESENT** (face alone is sufficient) |
| QR scanned + matching face (1:1) | → **PRESENT** (both factors) |
| QR scanned, no face yet | → `QR_VERIFIED`, then **`UNVERIFIED_QR`** at expiry — QR alone is *never* present |
| QR claims student A but the face is B | → 🔴 **`PROXY_ATTEMPT`** — no attendance, admins alerted, and the engine names *who actually showed up* (1:N fallback) |

**The anti-proxy insight:** the QR *claims* an identity; the live face must *confirm* it — turning recognition from a hard 1:N search into an easy **1:1 verification** against that one student's templates, which collapses the error rate.

**Embeddings are stored, never a raw image.** Frames are embedded **server-side in memory** by a Python InsightFace microservice (512-D ArcFace) and discarded — a browser-supplied descriptor would be forgeable, which is a real hole in an anti-proxy system. Liveness (blink) gates every mark; enrollment is consent-first (DPDP/GDPR).

The **Simulator** (`/presence/simulator`) drives the *real* engine through all 9 scenarios — correct face, QR-only, QR+face, proxy attempt, unknown face, no face, expired session, camera offline — with synthetic embeddings, so every path is exercised without a webcam.

### 📈 Foresight — Predictive Operations
**Forecasts and early warning, with the arithmetic on the page.** `/foresight`

Computed by the Python engine, never by Node:

- **At-risk index** — a declared-weight score over attendance deficit, trend, punctuality and fee aging, with per-student evidence in words ("attendance 62% over 24 marked days; fees ₹14,700 outstanding, oldest 14d overdue") and a computed confidence. It explicitly states that grades are *not* a factor **because there is no grades table** — rather than pretending.
- **Forecasts** with prediction intervals and the model named: next-day attendance, substitute demand, fee collections, document review load. When evidence is thin, the payload says *"insufficient evidence"* instead of guessing.
- **Anomalies** via seeded IsolationForest — reproducible, same data in → same result out.

### 💬 Copilot — the console that *executes*
**Ask in English; it does the work.** `/copilot`

`question → classify intent → resolve FACTS from the DB/engine → phrase the answer from those facts only`.

The LLM is a **parser and a phraser, never a source of truth** — and with no API key both steps degrade to deterministic paths, so the product always works. Crucially, answers carry **⚡ execute buttons** that complete the operation (send fee reminders, auto-assign cover, message at-risk families, flag for counselling) and report the real outcome back into the chat.

### 🫀 Pulse — the ERP core & command centre
**The event spine plus an exception-first dashboard.** `/`

Students, staff, classes, attendance, fees, users, reports, notifications, the Digital Twin (live campus occupancy) and Emergency mode all read and write through the same event backbone. The admin home screen is a **ranked action queue**, each card carrying its evidence, its priority arithmetic ("why this rank?"), and a one-click resolve.

---

## 5. The Trust Core

Three append-only layers that make the rest defensible:

| Layer | Table | Answers |
|---|---|---|
| **Event store** | `Event` | *What happened, in order — and can it be undone?* |
| **AI Trust Ledger** | `AILog` | *Which engine decided what, why, with what confidence?* |
| **Audit log** | `AuditLog` | *Who did what to which record?* |

**The honesty rule, enforced in code** ([`eventStore.ts`](server/src/services/eventStore.ts)): an event is advertised as `reversible` **only when a reverser actually exists for its type**. Callers may force `false`; they can never force `true`. An earlier version defaulted everything to reversible and "undo" silently no-op'd — a trust product must never claim a rollback it cannot perform.

Reversers exist for attendance marks, fee payments, student creation, Lumen commits (including the accounts they minted, with the sibling case handled), document verification, the absence cascade, and face enrolment (which doubles as the GDPR-style erasure path).

Events are written **inside the caller's transaction**, so a state change and its undo-record are atomic — and the socket broadcast is deferred until after commit, so nothing is announced that might yet roll back.

**Time Machine** (`/trust`) replays the school to any past moment and offers one-tap undo on anything genuinely reversible.

---

## 6. Requirement coverage

| Challenge requirement | Where it lives | Depth |
|---|---|---|
| **AI Document Processing** | Lumen | 19-module pipeline, 16 doc types, confidence-scored review queue, pixel provenance, transactional commit + undo |
| **Timetable Optimization** | Kairos | Constraint solver, DB-level hard guarantees, per-slot explanations, minimal-conflict + cheapest-fix diagnosis |
| **School ERP Automation** | Pulse | Event-sourced single spine; enter-once data; every screen a live projection |
| **Admin Dashboard (minimal clicks, proactive)** | Pulse Command Center | Ranked exception queue with **executing** one-click resolves, transparent priority formula |
| **Predictive Resource Allocation** | Foresight | Substitute-demand + attendance + fee forecasts with intervals; at-risk index |
| **Automated Attendance (Face / QR)** | Presence | Session-scoped face + QR, anti-proxy state machine, embeddings-only privacy |
| **Reactive state, synced UI** | Socket.io + TanStack Query | Server-authoritative: pushed events invalidate query caches, so open screens converge within about a second — the web-native answer to the brief's Riverpod nod |

---

## 7. The four demo moments

Full script with timings: [`docs/demo-script-5min.md`](docs/demo-script-5min.md).

1. **Anti-proxy attendance** (`/face-recognition` → Live Kiosk, or the Simulator) — a student's face is recognised → present. A QR that claims one student while the camera sees another → 🔴 **PROXY blocked**, with the impostor named and admins alerted.
2. **The cascade** (`/staff`) — one click plays back the real executed steps with server timestamps, then **Undo everything** restores it atomically.
3. **Provenance** (`/lumen`) — tap any extracted value, see the exact pixels it was read from; low-confidence fields wait in a worst-first queue.
4. **Copilot that acts** (`/copilot`) — ask a question, then press ⚡ and watch the operation complete and report back.

A blank, OCR-optimised admission form is included for live demos: [`docs/admission-form-blank.pdf`](docs/admission-form-blank.pdf) — its printed labels match the extraction anchors exactly.

---

## 8. Screenshots

> Capture instructions: [`docs/screenshots/README.md`](docs/screenshots/README.md)

| | |
|---|---|
| ![Command centre](docs/screenshots/dashboard.png) **Pulse** — the exception queue with one-click resolves | ![Lumen](docs/screenshots/lumen.png) **Lumen** — extracted fields beside the scan, with proof crops |
| ![Kairos](docs/screenshots/kairos.png) **Kairos** — the published grid, every slot explainable | ![Presence](docs/screenshots/presence.png) **Presence** — the live session grid, a proxy attempt blocked |
| ![Copilot](docs/screenshots/copilot.png) **Copilot** — a grounded answer with an ⚡ execute button | |

---

## 9. Architecture at a glance

```
┌──────────────── React 18 + TS + Vite (:5173) ─────────────────┐
│  TanStack Query (server cache) · Zustand (UI state)           │
│  Socket.io client — pushed events invalidate caches           │
└───────────────┬──────────────────────────┬────────────────────┘
                │ REST /api                │ WebSocket
┌───────────────▼──────────────────────────▼────────────────────┐
│           Node 20 + Express + Socket.io (:4000)               │
│  JWT · RBAC (6 roles) · rate limiting · helmet · CORS         │
│                                                               │
│  Engines:  Lumen · Kairos · Presence · Pulse · Copilot        │
│  Trust Core:  event store · AI ledger · audit log             │
└───────────────┬──────────────────────────┬────────────────────┘
                │ Prisma ORM               │ HTTP (read-only)
┌───────────────▼───────────┐   ┌──────────▼────────────────────┐
│  SQLite (dev)             │   │  FastAPI + scikit-learn       │
│  Postgres-ready (compose) │◄──┤  Intelligence engine (:8010)  │
│  40 models, append-only   │   │  health · insights · forecasts│
│  event table = audit log  │   │  anomalies · at-risk index    │
└───────────────────────────┘   └───────────────────────────────┘
```

**Why three processes:** Node owns transactions, auth and realtime; Python owns everything model-shaped (that's where the libraries live) and opens the database **read-only** so it can never write; React owns nothing but presentation. Node performs *no* intelligence — it authenticates, forwards, caches for 30 s, and renders "offline" honestly if the engine is unreachable.

Deep dive: [`system-architecture.md`](system-architecture.md).

---

## 10. Project structure

```
MERIDIAN/
├── client/src/
│   ├── pages/              # one file per route; kairos/ and presence/ have sub-views
│   ├── components/         # ui/ primitives, layout/, face/
│   ├── hooks/              # useRealtime, useWebcam, useVoice…
│   ├── store/              # auth + ui (Zustand)
│   ├── lib/                # api client, socket, face-api wrapper, utils
│   └── constants/nav.ts    # nav + per-route role guard (single source of truth)
│
├── server/
│   ├── prisma/             # schema.prisma (40 models) + deterministic seed.ts
│   ├── scripts/            # audit-db, audit-kairos, benchmarks, fixtures
│   ├── tests/              # end-to-end suites (supertest)
│   └── src/
│       ├── routes/         # 20 routers; presence/ is a sub-router
│       ├── services/
│       │   ├── lumen/      # 19 modules: ingest→classify→extract→…→commit
│       │   ├── kairos/     # engine, workflow, cascade, substitute, validate
│       │   ├── presence/   # engine, session, analytics, channels, settings
│       │   ├── eventStore.ts trustLedger.ts intelligence.ts copilot*.ts
│       ├── middleware/     # auth (JWT + RBAC), error handler
│       └── lib/            # prisma, socket, auth, openai, errors
│
├── intelligence/app/
│   ├── feature_engineering/  # attendance, finance, staffing, timetable, documents, operations, students
│   ├── anomaly_detection/    # seeded IsolationForest
│   ├── forecasting/          # OLS / Poisson / aging-ratio with intervals
│   ├── scoring/health.py     # weighted health score + formulas
│   ├── recommendation_engine/
│   ├── inference/engine.py   # orchestrator — assembles the payload + traces
│   └── confidence.py         # the confidence arithmetic
│
└── docs/                     # demo script, simulator guide, blank admission form
```

---

## 11. API surface

All under `/api`, JWT-authenticated unless noted, school-scoped by the token.

| Router | Highlights |
|---|---|
| `/auth` | login, me, change-password (token-version invalidation) |
| `/dashboard` | stats, **`/intelligence`** (proxies Python, 30 s cache) |
| `/students` `/staff` `/classes` `/attendance` `/fees` `/users` | ERP CRUD + operations |
| `/staff/absence/cascade`, `/absence/undo` | the reversible cascade |
| `/documents` | Lumen: upload, status, fields, confirm/correct, verify, **commit**, history, export, **commit-policy** |
| `/timetable` | Kairos: overview, generate, draft edit/lock, approve, publish, rollback, substitute plan/apply |
| `/presence/session` | start/close/get a session, submit face, submit QR, manual mark |
| `/presence` | events feed, analytics (method breakdown), settings, simulate/* |
| `/face` | enroll (images → server embed), status, unknown/proxy log |
| `/face` | enroll, recognize-batch, attendance, status, unknown |
| `/copilot` | ask, suggestions |
| `/actions/execute` | one-click operations: assign-cover, fee-reminders, at-risk-outreach, counselling-flag |
| `/trust` | event feed, time-machine replay, **undo** |
| `/twin` `/emergency` `/reports` `/notifications` `/school` | campus map, incident coordination, AI reports, inbox, config |

**Face service:** the browser sends camera frames to Node, which forwards them to the Python face service (`:8020`) for embedding; only the 512-D vector is kept. Matching and all DB access stay in Node.

---

## 12. Data model

40 Prisma models. Portable by design — no native enums or scalar lists, so the same schema runs on SQLite and Postgres unchanged. Highlights:

- **Tenancy**: `School` scopes virtually every query; the JWT carries `schoolId`.
- **Identity**: `User` (6 roles, `tokenVersion` for instant global logout, brute-force lockout) → `Teacher` / `Student` / `Parent`, with `StudentParent` many-to-many for siblings.
- **Academic**: `Class`, `Subject`, `AcademicConfig` (calendar, periods, breaks, blocked cells, holidays), `ClassSubjectPlan` (curriculum — what drives generation).
- **Timetable**: `Timetable` (draft/approved/published/archived, exactly one active) → `TimetableSlot` with the three uniqueness guarantees; `StaffAbsence` → `Substitution`.
- **Attendance**: `AttendanceEvent` (append-only raw scans, every source) + `Attendance` (materialised daily view).
- **Presence**: `AttendanceSession` (token + window), `AttendanceVerification` (per-student state machine), `FaceEnrollment` (consent) → `FaceEmbedding` (512-D + model).
- **Lumen**: `Document` → `ExtractedField` (value, `rawValue`, confidence, crop, status, source), `DocumentPage` (word boxes = the audit trail), `DocumentInsight`, `DocumentActivity` (per-document timeline).
- **Biometrics**: `FaceEmbedding` (128-D vectors only — never an image), `FaceEvent` (unknown/spoof/proxy log).
- **Trust**: `Event`, `AILog`, `AuditLog`.
- **Ops**: `Fee`/`Payment`, `Notification`/`NotificationRead` (read state is per-user — a school-wide notice can't be marked read for everyone by the first reader), `EmergencyIncident`/`Ack`/`Event`, `Building`/`Room`, `Setting`.

Run `npx tsx scripts/audit-db.ts` in `server/` for a live integrity + coverage report (ledger arithmetic, orphans, business rules, feature-data depth).

---

## 13. Configuration

`server/.env` — auto-created from `.env.example` on install. Everything has a working default.

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `CLIENT_ORIGIN` | 4000 / :5173 | |
| `DATABASE_URL` | `file:./meridian.db` | Swap for a Postgres URL + change the provider |
| `JWT_SECRET` | dev fallback | **Refuses to start in production** without a 32+ char secret |
| `OPENAI_API_KEY` | *(empty)* | Optional — without it, AI paths degrade deterministically |
| `LUMEN_STORAGE_KEY` | derived | Documents are encrypted at rest (AES-256-GCM) |
| `LUMEN_RETENTION_DAYS` | 30 | Failed/abandoned docs only; committed records are never auto-deleted |
| `INTELLIGENCE_URL` | `http://localhost:8010` | Python engine |
| `HEALTH_WEIGHTS` | *(engine-side)* | JSON override for health-score weights |

---

## 14. Testing & quality

```bash
cd server && npm test        # 71 tests across 12 files
npm run typecheck            # in server/ and client/ — both clean
npx tsx scripts/audit-db.ts  # database integrity + feature-data coverage
```

Tests cover the things that would actually hurt: the Kairos solver audited against every hard constraint from a clean state (including the subject-run rule), the reversible cascade end-to-end with undo, attendance sessions (face→present, QR-only→unverified, QR+face, anti-proxy, expiry, undo), Lumen commit + class validation + **commit policy** (School A blocks / School B commits, same document), intake hardening (page cap, HEIC/Office rejection, UNKNOWN typing), digitally-filled PDFs, presence attendance edge cases, emergency coordination, and RBAC boundaries.

Each test builds its own school-scoped fixture with a random suffix, so suites never interfere despite sharing one SQLite file.

---

## 15. Honest limits

The whole product is a claim about honesty, so here is where the edges are:

- **The Kairos solver is a custom constraint engine**, not OR-Tools CP-SAT. It enforces every hard constraint, explains infeasibility and ranks fixes — but it is a purpose-built heuristic solver, not industrial CP.
- **OCR is Tesseract**, tuned hard (perspective correction, deskew, adaptive binarisation, multi-pass rescue). It reads **printed and block-capital text well; cursive handwriting poorly** — and when it's unsure it routes to review rather than guessing. **English only.**
- **Forecasts are interpretable statistics**, not deep models — a deliberate choice at ~24 school days of history, stated in every trace. The at-risk index uses **declared weights**, not a trained model, because there are no labelled outcomes to train on.
- **SMS / email / push are typed seams, not deliveries.** No provider is configured; each call logs a structured "would send" entry with the exact payload to the Trust Ledger. In-app + realtime notifications are genuinely delivered.
- **No offline sync.** Attendance capture needs the server.
- **SQLite in dev.** Postgres-ready (schema is portable, `docker-compose.yml` included) but the demo runs on SQLite.
- **Grades aren't modelled**, so the risk index says so instead of implying it weighs them.

---

## 16. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Dashboard shows "engine offline" | Python service isn't running → `npm run intelligence`. (This is the honest degradation working, not a crash.) |
| Insights look stale after editing Python | The engine has no hot reload — restart it. |
| Kiosk says "face service unreachable" | Start it: `npm run faceservice` (:8020). The kiosk shows this explicitly rather than faking a match. |
| A face isn't recognised at the kiosk | The student isn't enrolled, or isn't on that session's class register. Enroll under Face Recognition → Enrollment. |
| A card keeps getting rejected as lost/disabled | The simulator's "Lost/Disabled card" scenario really changed its status. Restore under Manage → Cards. |
| Cascade covered 0 periods | No qualified, free substitute existed — it says so and frees the room rather than assigning someone unqualified. Cascade a teacher of a shared subject to see full coverage. |
| Lumen extracted labels but no values | Fixed — digitally-filled PDFs are read from the annotation layer. If it recurs, re-upload; the pipeline falls back to OCR for appearance-only fills. |
| Uploaded iPhone photo rejected | HEIC isn't supported; the error tells you how to export as JPEG. |
| `prisma db push` fails on a fresh clone | `server/.env` missing → `npm run setup` creates it automatically. |

---

## Further reading

| Document | Contents |
|---|---|
| [`system-architecture.md`](system-architecture.md) | Deep technical architecture — data flow, engine internals, security, trade-offs |
| [`techstack.md`](techstack.md) | Every dependency and why it was chosen |
| [`docs/demo-script-5min.md`](docs/demo-script-5min.md) | Minute-by-minute demo script with failure recovery lines |
| [`docs/presence-attendance-simulator.md`](docs/presence-attendance-simulator.md) | Attendance sessions, the QR fallback, and every simulator scenario |
| [`intelligence/README.md`](intelligence/README.md) | The Python engine's honesty rules and module layout |

---

**Meridian** — *automate everything, explain everything, trust everything.*

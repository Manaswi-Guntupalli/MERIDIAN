# Meridian — Tech Stack

The complete, current technology stack for Meridian, the trust-first school
operating system — plus the planned **Flutter (Riverpod) mobile apps** for
Principal, Teacher, Student, and Parent. This reflects the codebase as it
stands after the RFID → Face-Recognition + session-QR redesign, the two Python
AI microservices, and the consolidated Presence module.

---

## 1. System Architecture at a Glance

Meridian runs as **four cooperating runtimes today**, with a **fifth (Flutter
mobile) planned** — all speaking to one Express API over JWT:

| # | Runtime | Tech | Port | Role |
|---|---------|------|------|------|
| 1 | Web client | React 18 + Vite + TypeScript | 5173 | Command-center SPA for all roles + projector/kiosk screens |
| 2 | API / backend | Node.js + Express + Prisma + Socket.io | 4000 | Business logic, auth/RBAC, realtime, Trust Core |
| 3 | Intelligence service | Python + FastAPI + scikit-learn | 8010 | Dashboard intelligence, forecasts, health, at-risk index (read-only) |
| 4 | Face service | Python + FastAPI + InsightFace | 8020 | Pixels → 512-D ArcFace embedding (in-memory, image discarded) |
| 5 | **Mobile (planned)** | **Flutter + Dart + Riverpod** | — | **Native apps for Principal / Teacher / Student / Parent** |

Design philosophy shared across every runtime: **one engine, one source of
truth.** Every automated action is explainable, audited, and reversible where
the domain allows. Clients (web today, Flutter tomorrow) are thin — they never
duplicate business logic; they call the same REST API and subscribe to the same
Socket.io stream.

```
                         ┌──────────────────────────────┐
   Web SPA (5173) ─────► │                              │ ─── Socket.io ──► live updates
   Flutter apps  ─────►  │   Express API (4000)         │
   (Principal/Teacher/   │   Prisma · JWT/RBAC · Trust  │ ─── HTTP ──► Intelligence (8010)
    Student/Parent)      │   Core (Event/Audit/AI Ledger)│ ─── HTTP ──► Face service (8020)
                         └──────────────┬───────────────┘
                                        │ Prisma
                                 SQLite (dev) / PostgreSQL (prod-ready)
```

---

## 2. Final Tech Stack (by layer)

### Frontend — Web (`client/`)
- **React 18.3** with Strict Mode, **Vite 6.4**, **TypeScript 5.9**, ES modules.
- **React Router DOM 6** — role-scoped routing and guards.
- **TanStack React Query 5** — server state, caching, refetch, realtime invalidation.
- **Zustand 5** — auth/session, command palette, and toast stores.
- **Axios 1.7** — API client with JWT request interceptor and 401 handling (relative `/api`, proxied through Vite).
- **socket.io-client 4.8** — realtime, joined to a school-scoped room (relative origin, proxied).
- **Tailwind CSS** + PostCSS + Autoprefixer + `clsx` + `tailwind-merge` — design system.
- **Framer Motion 11** — transitions, gauges, kiosk scan effects, micro-interactions.
- **Recharts 2** — analytics visualizations.
- **Lucide React** — icon system.
- **qrcode 1.5** — renders the attendance-session QR (encodes a `/scan` URL, never raw data).
- **@vladmandic/face-api 1.7** — **browser-side face detection + 68-pt landmarks + blink/liveness only** (recognition is server-side; see §5).
- **date-fns 4**, **React Hook Form 7** (+ `@hookform/resolvers`), **Zod 3** (shared validation).
- Fonts (Google Fonts in `index.html`): **Fraunces**, **Plus Jakarta Sans**, **IBM Plex Mono**.

### Backend — API (`server/`)
- **Node.js + Express 4**, **TypeScript ESM**, run with `tsx` (dev) / `tsc` (build).
- **Prisma 5.22** (`@prisma/client`) — data access layer.
- **Socket.io 4.8** — realtime, school-scoped broadcasts (`school:{schoolId}` rooms).
- **Zod** — request validation; **jsonwebtoken** — JWT auth; **bcryptjs** — password hashing.
- **Multer** (memory storage) — document/image upload.
- **Document intelligence libs**: **tesseract.js 7** (OCR), **pdfjs-dist 6** (PDF parse + AcroForm digital-fill), **sharp 0.35** (image pre-processing), **pdfkit** + **@napi-rs/canvas** (PDF generation), **exceljs 4** (spreadsheet export).
- **OpenAI SDK 4** — grounded Copilot/report generation when a key is set; deterministic fallback otherwise.
- **Helmet, CORS, compression, cookie-parser, express-rate-limit, morgan** — hardening & logging.
- **Vitest** — 71 passing unit/route tests (attendance engine, RBAC, Kairos, Lumen, cascade, etc.).

### Python AI Microservices
- **Intelligence engine** (`intelligence/`, FastAPI + uvicorn, :8010): **pandas, numpy, scikit-learn, scipy, joblib**. Read-only SQLite access; produces dashboard health scores, attendance/fee forecasts, substitute-demand, and the at-risk index using interpretable statistical models + IsolationForest (heavy libs deliberately avoided at this data scale). No hot reload — restart after edits. Node proxies it at `GET /api/dashboard/intelligence`; when down, the UI shows an explicit offline state (never invented numbers).
- **Face service** (`faceservice/`, FastAPI + uvicorn, :8020): **insightface (buffalo_l ArcFace), onnxruntime, opencv-python-headless, numpy**. Turns a base64 frame into a **512-D embedding in memory and discards the image** — the only place raw pixels are handled. All matching + storage stay in Node.
- Both target **Python 3.11+** (tested on 3.14).

### Data & Persistence
- **Prisma schema** — SQLite for zero-setup local demos; written to stay **PostgreSQL-portable** (string constants instead of native enums, JSON stored as strings).
- **Docker Compose** provisions **PostgreSQL 16 Alpine** and **Redis 7 Alpine** for the production path.
- Seed script builds a realistic school: users/roles, classes, staff, students, parents, buildings/rooms, curriculum plans, attendance history, fees, documents, AI logs, events, settings, and an initial **published timetable (v1)**.

### DevOps / Tooling
- **npm workspaces** (`client`, `server`) + **concurrently**; Python services run via `uvicorn`.
- Root scripts: `npm run dev` (server+client), `npm run intelligence`, `npm run faceservice`, `npm run dev:fresh` / `dev:stop` (free stale ports), `npm run build`, `npm run seed`.
- Docker Compose for Postgres + Redis; env template covers `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, `FACE_SERVICE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

### Mobile (planned) — Flutter + Riverpod
See **§8** for the full breakdown.

---

## 3. Data Model (current)

- **Tenant & identity:** School, User, Teacher, Student, Parent, StudentParent.
- **Academic structure:** Class, Subject, Building, Room, AcademicConfig, ClassSubjectPlan.
- **Timetable (Kairos):** Timetable, TimetableSlot, StaffAbsence, Substitution.
- **Attendance (Presence, face + QR):** AttendanceSession, AttendanceVerification (per-student state machine), AttendanceEvent (append-only mark log), Attendance (materialized daily view).
- **Biometrics:** FaceEnrollment (consent record), FaceEmbedding (512-D vectors + model id), FaceEvent (unknown/proxy review queue).
- **Documents (Lumen):** Document, ExtractedField.
- **Intelligence:** Prediction, AILog.
- **Trust & audit:** Event (append-only), AuditLog.
- **Communication & ops:** Notification, EmergencyIncident, Fee, Payment, Setting.

> RFID is fully removed — `RFIDCard`, `RFIDReader`, and `ReaderHeartbeat` no
> longer exist. Attendance is now session-based Face + QR.

---

## 4. Realtime Layer
- Socket.io joins each client to `school:{schoolId}`; the room comes from the JWT, never a client request.
- Broadcasts: new immutable events, AI-log updates, notifications, attendance/verification outcomes, timetable publish/rollback, emergency trigger/resolve, and unknown-face events.
- React Query cache invalidation keeps dashboards, attendance, timetable, twin, and notifications fresh. Flutter will mirror this by invalidating Riverpod providers on the same socket events.

---

## 5. Presence — Face Recognition + Session QR (current)

The redesigned attendance flow — **face is primary, QR is the fallback**, and
everything converges on one state machine and one engine.

- **Session model:** a teacher opens an `AttendanceSession` (crypto token, auto-expiring, default 5 min) from a projector-ready screen showing a large QR + live countdown + register.
- **Face pipeline:** browser `face-api.js` does detection + blink liveness only → captures a frame → sends the **image** to Node → Node forwards to the Python face service → **512-D ArcFace embedding computed in memory and discarded** → cosine 1:N match in Node (threshold 0.42) → attendance engine marks `PRESENT`.
- **QR fallback (student phone):** the projected QR encodes `${origin}/scan?s=<sessionId>&t=<token>` (URL, token only — never student identity). The student opens `/scan`, logs in, taps **Mark My Attendance** → `POST /presence/session/:id/qr` with identity from the JWT → `QR_VERIFIED`. Face (or session expiry) resolves it to `PRESENT` / `UNVERIFIED_QR`.
- **Anti-proxy:** a QR claiming student A while the face matches B → `PROXY_ATTEMPT` (no attendance, security alert, review-queue event).
- **State machine:** PENDING → (FACE / QR / MANUAL) → PRESENT · QR_VERIFIED · UNVERIFIED_QR · PROXY_ATTEMPT · ABSENT.
- **Post-session:** ending a session opens an **Attendance Summary** with counts, verification-method breakdown, integrity checklist, and **PDF (pdfkit) + Excel (exceljs) exports** built from stored data.
- **UI consolidation:** Face Recognition (Kiosk, Enrollment, Insights) now lives as tabs inside the single **Presence** module alongside Sessions, Activity, Analytics, and Simulator.
- **Privacy:** only embeddings are stored, never raw images; enrollment is consent-first.

---

## 6. AI & Automation Engines

- **Pulse** — core ERP: students, staff, classes, attendance, fees/payments, notifications, role dashboards; records events on meaningful state changes.
- **Kairos** — timetable engine: a custom constraint solver enforcing hard rules (no teacher/class/room double-booking, lab requirements, weekly caps) with soft scoring (spread, gaps, heavy-subject timing). Workflow: **Draft → Review/Edit/Lock → Approve (Principal) → Publish → Rollback**, plus emergency substitutes and room-closure re-homing. Emits explainable conflicts and a **cost-ranked "cheapest way out"** when something can't fit.
- **Lumen** — document intelligence: **tesseract.js OCR + pdfjs** parse (with AcroForm digital-fill), a two-layer field model (expected vs commit policy), confidence + proof-crop provenance, and CSV/Excel export. Never launders machine-read data as human-verified.
- **Foresight** — predictive resource allocation via the Python intelligence service: absence, substitute-demand, attendance-trend, and fee-risk forecasts with driver explanations. Honest offline state when the service is down.
- **Presence** — see §5.
- **Copilot** — grounded admin assistant over live DB + event-store context; OpenAI when configured, deterministic intents otherwise; every answer logged to the AI Trust Ledger.

---

## 7. Trust Core, Security & Privacy

- **Event** (append-only) powers audit, undo, and the Time Machine; `recordEvent` writes + broadcasts, reversers undo attendance marks, fee payments, student creation, doc verification; compensating events keep the ledger honest.
- **AILog** records engine, action, reason, confidence, input, output, actor, reversibility. **AuditLog** records user actions.
- **Security:** JWT bearer auth, bcrypt hashing, API + UI role guards (Super Admin / Admin / Principal / Teacher / Student / Parent), school-scoped routes from the JWT, `/api` rate limiting, Helmet headers, CORS to the client origin. Face embeddings not raw images; emergency/AI actions logged.

---

## 8. Mobile Apps — Flutter + Riverpod (planned)

Native apps for the four human roles, built as **thin clients over the existing
Express API + Socket.io** — the same JWT, the same RBAC, the same Trust Core.
**Zero business logic is re-implemented on the device**, exactly mirroring how
the web SPA works.

### 8.1 Approach
- **One Flutter codebase, role-aware** (recommended): the logged-in user's role selects the navigation shell and feature set — this mirrors the single web SPA with role guards and keeps one code path against one API. Optional **build flavors** (`staff` vs `family`) can produce separate store listings later without forking logic.
- **Material 3** UI themed to Meridian's tokens; **Fraunces / Plus Jakarta Sans** via `google_fonts`.

### 8.2 State management — Riverpod (as requested)
- **flutter_riverpod 2.x** + **riverpod_annotation** / **riverpod_generator** (codegen).
- **AsyncNotifier / Notifier** providers hold server state with loading/error/data — the Riverpod equivalent of React Query on web (caching, refresh, invalidation on socket events).
- Provider layers: `authProvider` (session + JWT), `apiClientProvider` (configured Dio), per-feature **repository providers**, and screen-level `FutureProvider`/`AsyncNotifier`s. `ref.invalidate(...)` on incoming socket events keeps screens live.

### 8.3 Mobile stack (packages)
| Concern | Package |
|---|---|
| State management | `flutter_riverpod`, `riverpod_annotation` + `riverpod_generator` |
| Networking (REST) | `dio` (+ interceptors for JWT bearer & 401 → logout/refresh) |
| Realtime | `socket_io_client` (school room, mirrors web) |
| Routing + guards | `go_router` (role-based redirects, mirrors `RequireRole`) |
| Secure token store | `flutter_secure_storage` (JWT), `shared_preferences` (prefs) |
| Models / serialization | `freezed` + `json_serializable` (DTOs mirror server contracts) |
| QR scan / display | `mobile_scanner` (student scans session QR), `qr_flutter` |
| Camera (face capture) | `camera` → uploads frame to `/presence/session/:id/face` (server embeds; no biometric stored on device) |
| Push notifications | `firebase_messaging` + `flutter_local_notifications` |
| Charts | `fl_chart` (attendance trends, dashboards) |
| Fonts / theming | `google_fonts`, Material 3 |

### 8.4 Per-role feature scope
- **Principal** — full command center on the go: dashboards & health, **Kairos approve/publish/rollback**, attendance overview, Foresight forecasts, emergency broadcast, Trust ledger, reports.
- **Teacher** — **start an attendance session** (projector QR + live register), run the **face kiosk** (device camera), take/adjust attendance, view timetable, **arrange cover** for an absence, class rosters.
- **Student** — view timetable, **scan the session QR to mark attendance** (native `/scan` flow → `POST /presence/session/:id/qr`, identity from JWT), fees, notifications.
- **Parent** — child attendance (realtime "present at 9:02" push), fees & payments, timetable, emergency alerts.

### 8.5 Integration & backend additions
- Auth: `POST /auth/login` → store JWT securely → `GET /auth/me` on boot; Dio attaches the bearer; 401 clears the session. Same school-scoping and role guards as web.
- Realtime: connect `socket_io_client` with the JWT; invalidate the matching Riverpod providers on `event`, `notification`, `attendance:*`, and `timetable:*` messages.
- **New backend work for mobile (roadmap, additive):** an FCM device-token register/unregister endpoint + server-side push fan-out on attendance/fee/emergency notifications; optional refresh-token rotation for long-lived mobile sessions. No changes to existing engines.

---

## 9. Installed but Not Yet Fully Exploited
- **Redis** provisioned (Docker Compose) but not yet wired to Socket.io scaling, job queues, caching, or durable rate limiting.
- **PostgreSQL** provisioned/portable, but Prisma runs on SQLite by default.
- **React Hook Form** installed; most web forms still use local state.
- Face-service comments note **FAISS/pgvector** as the scale path for embeddings (cosine linear scan is the current baseline).

---

## 10. Roadmap — Highest-Impact Next Builds
1. **Flutter mobile apps** (Principal/Teacher/Student/Parent) on Riverpod — §8.
2. Push notifications: FCM token endpoint + server fan-out.
3. PostgreSQL + Prisma migrations (production data layer).
4. Redis: Socket.io adapter, BullMQ background jobs, cache, rate-limit store.
5. pgvector / FAISS for face + semantic search at scale.
6. Object storage (S3/R2/Supabase) for uploaded documents.
7. OR-Tools CP-SAT service behind Kairos for provably optimal schedules (keep TS as the explanation/orchestration layer).
8. Observability: Pino/Winston logs, Sentry, OpenTelemetry spans around AI/Prisma/socket work.
9. Playwright end-to-end demo flows; CI/CD with typed build + smoke tests.
10. Offline attendance queue / service worker for classroom kiosk mode.

---

## 11. One-Line Stack Pitch

Meridian is a realtime, event-sourced, audit-first AI operating system for
schools — **React + TypeScript + Vite** web, a **Node/Express + Prisma +
Socket.io** core, two **Python FastAPI** services (**scikit-learn** intelligence
and **InsightFace/ArcFace** face recognition), **SQLite→PostgreSQL** data with
**Redis** on deck, and **Flutter + Riverpod** apps for Principal, Teacher,
Student, and Parent — all sharing one API, one Trust Core, and one honest source
of truth.

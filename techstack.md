# Meridian Tech Stack

This document is based on the current codebase scan across the root workspace,
`client`, `server`, Prisma schema/seed data, route/service layers, frontend
pages/components/hooks/stores, local ML model manifests, Docker Compose, and
project docs. Generated/vendor output such as `node_modules`, `client/dist`,
SQLite database files, and model binaries was treated as runtime/build output,
not authored application code.

## Product Architecture

Meridian is a trust-first school operating system built as a TypeScript
monorepo:

- Frontend: React/Vite single-page app for dashboards, ERP workflows, AI
  engines, attendance kiosks, digital twin, reports, notifications, and role
  based self-service portals.
- Backend: Node.js/Express API with Prisma data access, authentication, RBAC,
  realtime events, AI service wrappers, and domain services.
- Data core: Prisma models for school operations plus an append-only event
  store, audit logs, AI logs, notifications, predictions, documents, emergency
  incidents, attendance, fees, timetables, and face embeddings.
- Trust layer: every important automated action is explainable, audited, and
  reversible where the domain allows it.

## Stack Already Used

### Workspace And Language

- npm workspaces for `client` and `server`.
- TypeScript across frontend, backend, Prisma seed scripts, and shared
  contracts.
- ES modules in both client and server packages.
- `concurrently` for running the Vite client and Express API together.
- `tsx` for server development and Prisma seeding.
- `tsc` for production builds and typechecking.

Current installed highlights:

- TypeScript `5.9.3`
- Vite `6.4.3`
- React `18.3.1`
- Express `4.22.2`
- Prisma `5.22.0`

### Frontend

- React 18 with React Strict Mode.
- Vite with `@vitejs/plugin-react`.
- React Router DOM for client routing and role-scoped pages.
- TanStack React Query for server state, caching, refetching, and realtime
  invalidation.
- Zustand for auth/session state, command palette state, and toast state.
- Axios for API calls with JWT request interception and 401 handling.
- Tailwind CSS, PostCSS, Autoprefixer, `clsx`, and `tailwind-merge` for the
  design system.
- Framer Motion for page transitions, dashboards, command palette, modals,
  gauges, scanning effects, and micro-interactions.
- Recharts for analytics visualizations such as attendance trends.
- Lucide React for the icon system.
- date-fns is installed for date utilities.
- React Hook Form and `@hookform/resolvers` are installed and ready for richer
  forms, although most current forms are implemented with local React state.
- Google Fonts are loaded in `client/index.html`: Inter, Inter Tight, and IBM
  Plex Mono.

### Browser APIs And Edge AI

- Web Speech API for voice commands in the command palette and Copilot.
- MediaDevices/getUserMedia for webcam capture.
- WebGL backend through `@vladmandic/face-api`/TensorFlow.js where available.
- Local storage for the current JWT token.
- Canvas APIs for face overlays, brightness sampling, and camera quality
  checks.

### Computer Vision And Face Recognition

- `@vladmandic/face-api` for browser-side face detection, landmarks, and
  128-dimensional recognition embeddings.
- Local model assets under `client/public/models`:
  - Tiny Face Detector
  - 68-point face landmark model
  - Face recognition model
- On-device face enrollment with multiple poses: front, left, right, up, down.
- Quality gates for detector confidence, face size, brightness, and framing.
- Blink/liveness detection based on eye aspect ratio.
- Cosine nearest-neighbor matching against enrolled vectors.
- Privacy model: raw frames/images are discarded; only numeric embeddings are
  stored.

### Backend API

- Node.js with Express.
- TypeScript ESM backend.
- Prisma Client as the database access layer.
- Socket.io for realtime school-scoped broadcasts.
- OpenAI SDK for grounded Copilot/report generation when an API key is
  configured.
- Deterministic fallback paths so demos continue working without OpenAI.
- Zod for request body validation.
- JWT auth with `jsonwebtoken`.
- Password hashing with `bcryptjs`.
- RBAC middleware for Super Admin, Admin, Principal, Teacher, Student, and
  Parent access.
- Multer with memory storage for document upload simulation.
- Helmet, CORS, compression, cookie-parser, express-rate-limit, and Morgan for
  security, cross-origin access, response compression, cookies, rate limiting,
  and dev logging.

### Database And Persistence

- Prisma schema currently configured for SQLite for zero-setup local demos.
- Local database file: `server/prisma/meridian.db` exists locally and is ignored
  by Git.
- Schema is written to stay portable to PostgreSQL: string constants instead of
  native enums and JSON payloads stored as strings.
- Docker Compose includes:
  - PostgreSQL 16 Alpine for production-grade persistence.
  - Redis 7 Alpine for future realtime scaling, queues, caching, and rate-limit
    storage.
- Prisma seed script creates a realistic school demo: users, roles, classes,
  staff, students, parents, rooms, buildings, attendance history, fees,
  documents, AI logs, events, settings, and an initial timetable.

### Current Data Model Areas

- Tenant and identity: School, User, Teacher, Student, Parent, StudentParent.
- Academic structure: Class, Subject, Building, Room.
- Operations: Attendance, Fee, Payment, Timetable, TimetableSlot,
  StaffAbsence, Substitution.
- Intelligence: Document, ExtractedField, Prediction, AILog.
- Trust and audit: Event, AuditLog.
- Communication: Notification, EmergencyIncident.
- Configuration: Setting.
- Biometric attendance: FaceEmbedding, FaceEvent.
- Presence: RFIDCard, RFIDReader, ReaderHeartbeat, AttendanceEvent
  (append-only raw scan log — Attendance stays the materialized daily view).

### Realtime Layer

- Socket.io server joins clients to `school:{schoolId}` rooms.
- Realtime broadcasts are used for:
  - New immutable events
  - AI log updates
  - Notifications
  - Presence scan outcomes and reader online/offline status
  - Emergency trigger/resolve events
  - Unknown face events
- React Query cache invalidation keeps dashboards, attendance, twin, events,
  stats, and notifications fresh after realtime updates.

### AI And Automation Engines

#### Lumen

- Current role: document intelligence and review queue.
- Current implementation: deterministic, template-aware extraction for demo
  resilience.
- Stores structured extracted fields, confidence scores, review state, and
  normalized proof-crop coordinates.
- Uses Multer upload entrypoint and writes AI logs plus immutable events.

#### Kairos

- Current role: timetable optimization and what-if simulation.
- Current implementation: lightweight custom constraint-style solver.
- Hard constraints handled in code:
  - No teacher double-booking.
  - No class double-booking.
  - No room/lab double-booking.
  - Lab requirements.
  - Teacher weekly hour caps.
- Soft scoring includes spread of cognitive load and conflict penalties.
- Returns explainable conflicts and suggested fixes.

#### Pulse

- Current role: core ERP automation.
- Covers students, staff, classes, attendance, fees, payments, notifications,
  role dashboards, and family/teacher/admin views.
- Uses event recording for meaningful state changes.

#### Foresight

- Current role: predictive resource allocation.
- Current implementation: transparent data-derived forecasting from attendance,
  fee, teacher, and class data.
- Produces absence, substitute-demand, attendance-trend, and fee-risk
  predictions with SHAP-style driver explanations.

#### Presence

- Current role: event-driven attendance platform. RFID, QR, manual and face
  recognition all normalize to one `ScanInput` and flow through a single
  `processScan()` pipeline (`server/src/services/presence/engine.ts`) —
  attendance is the event that drives the rest of the ERP, not a feature
  bolted onto it.
- Full RFID card lifecycle (issue/replace/disable/lost/broken/reissue,
  duplicate-UID detection) and reader fleet management (heartbeat, online/
  offline sweep, per-reader device key).
- Configurable duplicate-scan window, late-arrival policy, and entry/exit/
  re-entry direction inference, all evaluated inside one transaction per
  scan.
- Unknown cards raise a reviewable security notification instead of ever
  creating attendance.
- A production-shaped simulator drives the same pipeline a real reader
  would — swapping in hardware means pointing a small gateway at the same
  `/api/presence/scan` endpoint with a device key.
- Face enrollment, live kiosk recognition and liveness checks are unchanged;
  the kiosk's attendance write now goes through the same shared engine.

#### Copilot

- Current role: grounded operational assistant for administrators.
- Uses live database snapshots and event-store context.
- Uses OpenAI text generation when configured; otherwise routes through
  deterministic intents.
- Logs every answer into the AI Trust Ledger.

### Trust Core

- Append-only `Event` table is the source for audit, undo, and Time Machine.
- `recordEvent` writes an immutable event and broadcasts it in realtime.
- `undoEvent` uses domain-specific reversers for attendance marks, fee
  payments, student creation, and document verification.
- Compensating events preserve ledger honesty after undo.
- `AILog` records engine, action, reason, confidence, input, output, actor, and
  reversibility.
- `AuditLog` records user actions such as login and CRUD actions.

### Security And Privacy

- JWT bearer auth.
- Password hashing with bcrypt.
- API and UI role guards.
- School-scoped routes through `schoolId` from the JWT payload.
- Rate limiting on `/api`.
- Helmet security headers.
- CORS configured for the client origin.
- Face attendance stores embeddings, not raw images.
- Emergency actions and AI actions are logged.
- Trust Ledger gives judges a clear "why did AI do this?" story.

### Dev, Build, And Local Runtime

- Root commands:
  - `npm run install:all`
  - `npm run db:setup`
  - `npm run seed`
  - `npm run dev`
  - `npm run build`
  - `npm run start`
- Client:
  - `npm --prefix client run dev`
  - `npm --prefix client run build`
  - `npm --prefix client run preview`
  - `npm --prefix client run typecheck`
- Server:
  - `npm --prefix server run dev`
  - `npm --prefix server run build`
  - `npm --prefix server run start`
  - `npm --prefix server run db:setup`
  - `npm --prefix server run seed`
  - `npm --prefix server run typecheck`

## Installed But Not Fully Exploited Yet

- Redis is present in Docker Compose but not yet wired into Socket.io scaling,
  job queues, caching, or rate limiting.
- PostgreSQL is documented and provisioned through Docker Compose, but Prisma is
  currently set to SQLite.
- React Hook Form is installed but current forms are mostly local state.
- OpenAI is wired for Copilot/report generation, while Lumen extraction is still
  deterministic rather than true OCR/vision.
- The face service comments mention FAISS/pgvector as scale paths; neither is
  implemented yet.
- There is no dedicated automated test stack in the current package manifests.

## Stack To Add For A Winning-Level Hackathon Demo

These are the highest-impact additions that fit the current architecture
without derailing the product.

### Production Data Layer

- Move the demo deployment to PostgreSQL using the existing Prisma portability
  plan.
- Use Prisma migrations instead of only `db push` for a credible production
  story.
- Add Redis for:
  - Background jobs.
  - Socket.io multi-instance adapter.
  - Cache for dashboards/predictions.
  - Durable rate-limit storage.

Recommended path:

- PostgreSQL on Neon, Supabase, Railway, Render, or Docker for the hackathon
  environment.
- Redis on Upstash, Railway, Render, or Docker.
- Keep SQLite as the local zero-friction fallback.

### Background Jobs

- Add BullMQ backed by Redis.
- Queue document processing, report generation, prediction refreshes, face
  gallery rebuilds, and notification fan-out.
- Show job states in the UI for judge-friendly reliability.

### Real Document Intelligence

- Upgrade Lumen from deterministic extraction to real OCR plus structured AI
  mapping.
- Good options:
  - Tesseract.js for in-browser or Node OCR.
  - PaddleOCR or Python OCR microservice for stronger local extraction.
  - Cloud OCR such as Google Document AI, Azure AI Document Intelligence, or
    AWS Textract if external services are allowed.
  - OpenAI vision-capable extraction with strict JSON schema for field mapping
    and confidence/provenance explanations.
- Preserve the current proof-crop UX because it is one of the strongest trust
  differentiators.

### Stronger Timetable Optimization

- Keep the current custom Kairos solver for demo speed, but add a real solver
  backend for credibility.
- Best upgrade path:
  - OR-Tools CP-SAT in a small Python service for hard constraints and optimal
    schedules.
  - Keep the TypeScript service as the explanation/orchestration layer.
- Add saved scenarios, constraint weights, and before/after score comparison.

### Vector Search And Biometrics Scale

- Add pgvector in PostgreSQL for face embeddings and future semantic search.
- Alternative local scale path: FAISS service for nearest-neighbor lookup.
- Keep cosine similarity and current thresholding as the first-pass baseline.
- Add vector indexes when enrollment grows beyond small demo size.

### AI Reliability Layer

- Keep the OpenAI SDK wrapper model-agnostic through `OPENAI_MODEL`.
- Add strict JSON schemas for every AI action that writes state.
- Add confidence calibration and "needs human review" thresholds.
- Add prompt/version logging to `AILog` so judges can see reproducibility.
- Add evaluation fixtures for Copilot, Lumen, Foresight, and Reports.

### Realtime And Offline Resilience

- Add Socket.io Redis adapter for horizontal scaling.
- Add service-worker caching for the client.
- Add an offline attendance queue for classroom/kiosk mode.
- Sync queued attendance events back through the same event store when the
  device reconnects.

### File Storage

- Add object storage for uploaded documents instead of memory-only uploads.
- Good hackathon-ready options:
  - S3-compatible storage.
  - Supabase Storage.
  - Cloudflare R2.
  - Railway/Render disk only for quick demos, not long-term production.
- Store URLs in the existing `Document.fileUrl` field.

### Testing And Quality

- Add Vitest for TypeScript unit tests.
- Add React Testing Library for critical UI flows.
- Add Supertest for Express route tests.
- Add Playwright for end-to-end demo flows:
  - Login as each role.
  - Mark attendance.
  - Run Kairos solve.
  - Upload/process Lumen document.
  - Ask Copilot.
  - Trigger/resolve emergency drill.
  - Undo an event in Trust Core.
- Add a test database strategy using SQLite for fast tests and PostgreSQL for
  integration smoke tests.

### Observability

- Add structured logging with Pino or Winston.
- Add Sentry for frontend/backend errors.
- Add OpenTelemetry spans around AI calls, Prisma queries, background jobs, and
  realtime broadcasts.
- Add PostHog or a similar product analytics layer for demo insights.

### CI/CD And Deployment

- Add GitHub Actions:
  - Install dependencies.
  - Typecheck client and server.
  - Build client and server.
  - Run tests once added.
  - Run Prisma validation/generation.
- Deployment options:
  - Vercel or Netlify for the Vite client.
  - Render, Railway, Fly.io, or Docker VPS for the Express API.
  - Managed PostgreSQL and Redis for reliability.
- Add environment variable templates:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `JWT_EXPIRES_IN`
  - `CLIENT_ORIGIN`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - Object storage credentials when added.

## Hackathon Positioning By Stack

### What Judges Can See Immediately

- React/Tailwind/Framer Motion gives a polished command-center experience.
- Socket.io makes the app feel live instead of static.
- Prisma schema shows a real school operating model, not a toy demo.
- Face recognition runs on-device and avoids raw biometric image storage.
- Trust Core makes the AI explainable, reversible, and auditable.
- Deterministic fallbacks make the demo reliable even when external AI fails.

### What Makes The Idea Defensible

- The product is not just "AI chat over school data"; it has operational
  systems, role-based access, event sourcing, and auditability.
- AI actions are logged with confidence and reasons.
- Attendance, fees, documents, timetable, predictions, emergency mode, and
  reports all connect through the same source of truth.
- The current architecture can move from SQLite to PostgreSQL without a rewrite.
- The same realtime layer supports admin, teacher, parent, student, and kiosk
  surfaces.

### Highest-Impact Next Build Order

1. PostgreSQL + Prisma migrations.
2. Real OCR for Lumen.
3. BullMQ + Redis background jobs.
4. Playwright demo tests.
5. OR-Tools-backed Kairos solver.
6. pgvector or FAISS for scalable face/semantic matching.
7. Object storage for uploaded documents.
8. Sentry/OpenTelemetry observability.
9. Offline attendance queue/service worker.
10. CI/CD with typed build and smoke tests.

## One-Line Stack Pitch

Meridian uses React, TypeScript, Vite, Tailwind, Framer Motion, React Query,
Zustand, Node, Express, Prisma, Socket.io, OpenAI, SQLite/PostgreSQL, Redis,
and on-device TensorFlow.js face recognition to deliver a realtime,
event-sourced, audit-first AI operating system for schools.

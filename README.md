# ⬦ Meridian — the trust-first operating system for schools

> Five engines, one source of truth. Every automated action is **explainable, reversible and audited** — so you can automate everything, because you can undo anything.

A complete, production-shaped full-stack application for the **Future-Ready Ops** challenge: React + TypeScript + Tailwind on the front, Node + Express + Prisma + Socket.io on the back, with real OpenAI-powered AI (and a deterministic, data-grounded fallback so it never fails on stage).

---

## ✨ What's inside

### The five engines (every problem-statement requirement, mapped)
| Requirement | Engine | Where |
| --- | --- | --- |
| AI Document Processing | **Lumen** | `/lumen` — upload → verified record with confidence + clickable **pixel-level proof crops** + human-in-the-loop review queue |
| Timetable Optimization | **Kairos** | `/kairos` — constraint solver, **explainable conflicts** (minimal core + cheapest fix), what-if simulation |
| School ERP Automation | **Pulse** | Students, Staff, Classes, Attendance, Fees — event-sourced, realtime |
| The Admin Dashboard | **Pulse · Command Center** | `/` — proactive anomaly-ranked alerts, ⌘K palette, Copilot |
| Predictive Resource Allocation | **Foresight** | `/foresight` — absence & substitute-demand forecasts with SHAP-style drivers |
| Automated Attendance (RFID / CV) | **Presence** | `/presence` — RFID + on-device face-embedding kiosk, **zero raw images stored** |

### The 10 "wow" features
1. **School Digital Twin** — live animated campus map (`/twin`), occupancy · teacher presence · attendance · power
2. **AI Principal Copilot** — grounded operational assistant (`/copilot`), answers from the live event store
3. **Emergency Mode** — one button (`/emergency`) fans Fire/Earthquake/Medical/Lockdown alerts to everyone + evacuation protocol
4. **AI Insight Feed** — natural-language insights with cause + confidence (dashboard)
5. **Time Machine** — visual slider (`/trust`) to rewind the whole school to any past moment
6. **Voice Commands** — say *"Mark 8A absent"* in the ⌘K palette or Copilot (Web Speech API)
7. **Smart Notifications** — actionable ("3 teacher conflicts, fix ready"), not "new fee due"
8. **AI-Generated Reports** — one-click executive summary + recommendations (`/reports`)
9. **Audit Timeline** — git-style history with one-tap **Undo** (`/trust`)
10. **Beautiful animations** — Framer Motion, glassmorphism, animated gradients, Recharts, micro-interactions

### The Trust Core
Append-only **event store** → materialized views → **Time Machine** replay + **undo**. Every AI action is written to the **Trust Ledger** (who · what · why · confidence · reversible).

---

## 🚀 Quick start

```bash
# from the repo root
npm run install:all       # install root + server + client
npm --prefix server run db:setup   # create the SQLite DB + Prisma client
npm --prefix server run seed       # seed a realistic school
npm run dev                # runs server (:4000) + client (:5173) together
```

Open **http://localhost:5173**.

### Demo logins (password: `meridian123`)
| Role | Email |
| --- | --- |
| Principal | `principal@meridian.school` |
| Admin | `admin@meridian.school` |
| Teacher | `teacher@meridian.school` |
| Student | `student@meridian.school` |
| Parent | `parent@meridian.school` |

> The login screen also has **one-tap role buttons** — no typing needed.

---

## 🔌 Enabling real OpenAI

AI works out of the box using a deterministic, data-grounded simulation. To use **real OpenAI**:

```bash
# server/.env
OPENAI_API_KEY=sk-...        # your key
OPENAI_MODEL=gpt-4o-mini     # or any chat model
```

Restart the server. Copilot answers and report narratives now come from OpenAI — still **grounded** on live data, and the app transparently falls back to simulation if the key is missing or a call fails.

---

## 🏗️ Architecture

```
Experience layer (React + Vite + Tailwind + Framer Motion)
  Admin Command Center · Staff app · Presence kiosk · Parent portal
        ▲ reactive React Query · Socket.io realtime ▼
Trust Core (Express + Prisma) — append-only event store = single source of truth
  every change → event → materialized view → Time Machine replay & audit
        ▼ events fan out to intelligence services ▼
  Lumen (OCR+map) · Kairos (solver) · Foresight (forecast) · Presence (edge) · Copilot (grounded LLM)
```

### Stack
- **Frontend:** React 18 · TypeScript · Vite · TailwindCSS · React Router · TanStack Query · Zustand · Framer Motion · Recharts · Socket.io-client
- **Backend:** Node · Express · TypeScript · Prisma · SQLite (Postgres-ready) · Socket.io · JWT · bcrypt · Zod · Multer · OpenAI
- **Cross-cutting:** RBAC (6 roles) · event sourcing · Trust Ledger · offline-tolerant · realtime

### Data model
`School · User · Teacher · Student · Parent · Class · Subject · Building · Room · Attendance · Document · ExtractedField · Timetable · TimetableSlot · StaffAbsence · Substitution · Fee · Payment · Prediction · Event · AILog · AuditLog · Notification · EmergencyIncident · Setting`

---

## 🐘 Switching to Postgres (production)

Local dev uses **SQLite** for zero setup. For Postgres:

1. `docker compose up -d` (starts Postgres + Redis)
2. `server/.env` → `DATABASE_URL="postgresql://meridian:meridian@localhost:5432/meridian?schema=public"`
3. `server/prisma/schema.prisma` → set `datasource db { provider = "postgresql" }`
4. `npm --prefix server run db:setup && npm --prefix server run seed`

The schema is written to be portable across both (string constants instead of native enums, JSON-as-text payloads).

---

## 📁 Structure

```
meridian/
├── server/
│   ├── prisma/{schema.prisma, seed.ts}
│   └── src/
│       ├── config/            env
│       ├── lib/               prisma, auth, socket, openai, errors, json
│       ├── middleware/        auth (RBAC), error
│       ├── services/          eventStore, trustLedger, kairos, foresight, lumen, copilot, notifications
│       └── routes/            auth, dashboard, students, staff, classes, attendance,
│                              timetable, fees, documents, notifications, predictions,
│                              twin, emergency, copilot, trust, reports
└── client/
    └── src/
        ├── components/{ui, layout}   design system + Sidebar/Topbar/CommandPalette/…
        ├── hooks/                    useRealtime, useVoice
        ├── pages/                    18 fully-wired pages
        ├── store/                    auth, ui (Zustand)
        ├── lib/                      api, socket, utils
        └── types/                    shared TypeScript contracts
```

---

**Automate everything — because you can undo anything.**

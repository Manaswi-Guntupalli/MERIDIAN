# Meridian

> **Every school decision, explained.**

Meridian is a trust-first operating system for schools. It gives school leaders one calm place to run the day: understand what needs attention, automate routine work, verify attendance, communicate clearly, and trace every meaningful action back to its source.

Built by **Manaswi Guntupalli** with a simple conviction: school software should make decisions easier to trust—not harder to question.

![Meridian Operations Command Center](docs/screenshots/meridian/dashboard-command-center.png)

## Watch Meridian in action

| Full platform walkthrough | Flutter companion walkthrough |
| --- | --- |
| **[▶ Watch `MERIDIAN_FINAL_DEMO`](https://drive.google.com/file/d/1XiFDfz1RLQ4IhYxchJI3ik3Bu4OIdWdm/view?usp=sharing)**<br>Explore the principal web experience: operations, intelligence, attendance, communication, and Trust Core. | **[▶ Watch `MERIDIAN_APP_FINAL_DEMO`](https://drive.google.com/file/d/1n_vcO8DhqhWMGlWz1RQwOzrBMm2tdJof/view?usp=sharing)**<br>See the mobile experience for principals, students, and families—including QR attendance. |

## What makes Meridian different

Most school products are systems of record. Meridian is a system of **understanding and action**.

| See the signal | Take the right action | Keep the proof |
| --- | --- | --- |
| The command center turns attendance, fees, staffing, timetable, and documents into a ranked operational picture. | AI suggestions are actionable, but people remain in control. High-impact changes are reviewed before they are applied. | Every important result carries confidence, provenance, and an auditable history—so “the system said so” is never the final answer. |

## A school day, in Meridian

1. **See what matters now.** The Operations Command Center computes school health and highlights the next best action.
2. **Resolve operational friction.** Cover an absent teacher, process a form, or publish a timetable without losing the why behind the decision.
3. **Verify, do not merely record.** Presence combines face verification with a short-lived QR fallback and flags suspected proxy attempts.
4. **Communicate and recover confidently.** Draft notices, coordinate emergencies, replay changes, and inspect the AI Trust Ledger.

## Product tour

### The Operations Command Center

The dashboard is the school’s daily briefing: a transparent health score, cross-functional signals, and a ranked list of things that need attention. It is designed to answer one question quickly: **what should I do next?**

![Meridian dashboard with school health, live metrics, and recommended actions](docs/screenshots/meridian/dashboard-command-center.png)

### Lumen — documents that read themselves

Drop in a school form and Lumen extracts structured fields, preserves confidence for every value, and shows the source crop behind the extraction. Low-confidence values stay in a human review loop instead of silently becoming records.

| Document intake | Field-level proof |
| --- | --- |
| ![Lumen document processing queue](docs/screenshots/meridian/lumen-overview.png) | ![Lumen extracted admission form with confidence and proof](docs/screenshots/meridian/lumen-provenance.png) |

### Kairos — timetables people can live with

Kairos generates, reviews, publishes, and versions the school timetable. It treats a change as an operational decision: coverage, staff comfort, and balance are checked before a draft goes live. When a teacher is absent, Cascade proposes qualified substitutes only for the affected periods.

| Live timetable | Explainable cover plan |
| --- | --- |
| ![Kairos timetable grid](docs/screenshots/meridian/kairos-timetable.png) | ![Cascade cover plan with qualified substitute recommendations](docs/screenshots/meridian/cascade-assignments.png) |

| Version history |
| --- |
| ![Kairos timetable history showing live and archived versions](docs/screenshots/meridian/kairos-history.png) |

### Foresight — see strain before it hits

Foresight combines the school’s live signals into cautious forecasts and an at-risk queue. It shows intervals rather than pretending to know the future perfectly, and every risk is paired with a concrete next action.

| Forecasts, not point promises | Prioritised student-risk queue |
| --- | --- |
| ![Foresight attendance, substitute, fee, and document-load forecasts](docs/screenshots/meridian/foresight-overview.png) | ![Foresight ranked at-risk students with message and flag actions](docs/screenshots/meridian/foresight-risk-list.png) |

### Presence — attendance with integrity

Presence turns attendance into a verifiable flow. A teacher opens a session; students use face verification or a session QR fallback; the live register makes the state visible as it changes. The system keeps only biometric embeddings—not face photographs—and blocks possible QR/face mismatches as proxy attempts.

| Start a class session | Live QR and register |
| --- | --- |
| ![Presence attendance sessions](docs/screenshots/meridian/presence-sessions.png) | ![Presence QR attendance screen and live student register](docs/screenshots/meridian/presence-qr-roster.png) |

![Presence insights showing enrollment coverage and a blocked proxy attempt](docs/screenshots/meridian/presence-insights.png)

### Meridian Mobile — the school in every hand

The Flutter companion brings the same operating model to the people who need it most. Principals can see school health, attendance, timetables, Copilot, notices, emergencies, and alerts from a phone. Students scan attendance QR codes; parents receive a focused view of each child’s attendance, timetable, fees, and notifications.

Watch the complete mobile walkthrough: **[▶ `MERIDIAN_APP_FINAL_DEMO`](MERIDIAN_APP_FINAL_DEMO.mp4)**.

#### Principal mobile companion

| Sign in | School overview | Attendance | Timetable |
| --- | --- | --- | --- |
| ![Meridian mobile sign-in](docs/screenshots/flutterappss/image1.jpg) | ![Meridian mobile school overview](docs/screenshots/flutterappss/image2.jpg) | ![Meridian mobile attendance](docs/screenshots/flutterappss/image3.jpg) | ![Meridian mobile timetable](docs/screenshots/flutterappss/image4.jpg) |

| Copilot | Emergency | AI Notice | Notifications |
| --- | --- | --- | --- |
| ![Meridian mobile Copilot answer](docs/screenshots/flutterappss/image5.jpg) | ![Meridian mobile emergency coordination](docs/screenshots/flutterappss/image6.jpg) | ![Meridian mobile AI Notice](docs/screenshots/flutterappss/image7.jpg) | ![Meridian mobile notifications](docs/screenshots/flutterappss/image8.jpg) |

#### Student and family companion

| Student home | QR attendance scan | Parent home | Attendance history |
| --- | --- | --- | --- |
| ![Meridian student home](docs/screenshots/flutterappss/image9.jpg) | ![Meridian student QR attendance scanner](docs/screenshots/flutterappss/image10.jpg) | ![Meridian parent home](docs/screenshots/flutterappss/image11.jpg) | ![Meridian family attendance history](docs/screenshots/flutterappss/image12.jpg) |

| Fees | Family alerts |
| --- | --- |
| ![Meridian family fees](docs/screenshots/flutterappss/image13.jpg) | ![Meridian family notifications](docs/screenshots/flutterappss/image14.jpg) |

### Copilot — grounded answers, human-approved actions

Copilot is an operational assistant grounded in Meridian’s live event store. It answers questions such as “Which students are below 75% attendance?” with the supporting facts, a confidence signal, and relevant follow-up actions. It can propose actions, but it does not run them without confirmation.

![Copilot answer grounded in live attendance data with one-click follow-up actions](docs/screenshots/meridian/copilot-grounded-answer.png)

### Trust Core — communication, coordination, and memory

Meridian keeps automation accountable across the product:

| AI Notice | Notifications | Emergency coordination |
| --- | --- | --- |
| ![AI Notice drafting workflow](docs/screenshots/meridian/ai-notice.png) | ![Actionable school notifications](docs/screenshots/meridian/notifications.png) | ![Emergency coordination choices and accountability](docs/screenshots/meridian/emergency-coordination.png) |

The **Time Machine** and **AI Trust Ledger** make the history visible: who changed what, when it happened, which engine acted, and how confident the system was. The result is software that can be reviewed, explained, and, where appropriate, reversed.

![Meridian AI Trust Ledger](docs/screenshots/meridian/trust-ledger.png)

## Six connected engines

| Engine | What it does | Trust mechanism |
| --- | --- | --- |
| **Pulse** | Manages students, staff, classes, attendance, and fees. | A shared operational record for the school. |
| **Lumen** | Extracts structured data from school documents. | Field confidence and visual provenance. |
| **Kairos** | Generates and maintains timetables; handles cover. | Draft → review → publish workflow and version history. |
| **Foresight** | Forecasts operational demand and surfaces risk. | Prediction intervals, evidence, and ranked actions. |
| **Presence** | Runs face-assisted, QR-backed attendance. | Session-bound verification, proxy detection, embeddings only. |
| **Copilot** | Answers operational questions and proposes next steps. | Live-data grounding, confidence, confirmation, and Trust Ledger entries. |

## Trust is a product feature

Meridian does not treat trust as a compliance page. It is built into the interaction model.

- **Grounded intelligence:** Copilot uses operational data and shows the basis for its answer.
- **Human-in-the-loop:** Document fields, timetable drafts, notices, and actions have review/confirm points.
- **Confidence, not false certainty:** OCR and forecasts expose confidence and intervals.
- **Auditable operations:** key actions are recorded in an event and audit history.
- **Privacy-aware presence:** face photos are not retained after embedding; sensitive attendance flows are role-bound.
- **Recoverable change:** timetable versions, timeline views, and explicit workflow states make it possible to inspect and correct changes.

## Architecture

```text
                            ┌─────────────────────────────────────┐
                            │           React + Vite web           │
                            │      principal, staff & admin UI     │
                            └──────────────────┬──────────────────┘
                                               │
                     ┌─────────────────────────▼─────────────────────────┐
                     │              Node.js + Express API                 │
                     │  auth · business workflows · Socket.IO · auditing  │
                     └───────────────┬────────────────────┬──────────────┘
                                     │                    │
                    ┌────────────────▼───────┐  ┌─────────▼──────────────┐
                    │ Prisma + SQLite/Postgres│  │ Flutter student app     │
                    │ school record + events  │  │ QR attendance scanning  │
                    └─────────────────────────┘  └────────────────────────┘
                                     │
              ┌──────────────────────┴──────────────────────┐
              │                                             │
┌─────────────▼──────────────┐               ┌──────────────▼─────────────┐
│ Intelligence service        │               │ Face service                │
│ FastAPI · OCR · forecasts   │               │ FastAPI · embeddings        │
│ risk modelling · Copilot    │               │ verification · proxy checks │
└─────────────────────────────┘               └────────────────────────────┘
```

## Run Meridian locally

### Prerequisites

- Node.js 20+
- Python 3.10+
- npm

### Setup

```bash
git clone <your-repository-url>
cd MERIDIAN
npm run setup
```

### Start the full local experience

Use three terminals:

```bash
# Terminal 1 — web app and API
npm run dev
```

```bash
# Terminal 2 — intelligence: OCR, forecasts, and Copilot support
npm run intelligence
```

```bash
# Terminal 3 — face embeddings and verification
npm run faceservice
```

Then open:

| Surface | Address |
| --- | --- |
| Web application | `http://localhost:5173` |
| API health | `http://localhost:4000/api/health` |
| Intelligence health | `http://localhost:8010/health` |
| Face service health | `http://localhost:8020/health` |

For the seeded demonstration environment, sign in with `principal@meridian.school` and password `meridian123`. The sign-in screen also exposes one-tap demo roles.

![Meridian sign-in and one-tap demo roles](docs/screenshots/meridian/sign-in.png)

## Five-minute demo route

For a compelling end-to-end walkthrough, do this:

1. Start at the **Dashboard** and explain the health score and recommended-action queue.
2. Open **Lumen** and show one low-confidence form field with its proof crop.
3. Open **Kairos**, generate/review a cover plan, then show timetable history.
4. Open **Presence**, start a class session, scan the QR with the Student app, and show the live register or Simulator result.
5. Ask **Copilot** which students are below 75% attendance; open the **Trust Ledger** to close with accountability.

For attendance testing, see [the Presence simulator guide](docs/presence-attendance-simulator.md).

## Project structure

```text
MERIDIAN/
├── client/            # React + TypeScript + Vite principal/staff interface
├── server/            # Express API, Prisma schema, workflows, Socket.IO
├── intelligence/      # FastAPI intelligence service: OCR, forecasting, Copilot logic
├── faceservice/       # FastAPI face embedding and verification service
├── flutter_app/       # Flutter student QR attendance application
├── docs/              # product, demo, and implementation documentation
└── scripts/           # local setup and development helpers
```

## Documentation

- [Presence attendance simulator](docs/presence-attendance-simulator.md)
- [Screenshot asset catalogue](docs/screenshots/README.md)
- [API and implementation notes](docs/)

---

**Meridian** is not school software that merely stores what happened. It is a school operating system that helps people decide what to do next—and makes the decision explainable.

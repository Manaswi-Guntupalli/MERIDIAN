# Presence — RFID Attendance & the Scan Simulator

> **What this page is:** a control panel that lets you fire the *exact* attendance
> engine a physical RFID gate would fire — without owning any hardware. Every
> button on the Simulator posts to the same `processScan()` engine that a real
> reader hits. There is **no separate "demo" code path** that fakes attendance.
>
> **Where it lives in the app:** `Presence → Simulator` (staff/admin only).

---

## 1. The honest truth first (what is real vs. simulated)

This is the most important thing to understand, so it's stated up front and
without spin.

**What is 100% real** — identical to production hardware:

- The scan engine. Every scenario calls
  [`processScan()`](../server/src/services/presence/engine.ts), the single
  ingest point every attendance source funnels through (real reader, this
  simulator, manual mark, face-recognition).
- The database writes. Each scan writes a real `AttendanceEvent` row and, when
  appropriate, materializes/updates the daily `Attendance` row — inside **one
  transaction**.
- The side effects. Real socket broadcasts, real trust-ledger audit entries,
  real parent notifications (in-app + SMS/email/push channels), real admin
  security alerts for unknown cards.
- The heartbeat / online logic. "Virtual gate hardware" sends the same
  `recordHeartbeat` a physical reader sends.

**The only two things the Simulator is allowed to do that hardware isn't**
(and both exist purely so demos are reproducible, per the note in
[`simulate.routes.ts`](../server/src/routes/presence/simulate.routes.ts)):

1. **Force a reader's online/offline state** — so you can demo an "Offline
   reader" rejection on command instead of unplugging a device.
2. **Override the event timestamp** (`simulateAt`) — used by **exactly one**
   scenario, "Late arrival", so you don't have to wait until after the
   school-start grace window to see a LATE classification.

Everything else — the decision of present/late/duplicate/rejected/unknown, the
notifications, the audit trail — is produced by the same code that runs for a
real tap. That's why the page says *"Every button calls the exact engine a
physical reader would — nothing here is faked."* It is literally true.

---

## 2. How to use it (the happy path, step by step)

The page is laid out top-to-bottom as three steps, then a live result feed.

### Step 1 — Keep the "Virtual gate hardware" toggle ON
- Real readers send a heartbeat every few seconds. If a reader goes silent for
  longer than the offline threshold (**default 90 s**), the engine marks it
  **Offline** and **rejects its scans**.
- While this toggle is **on**, the Simulator sends a heartbeat for *every*
  reader in the school **every 45 seconds** — comfortably inside the 90 s
  threshold — so your demo readers behave like healthy hardware.
- The badge shows `X / Y readers online`. You want it green before scanning.

> If you turn this **off**, readers will naturally drift Offline within ~90 s and
> scans will start getting rejected. That's not a bug — it's the same protection
> that stops a dead gate from silently losing attendance.

### Step 2 — Choose a gate and a student card
- **Gate (reader):** e.g. *Block A Reader · Block A Entrance*. Pre-selected to
  the first reader so buttons work immediately.
- **Student card:** e.g. *Reyansh Khan · RFID-00132*. Pre-selected to the first
  active card.
- If the reader you pick is Offline, an amber banner appears with a **"Bring it
  online"** button (forces it back online instantly).
- **(Optional) "Use a connected USB/serial reader":** arms a listener so a real
  USB/serial RFID reader acts as a keyboard and its tag scan fills the Card
  field. This is **only** for demoing with genuine hardware — you never need it
  to use the simulator.

### Step 3 — Run a scenario
Click any button. The result appears **instantly** in the "What happened" feed
at the bottom, and the same event flows into Overview, Activity, the dashboards,
and parent notifications.

---

## 3. Every scenario, exactly what it does

### Everyday flow

| Button | Endpoint | What the engine does | Result |
|---|---|---|---|
| **Entry scan** | `POST /presence/simulate/scan` | Selected card taps the selected reader. Direction is *inferred* — first event of the day → **ENTRY**. Marks the student **present** and notifies parents. | `Present` (or `Late`) |
| **Exit scan** | `POST /presence/simulate/exit` | Same student, direction forced to **EXIT**. Logged as an exit. Because only ENTRY/RE-ENTRY mark presence, **an exit never un-marks a day** already recorded present. | `Present` badge, direction "Exit" |
| **Random student** | `POST /presence/simulate/random` | Picks a random *active* card + random *online* reader and runs a full scan. Good for filling the feed. | Usually `Present` |
| **Morning rush** | `POST /presence/simulate/burst` | Loops N times (the number box, default **8**, max 30), each a random active card at the chosen (or a random online) reader. | N results |

### Edge cases the engine must catch

| Button | Endpoint | What the engine does | Result |
|---|---|---|---|
| **Late arrival** | `POST /presence/simulate/late` | The *only* scenario that overrides the timestamp: it sets the tap to **school-start + grace + 20 min** and forces ENTRY. The engine sees the tap is past the threshold and classifies it late, computing exact **minutes late**. (Defaults: start `08:00`, grace `5 min` → tap ≈ `08:25`.) | `Late` + minutes late |
| **Duplicate tap** | `POST /presence/simulate/duplicate` | Scans the same card **twice in a row**. The second tap falls inside the duplicate window (**default 120 s**), so it's **logged but never double-counted**. | 1st `Present`, 2nd `Duplicate` |
| **Unknown card** | `POST /presence/simulate/unknown-card` | Generates a random `UNKNOWN-xxxx` UID that was never issued. The engine records it as **UNKNOWN** and raises a **security review for admins** (Presence → Unknown Cards). It is **not** counted as attendance. | `Needs review` |
| **Offline reader** | `POST /presence/simulate/offline-reader` | Forces the selected gate **Offline**, then scans it → **rejected** with reason *"Reader is offline"*. Virtual hardware revives it on its next heartbeat (≤ 45 s). | `Rejected` |
| **Lost card** | `POST /presence/simulate/lost-card` | Marks the selected card **LOST**, then scans it → **rejected** (*"Card is lost"*). Reissue it under **Manage → Cards**. | `Rejected` |
| **Disabled card** | `POST /presence/simulate/disabled-card` | Disables the selected card, then scans it → **rejected** (*"Card is disabled"*). Re-enable under **Manage → Cards**. | `Rejected` |

> **Note:** "Lost card" and "Disabled card" actually change that card's status in
> the database. After running them, that card stays Lost/Disabled until you
> restore it under Manage → Cards. This is intentional — it's the real
> lifecycle, not a temporary illusion.

---

## 4. What the result badges mean

| Badge | Status | Meaning |
|---|---|---|
| 🟢 **Present** | `VERIFIED` | Valid tap, on time. Day marked present. |
| 🟠 **Late** | `LATE` | Valid entry after start + grace. Day marked late, minutes recorded. |
| 🔵 **Duplicate** | `DUPLICATE` | A re-tap inside the duplicate window. Logged, not counted again. |
| 🔴 **Needs review** | `UNKNOWN` | UID nobody issued. Sent to admins as a security item, not attendance. |
| 🔴 **Rejected** | `REJECTED` | Blocked before counting — offline reader, or lost/disabled/inactive card, etc. |

---

## 5. How the engine actually decides (the real logic)

This is the order of checks inside
[`processScan()`](../server/src/services/presence/engine.ts). Everything below
runs **inside a single database transaction**, so two near-simultaneous taps of
the same card can't both slip past the duplicate check.

1. **Reader check** — reader must exist in the school. For an RFID scan, if the
   reader is **offline → `REJECTED`** ("Reader is offline").
2. **Card check** — the UID must match an issued card, else **`UNKNOWN`**. The
   card must be `ACTIVE`, else **`REJECTED`** ("Card is lost/disabled/…").
3. **Student check** — the card's student must exist, be active, and have a
   class; otherwise **`REJECTED`** with the specific reason.
4. **Duplicate check** — if any `VERIFIED`/`LATE` event exists for this student
   within `duplicateWindowSeconds` (default 120 s) → **`DUPLICATE`**. (A MANUAL
   correction skips this — a staff edit is always intentional.)
5. **Direction** — explicit override (must obey a one-way reader), else a
   fixed-direction reader's own direction, else inferred: no event today →
   `ENTRY`; last event was `EXIT` → `REENTRY`; otherwise `EXIT`.
6. **Late policy** — applies only to the day's opening `ENTRY`. If the tap is
   later than `schoolStartTime + lateGraceMinutes`, it's **`LATE`** and the
   exact minutes-late are recorded.
7. **Write** — creates the `AttendanceEvent`; for `ENTRY`/`REENTRY` it
   upserts the daily `Attendance` row to `PRESENT`/`LATE`. (`EXIT` never
   un-marks a present day.)
8. **After commit** — broadcasts `presence:event` over websockets, writes a
   trust-ledger audit entry, and notifies: **parents** on Present/Late, or
   **admins** on an Unknown card.

Even rejections, duplicates, and unknowns are written as their own event rows —
"audit every action" means nothing is silently dropped.

---

## 6. Where the results show up (it's all one system)

A single scan you fire here appears everywhere the real data lives:

- **Presence → Overview / Activity** — the live event feed and status counts.
- **Dashboards** — attendance figures update.
- **Parent notifications** — in-app, plus SMS/email/push channel sends.
- **Presence → Unknown Cards** — for `UNKNOWN` results, as a security review.
- **Trust ledger** — every scan is auditable.

The "What happened" feed on the Simulator keeps the **last 30** results so you
can see them without leaving the page.

---

## 7. Quick reference — default settings

These live per-school (Presence → Settings) and default to:

| Setting | Default | Effect |
|---|---|---|
| `schoolStartTime` | `08:00` | Baseline for "late". |
| `lateGraceMinutes` | `5` | Grace after start before a tap is Late. |
| `duplicateWindowSeconds` | `120` | Re-taps within this window are Duplicates. |
| `heartbeatOfflineThresholdSeconds` | `90` | Silence longer than this → reader Offline. |

Simulator heartbeat cadence: **45 s** (hard-coded on the page, kept safely under
the 90 s threshold).

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every scan is `Rejected — reader offline` | Virtual hardware toggle is off, or the reader drifted offline. | Turn the toggle **on**, or click **"Bring it online"** on the reader banner. |
| Buttons are greyed out | No gate and/or card selected. | Pick a gate and a card in Step 2 (they should pre-select automatically). |
| "No active cards to simulate with" | The school has no active RFID cards. | Issue a card under **Manage → Cards** first. |
| A card keeps getting rejected as lost/disabled | You ran the "Lost card" / "Disabled card" scenario earlier — it really changed the status. | Restore the card under **Manage → Cards**. |

---

## 9. Code map (for developers)

| Concern | File |
|---|---|
| Simulator UI | [`client/src/pages/presence/Simulator.tsx`](../client/src/pages/presence/Simulator.tsx) |
| Simulator API (force state, timestamp override, scenarios) | [`server/src/routes/presence/simulate.routes.ts`](../server/src/routes/presence/simulate.routes.ts) |
| Real reader / manual ingest boundary | [`server/src/routes/presence/scan.routes.ts`](../server/src/routes/presence/scan.routes.ts) |
| The shared scan engine (the source of truth) | [`server/src/services/presence/engine.ts`](../server/src/services/presence/engine.ts) |
| Settings & defaults | [`server/src/services/presence/settings.ts`](../server/src/services/presence/settings.ts) |
| Badge labels / statuses | [`client/src/pages/presence/shared.tsx`](../client/src/pages/presence/shared.tsx) |

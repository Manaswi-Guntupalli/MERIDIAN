# MERIDIAN — 5-Minute Live Demo Script (for Judges)

> **The thesis you are proving in 5 minutes:**
> *Proactive, not reactive — and every automated decision is explainable, reversible, and auditable.*
> Say the word **"honest"** at least three times. It's the product's spine, and no other team will claim it — because no other team can prove it.

---

## ⚙️ Pre-flight checklist (do this 10 minutes before — NOT optional)

| # | Check | How |
|---|---|---|
| 1 | All 3 services up | `npm run dev` + `npm run intelligence` — dashboard shows **no** "engine offline" badge |
| 2 | Logged in as **principal** | `principal@meridian.school` / `meridian123` |
| 3 | Face service up | `npm run faceservice` (:8020). For a camera-free demo, the **Simulator** exercises every scenario with synthetic embeddings. |
| 4 | Today has live attendance | Presence → Simulator → **Start session** for a class → run **Correct face** a few times so the grid shows greens |
| 5 | A Lumen doc already processed | Lumen should show ≥1 document in REVIEW/VERIFIED — if not, drop a sample form NOW (processing takes ~10–30s; never upload live on stage) |
| 6 | Know your cascade teacher | Pick a teacher of a **shared subject** (Math/English — check Staff page that ≥2 teachers list that subject). |
| 6b | **Two faces enrolled (live kiosk demo)** | Face Recognition → Enrollment: enroll **yourself** and **a teammate**. Live demo = your face marks you present; the proxy case is cleanest via the **Simulator** (`Proxy attempt`). |
| 7 | Dashboard recomputed | Click **Recompute** once so insights match today's data |
| 8 | Second browser tab open | Logged in as `parent@meridian.school` — you'll flash it twice for notifications |
| 9 | Close everything else | One window, 100% zoom, notifications-of-the-OS off |

**Golden rule:** every number you show is computed from the database. If a judge asks "is this real?" — click any *"Why?"* / *"Why this rank?"* disclosure. That's the trap card. Use it.

---

## 🎬 THE SCRIPT

### ⏱ 0:00 – 0:25 — The hook (Dashboard hero)

**SCREEN:** Dashboard (Operations Command Center), fresh load.

**SAY:**
> "This is Meridian — a school operating system built on one rule: **the software never lies**. Every number on this screen is computed from database records, every AI decision explains itself, and everything it does can be undone. This is the principal's morning: not charts to hunt through — a ranked list of **what needs you right now**."

**DO:** Sweep the cursor across the health gauge → the "N things to look at" headline → the Recommended actions panel. Don't click anything yet.

---

### ⏱ 0:25 – 1:05 — The action feed EXECUTES (one-click resolve)

**SCREEN:** Recommended actions panel.

**SAY:**
> "Every recommendation is ranked by a formula — impact × urgency × confidence — and the formula is public."

**DO:** Click **"Why this rank?"** on recommendation #1. Point at the arithmetic.

**SAY:**
> "But a dashboard that only *points* at work is a to-do list. Ours **completes** it. These fee reminders? Watch."

**DO:** Click **"Send reminders"** on the fees recommendation. Toast appears: *"Reminded 47 families (94 notifications)."*

**SAY:**
> "Ninety-four real notifications, just went out, audited in the trust ledger. And watch the recommendation — the dashboard recomputes from the database, so the item clears **because reality changed**, not because we hid it."

**DO:** Flash the parent tab — the fee reminder is sitting in their notifications. Back to principal tab.

---

### ⏱ 1:05 – 2:10 — Anti-proxy attendance ⭐ (the differentiator, LIVE)

**SCREEN:** Presence → Sessions (start attendance for a class), then Face Recognition → **Live Kiosk**. Camera running.

**SAY:**
> "A teacher opens attendance for the class — that mints a session QR that dies in 5 minutes. Now the problem nobody else solves: **buddy-punching**. Your friend scans your QR, you're 'present.' So the QR only *claims* an identity — this **live camera** must confirm it. Face alone is enough; QR alone is never present."

**DO:** Step in front of the kiosk and blink. Your face is recognised → you flip **green → Present** on the live grid, with the proof: *face verified, 93%*.

**SAY (pointing at the toast/log):**
> "That's my actual face being matched right now against my enrolled template — not a recording, and the image never leaves the server's memory. Only the vector is stored."

**DO:** Now the proxy case (cleanest on the **Simulator** tab → **Proxy attempt**): a QR claims Student A, but the camera sees Student B.

**SAY (this is your money moment — slow down):**
> "Someone scans A's QR, but the face is B. The 1:1 check fails — **blocked as PROXY**, no attendance recorded, and it names **who actually showed up**. Every admin just got a CRITICAL alert. And a QR with no face at all? It sits pending and expires to **Unverified QR** — never present. Proxy attendance — a real, unsolved problem — dead."

**SEE:** Red **"Proxy blocked"** with the reason naming the impostor; flash the notification bell (CRITICAL security alert).

---

### ⏱ 2:10 – 3:15 — The Kairos cascade ⭐⭐ (the 30-second thesis)

**SCREEN:** Staff page.

**SAY:**
> "Now the flow that ties everything together. A teacher just called in sick. In most schools that's 30 minutes of phone calls. Here it's one click — and one *undo*."

**DO:** Click **"Absent → cascade"** on your pre-chosen teacher. The timeline modal animates in, step by step.

**SAY (narrate the steps as they appear — they're real executed steps with server timestamps):**
> "Absence recorded… Kairos scans the live timetable… substitutes assigned — and not randomly: qualified for the subject, free that period, under their weekly load cap, with the reasons written down… the room map updates… and every affected parent and substitute is **already notified**."

**DO:** Flash the parent tab — *"Timetable change for 8A"* notification is there. Back.

**SAY:**
> "Here's the part that makes a principal actually trust it: the entire cascade is **one reversible event** in the trust ledger."

**DO:** Click **"Undo everything"**. Toast: substitutions removed, substitutes informed.

**SAY:**
> "State restored atomically — and honestly: the people we notified get a *correction*, we never pretend the first message didn't happen. Explainable. Reversible. Auditable."

---

### ⏱ 3:15 – 4:00 — Lumen: documents with proof (provenance)

**SCREEN:** Lumen, open the pre-processed admission form.

**SAY:**
> "Paper forms become ERP records automatically — but 'the AI read it' isn't good enough for a child's records. So every extracted value keeps a **proof crop** of the exact pixels it was read from."

**DO:** Hover/click a field (pick the guardian name or phone) — the crop highlights on the original scan.

**SAY:**
> "Name, confidence 96, and *there* — the exact region of the scan it came from. Low-confidence fields queue for human review, worst-first. The registrar verifies in two seconds instead of re-typing the whole form. And when we commit this to a real student record — that commit is undoable too, from the same trust ledger."

**DO:** Show the review queue ordering (confidence ascending), then move on. **Do not upload a new document live.**

---

### ⏱ 4:00 – 4:35 — Copilot: a console that executes, not a chatbot

**SCREEN:** Copilot.

**DO:** Type (or use a suggestion chip): **"Which students are at risk?"**

**SAY:**
> "Natural language over live data — the LLM only *phrases*; every fact comes from the database, and it says so. But here's the difference from every chatbot demo you'll see today —"

**DO:** Point at the green **⚡ "Message N families"** button in the answer, click it. Result lands back in the chat: *"✓ Messaged 10 families of at-risk students…"*

**SAY:**
> "It doesn't tell me what to do. It **did it** — and reported exactly what happened, including which families need a phone call because they have no portal account. That's 'minimal clicks' delivered literally."

---

### ⏱ 4:35 – 5:00 — Foresight + close

**SCREEN:** Foresight page.

**SAY (fast, pointing):**
> "Early warning: an at-risk index over attendance, lateness, fee aging — with the **formula printed on the page**, per-student confidence arithmetic, and a one-click outreach. Forecasts ship with prediction intervals and the model name — never a naked number."

**DO:** Expand one student's "Why this score?" row for two seconds.

**CLOSING (look at the judges, not the screen):**
> "Everything you just saw — the proxy block, the cascade, the reminders — is already in the trust ledger with who, why, and a confidence that was *computed*, not invented. Schools don't adopt AI because it's clever. They adopt it when they can **check it and undo it**. That's Meridian: proactive, explainable, reversible. Thank you."

---

## 🧯 If something breaks (honest failure = still a demo)

| Failure | Recovery line |
|---|---|
| Intelligence engine down | Point at the offline panel: *"And this is what honesty looks like when a service dies — it says 'offline' instead of inventing numbers. Most dashboards can't tell you the difference."* Restart with `npm run intelligence`. |
| Readers offline / scans rejected | *"The engine refuses scans from a dead gate — that's a feature."* Toggle Virtual gate hardware ON, click "Bring it online." |
| Cascade shows 0 covered | *"No qualified substitute exists for this subject — so it says so, frees the room, and still notifies families. It never assigns an unqualified teacher just to look good."* |
| Copilot slow (OpenAI) | It degrades to deterministic answers automatically — keep going; the facts and buttons are identical. |

## ⏱ Timing discipline
- Total talk track ≈ 640 words ≈ 4:15 at demo pace — leaves 45s of click-and-breathe buffer.
- If running long at 4:00, **cut Foresight**, keep the closing lines verbatim.
- The two ⭐ segments (anti-proxy attendance, the cascade) are the memory makers — never rush those two.

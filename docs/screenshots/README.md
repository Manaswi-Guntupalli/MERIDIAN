# Screenshots — capture guide

The main [`README.md`](../../README.md) references five images from this folder. Until they exist, that section shows broken-image icons — so either capture them (≈5 minutes) or delete the "Screenshots" section from the README.

## Before you start

```bash
npm run dev            # server + client
npm run intelligence   # so the dashboard shows real insights, not "engine offline"
```

Log in as `principal@meridian.school` / `meridian123`. Use a **maximised browser window**, and hide any bookmarks bar so the shot is clean.

**Capture on Windows:** `Win + Shift + S` → drag over the browser content area → paste into Paint → save as PNG with the exact filename below. (Or `Win + PrtScn` for the full screen, then crop.)

## The five shots

| Filename | Route | What must be on screen |
|---|---|---|
| `dashboard.png` | `/` | The health gauge **and** the ranked "Recommended actions" panel with its one-click resolve buttons visible. This is the money shot — the exception queue, not a chart. |
| `lumen.png` | `/lumen` → open the seeded admission document | The split view: extracted fields on one side, the scan on the other, with a **proof crop highlighted** (hover a field first). Make sure the low-confidence "Blood group" row is visible. |
| `kairos.png` | `/kairos` → Timetable tab | The published grid, colour-coded by subject. Bonus: open a slot's **"Why?"** popover so the explanation is visible in the shot. |
| `presence.png` | `/face-recognition` → Gate mode | Ideally the moment after a **blocked proxy attempt** — the red "Proxy blocked" row in the log with its reason line. Failing that, `/presence` → Simulator with results in the feed. |
| `copilot.png` | `/copilot` | An answered question showing the grounded footer ("facts from live DB", confidence %) **and** a green ⚡ execute button. Ask *"Who has overdue fees above 1000?"* |

## Tips

- Landscape, roughly 16:9. GitHub scales them down — anything above ~1400px wide is plenty.
- Keep the sidebar in frame; it shows the breadth of the product at a glance.
- If a panel says "engine offline", start the Python service and refresh before shooting.
- Optional: an animated GIF of the **cascade** (Staff → *Absent → cascade* → timeline → Undo) is the single most persuasive asset you can add. Save as `cascade.gif` and reference it in the README's demo-moments section.

import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { loadConfig, buildGrid } from '../services/kairos/index.js';

const router = Router();
router.use(authenticate);

// School hours + calendar, for the time-aware "school status" shown across the
// app. Read-only and available to every role — the client computes the live
// phase (in session / after school / weekend / holiday) from this + the clock,
// so the status ticks locally without polling.
router.get(
  '/hours',
  asyncHandler(async (req, res) => {
    const { cfg, exists } = await loadConfig(req.user!.schoolId);
    const grid = buildGrid(cfg);
    const dayEnd = grid.periodTimes.length ? grid.periodTimes[grid.periodTimes.length - 1].end : cfg.dayStart;

    // Break windows sit right after their period (breaks[].after is a period
    // index) — pair each with its computed clock window from the grid.
    const breaks = cfg.breaks
      .filter((b) => b.after < cfg.periodsPerDay)
      .map((b) => ({ name: b.name, minutes: b.minutes, start: grid.periodTimes[b.after]?.end }))
      .filter((b) => !!b.start);

    const today = new Date().toISOString().slice(0, 10);

    res.json({
      configured: exists,
      dayStart: cfg.dayStart,
      dayEnd,
      workingDays: cfg.workingDays, // Mon .. Mon+n-1
      periods: grid.periodTimes.map((p, i) => ({ label: grid.periodLabels[i], start: p.start, end: p.end })),
      breaks,
      holidays: cfg.holidays,
      todayIsHoliday: cfg.holidays.includes(today),
    });
  }),
);

export default router;

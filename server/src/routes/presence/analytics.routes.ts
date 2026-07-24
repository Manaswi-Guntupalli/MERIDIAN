import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/errors.js';
import { STAFF } from '../../utils/constants.js';
import * as analytics from '../../services/presence/analytics.js';

const router = Router();
router.use(authenticate);
router.use(authorize(...STAFF));

const days = (req: { query: Record<string, unknown> }, fallback: number) => Number(req.query.days) || fallback;

router.get('/today', asyncHandler(async (req, res) => res.json(await analytics.todaySummary(req.user!.schoolId))));
router.get('/occupancy', asyncHandler(async (req, res) => res.json(await analytics.campusOccupancy(req.user!.schoolId))));
router.get('/trend/daily', asyncHandler(async (req, res) => res.json({ series: await analytics.attendanceTrend(req.user!.schoolId, days(req, 14)) })));
router.get('/trend/weekly', asyncHandler(async (req, res) => res.json({ series: await analytics.attendanceTrend(req.user!.schoolId, 7 * days(req, 8)) })));
router.get('/trend/monthly', asyncHandler(async (req, res) => res.json({ series: await analytics.attendanceTrend(req.user!.schoolId, 30 * days(req, 3)) })));
router.get('/late-students', asyncHandler(async (req, res) => res.json({ students: await analytics.lateStudents(req.user!.schoolId, days(req, 14)) })));
router.get('/frequent-absences', asyncHandler(async (req, res) => res.json({ students: await analytics.frequentAbsences(req.user!.schoolId, days(req, 30)) })));
router.get('/peak-entry-time', asyncHandler(async (req, res) => res.json(await analytics.peakEntryTime(req.user!.schoolId, days(req, 14)))));
router.get('/method-breakdown', asyncHandler(async (req, res) => res.json(await analytics.methodBreakdown(req.user!.schoolId, days(req, 14)))));

export default router;

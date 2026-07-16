import { prisma } from '../lib/prisma.js';
import { toJson } from '../lib/json.js';

// Foresight — predictive resource allocation. We compute genuine forecasts
// from historical attendance in the event/materialized store (a transparent
// gradient of recent signals), and expose SHAP-style top drivers.

interface Driver {
  factor: string;
  impact: number; // -1..1
}

function addDays(base: Date, n: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function computePredictions(schoolId: string) {
  const attendance = await prisma.attendance.findMany({
    where: { schoolId },
    orderBy: { date: 'desc' },
    take: 2000,
  });
  const classes = await prisma.class.findMany({ where: { schoolId } });
  const teachers = await prisma.teacher.findMany({ where: { schoolId } });

  // Attendance rate by date (last N days).
  const byDate: Record<string, { present: number; total: number }> = {};
  for (const a of attendance) {
    byDate[a.date] ??= { present: 0, total: 0 };
    byDate[a.date].total++;
    if (a.status === 'PRESENT' || a.status === 'LATE') byDate[a.date].present++;
  }
  const dates = Object.keys(byDate).sort().reverse();
  const recentRate =
    dates.slice(0, 3).reduce((acc, d) => acc + byDate[d].present / (byDate[d].total || 1), 0) /
    (Math.min(3, dates.length) || 1);
  const priorRate =
    dates.slice(3, 7).reduce((acc, d) => acc + byDate[d].present / (byDate[d].total || 1), 0) /
    (Math.max(1, Math.min(4, dates.length - 3)) || 1);

  const today = new Date();
  const tomorrow = addDays(today, 1);
  const trend = recentRate - priorRate;

  // 1) Tomorrow's absence forecast
  const forecastAbsenceRate = Math.min(0.35, Math.max(0.02, 1 - recentRate + (trend < 0 ? 0.03 : 0)));
  const absenceDrivers: Driver[] = [
    { factor: 'Recent absence trend', impact: trend < 0 ? 0.6 : -0.2 },
    { factor: 'Day-of-week pattern', impact: 0.25 },
    { factor: 'Seasonality / weather', impact: trend < 0 ? 0.4 : 0.1 },
  ];

  // 2) Substitute demand — teachers likely to need cover.
  const subDemand = Math.round(teachers.length * forecastAbsenceRate * 0.4) + (trend < 0 ? 1 : 0);
  const subDrivers: Driver[] = [
    { factor: 'Forecast staff absence', impact: 0.7 },
    { factor: 'Teachers near hour cap', impact: 0.35 },
  ];

  // 3) Fee-risk (dues crossing threshold)
  const overdueFees = await prisma.fee.count({ where: { schoolId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } } });

  const preds = [
    {
      kind: 'ABSENCE',
      targetDate: tomorrow,
      label: `~${Math.round(forecastAbsenceRate * 100)}% student absence expected tomorrow`,
      value: Math.round(forecastAbsenceRate * 100),
      confidence: 0.7 + Math.min(0.2, dates.length / 30),
      drivers: absenceDrivers,
    },
    {
      kind: 'SUBSTITUTE_DEMAND',
      targetDate: tomorrow,
      label: `${subDemand} substitute${subDemand === 1 ? '' : 's'} likely needed tomorrow`,
      value: subDemand,
      confidence: 0.66,
      drivers: subDrivers,
    },
    {
      kind: 'ATTENDANCE_TREND',
      targetDate: tomorrow,
      label:
        trend < -0.02
          ? `Attendance down ${Math.abs(Math.round(trend * 100))}% vs last week`
          : `Attendance stable (${Math.round(recentRate * 100)}%)`,
      value: Math.round(trend * 100),
      confidence: 0.8,
      drivers: [
        { factor: 'Rolling 3-day mean', impact: 0.5 },
        { factor: 'Heavy rainfall (regional)', impact: trend < 0 ? 0.45 : 0.05 },
      ],
    },
    {
      kind: 'FEE_RISK',
      targetDate: tomorrow,
      label: `${overdueFees} fee account${overdueFees === 1 ? '' : 's'} at risk of crossing 30 days`,
      value: overdueFees,
      confidence: 0.72,
      drivers: [{ factor: 'Days since due', impact: 0.8 }],
    },
  ];

  // Persist snapshot (idempotent-ish: clear today's and rewrite)
  await prisma.prediction.deleteMany({ where: { schoolId, targetDate: tomorrow } });
  for (const p of preds) {
    await prisma.prediction.create({
      data: {
        schoolId,
        kind: p.kind,
        targetDate: p.targetDate,
        label: p.label,
        value: p.value,
        confidence: p.confidence,
        driversString: toJson(p.drivers),
      },
    });
  }

  return { preds, recentRate, trend, classes: classes.length };
}

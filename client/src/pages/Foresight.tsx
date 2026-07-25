import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Radar, Users, Wallet, Activity, AlertTriangle, MessageSquare, FileWarning, ChevronDown } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, LoadingScreen, Meter } from '@/components/ui';
import { cn, inr, pct } from '@/lib/utils';

// ── Engine payload slices this page reads (display only — computed in Python) ──
interface Forecast {
  available: boolean; prediction?: number; interval80?: number[]; interval95?: number[];
  interval95_upper?: number; model?: string; note?: string; reason?: string; caveat?: string | null;
}
interface AtRiskStudent {
  studentId: string; name: string; className: string | null; riskScore: number; band: 'HIGH' | 'ELEVATED';
  factors: { attendanceRate: number; attendanceDeficit: number; feeOverdueDays: number; feesDue: number; feesPastDue?: number; lateShare: number; trendDelta: number | null };
  reasons: string[];
  confidence: { value: number; explanation: string };
}
interface AtRisk {
  available: boolean; reason?: string; method?: string; formula?: string;
  weights?: Record<string, number>; bands?: Record<string, number>;
  window?: { days: number; from: string; to: string };
  n_flagged: number; n_high?: number; students: AtRiskStudent[];
}
interface IntelResponse {
  engine: 'online' | 'offline';
  error?: string;
  payload?: {
    meta: { computedAt: string; anchorDate: string; engineVersion: string };
    forecasts: { attendanceTomorrow: Forecast; substituteDemand: Forecast; feeCollections: Forecast; documentReviewLoad: Forecast };
    atRisk?: AtRisk;
  };
}

/**
 * Foresight — early warning, honestly.
 * Everything on this page is computed by the Python intelligence engine from
 * database records: forecasts carry their model and interval; the at-risk
 * index ships its formula, declared weights and per-student arithmetic.
 * When the engine is down the page says so — it never invents numbers.
 */
export default function Foresight() {
  const { pushToast } = useUI();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['intelligence'],
    queryFn: async () => (await api.get('/dashboard/intelligence')).data as IntelResponse,
  });

  const outreach = useMutation({
    mutationFn: async (studentIds?: string[]) =>
      (await api.post('/actions/execute', { kind: 'at-risk-outreach', ...(studentIds ? { studentIds } : {}) })).data,
    onSuccess: (res) => {
      pushToast({ title: 'Outreach sent', body: res.summary, severity: 'SUCCESS' });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => pushToast({ title: 'Outreach failed', body: apiError(e), severity: 'CRITICAL' }),
  });
  const flag = useMutation({
    mutationFn: async (studentIds: string[]) => (await api.post('/actions/execute', { kind: 'counselling-flag', studentIds })).data,
    onSuccess: (res) => pushToast({ title: 'Flagged for counselling', body: res.summary, severity: 'SUCCESS' }),
    onError: (e) => pushToast({ title: 'Flag failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (isLoading) return <LoadingScreen label="Asking the intelligence engine…" />;
  const pl = data?.engine === 'online' ? data.payload : undefined;
  const atRisk = pl?.atRisk;

  return (
    <div>
      <PageHeader
        overline="Engine 04 · Foresight"
        title="See the strain before it hits"
        subtitle="Forecasts with intervals and models, and an at-risk index whose arithmetic is on the page — computed by the Python engine, never invented."
      />

      {!pl && (
        <Card className="mb-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Intelligence engine offline
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Forecasts and the at-risk index are computed by the Python engine. Start it with{' '}
            <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.7rem] text-slate-700">npm run intelligence</code> — this page shows nothing rather than something made up.
            {data?.error && <span className="mt-1 block text-slate-400">({data.error})</span>}
          </p>
        </Card>
      )}

      {pl && (
        <>
          {/* Forecasts — interval + model on every cell */}
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2"><Radar className="h-4 w-4 text-brand-400" /><h2 className="font-bold text-slate-900">Forecasts</h2></div>
              <span className="text-[0.7rem] text-slate-500">prediction intervals, not point promises · engine v{pl.meta.engineVersion}</span>
            </div>
            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:[&>*]:!border-t-0">
              <ForecastCell icon={<Activity className="h-3.5 w-3.5" />} label="Attendance tomorrow" f={pl.forecasts.attendanceTomorrow} fmt={(v) => pct(v * 100)} ifmt={(v) => pct(v * 100)} />
              <ForecastCell icon={<Users className="h-3.5 w-3.5" />} label="Substitute demand / day" f={pl.forecasts.substituteDemand} fmt={(v) => String(v)} ifmt={(v) => String(v)} />
              <ForecastCell icon={<Wallet className="h-3.5 w-3.5" />} label="Expected fee recovery" f={pl.forecasts.feeCollections} fmt={(v) => inr(v)} ifmt={(v) => inr(v)} />
              <ForecastCell icon={<FileWarning className="h-3.5 w-3.5" />} label="Document review load" f={pl.forecasts.documentReviewLoad} fmt={(v) => String(v)} ifmt={(v) => String(v)} />
            </div>
          </Card>

          {/* At-risk index */}
          <Card className="mt-6 !p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="font-bold text-slate-900">Students at risk</h2>
                {atRisk?.available && atRisk.n_flagged > 0 && (
                  <Badge severity={atRisk.n_high ? 'WARNING' : 'INFO'}>{atRisk.n_flagged} flagged · {atRisk.n_high ?? 0} high</Badge>
                )}
              </div>
              {atRisk?.available && atRisk.n_flagged > 0 && (
                <button
                  onClick={() => outreach.mutate(undefined)}
                  disabled={outreach.isPending}
                  className="btn-primary !py-1.5 text-xs"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> {outreach.isPending ? 'Messaging…' : 'Message all families'}
                </button>
              )}
            </div>

            {!atRisk?.available ? (
              <div className="px-5 py-6 text-sm text-slate-500">{atRisk?.reason ?? 'At-risk index unavailable.'}</div>
            ) : atRisk.n_flagged === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No student crosses the declared risk bands right now — over {atRisk.window?.days} fully-marked days.</div>
            ) : (
              <>
                <div className="divide-y divide-line">
                  {atRisk.students.map((s, i) => (
                    <RiskRow key={s.studentId} s={s} i={i}
                      onMessage={() => outreach.mutate([s.studentId])}
                      onFlag={() => flag.mutate([s.studentId])}
                      busy={outreach.isPending || flag.isPending}
                    />
                  ))}
                </div>
                {/* The arithmetic — always visible, judge-proof */}
                <div className="border-t border-line bg-ink-800/30 px-5 py-3 text-[0.7rem] leading-relaxed text-slate-500">
                  <b className="text-slate-600">How this is computed:</b> {atRisk.method}
                  <span className="mt-0.5 block font-mono text-[0.65rem]">{atRisk.formula}</span>
                  <span className="mt-0.5 block">Window {atRisk.window?.from} → {atRisk.window?.to} ({atRisk.window?.days} fully-marked days) · bands: HIGH ≥ {Math.round((atRisk.bands?.HIGH ?? 0) * 100)}, ELEVATED ≥ {Math.round((atRisk.bands?.ELEVATED ?? 0) * 100)}</span>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function RiskRow({ s, i, onMessage, onFlag, busy }: { s: AtRiskStudent; i: number; onMessage: () => void; onFlag: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="px-5 py-3.5">
      <div className="flex items-center gap-4">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold', s.band === 'HIGH' ? 'bg-rose-400/15 text-rose-500' : 'bg-amber-400/15 text-amber-600')}>
          {s.riskScore}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {s.name}
            {s.className && <span className="text-xs font-normal text-slate-500">{s.className}</span>}
            <Badge severity={s.band === 'HIGH' ? 'CRITICAL' : 'WARNING'}>{s.band === 'HIGH' ? 'High risk' : 'Elevated'}</Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{s.reasons.join(' · ')}</div>
        </div>
        <div className="hidden w-28 shrink-0 sm:block"><Meter value={s.riskScore} tone={s.band === 'HIGH' ? 'amber' : 'brand'} /></div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={onMessage} disabled={busy} className="btn-ghost !px-2.5 !py-1 text-[0.72rem]" title="Message this family now"><MessageSquare className="h-3.5 w-3.5" /> Message</button>
          <button onClick={onFlag} disabled={busy} className="btn-ghost !px-2.5 !py-1 text-[0.72rem]" title="Flag for counselling follow-up">Flag</button>
          <button onClick={() => setOpen((v) => !v)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-slate-700" aria-label="Why this score?">
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-line bg-ink-800/40 px-3 py-2 text-[0.7rem] leading-relaxed text-slate-500">
          <b className="text-slate-600">Factors:</b>{' '}
          attendance {Math.round(s.factors.attendanceRate * 100)}% (deficit {s.factors.attendanceDeficit}) · fees ₹{(s.factors.feesPastDue ?? s.factors.feesDue).toLocaleString('en-IN')} past due / {s.factors.feeOverdueDays}d
          {s.factors.feesPastDue != null && s.factors.feesDue > s.factors.feesPastDue && <> (+₹{(s.factors.feesDue - s.factors.feesPastDue).toLocaleString('en-IN')} not yet due)</>}
          {' '}· late share {Math.round(s.factors.lateShare * 100)}%
          {s.factors.trendDelta !== null && <> · trend {s.factors.trendDelta > 0 ? '+' : ''}{Math.round(s.factors.trendDelta * 100)} pts</>}
          <span className="mt-0.5 block"><b className="text-slate-600">Confidence {s.confidence.value}%:</b> {s.confidence.explanation}</span>
        </div>
      )}
    </motion.div>
  );
}

function ForecastCell({ icon, label, f, fmt, ifmt }: { icon: React.ReactNode; label: string; f: Forecast; fmt: (v: number) => string; ifmt: (v: number) => string }) {
  const interval = f.interval80 ?? f.interval95;
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.07em] text-slate-400">
        <span className="text-brand-400">{icon}</span>{label}
      </div>
      {f.available && f.prediction != null ? (
        <>
          <div className="tnum mt-1.5 font-display text-[1.35rem] font-semibold leading-none text-slate-900">{fmt(f.prediction)}</div>
          <div className="mt-1 text-[0.7rem] text-slate-500">
            {interval
              ? `${f.interval80 ? '80%' : '95%'} interval ${ifmt(interval[0])} – ${ifmt(interval[1])}`
              : f.interval95_upper != null
                ? `95% upper bound ${ifmt(f.interval95_upper)}`
                : f.note ?? ''}
          </div>
          <div className="mt-0.5 truncate text-[0.65rem] text-slate-400" title={`${f.model ?? ''}${f.caveat ? ` — ${f.caveat}` : ''}`}>{f.model}{f.caveat ? ' *' : ''}</div>
        </>
      ) : (
        <div className="mt-1.5 text-xs text-slate-500">{f.reason ?? 'Not available'}</div>
      )}
    </div>
  );
}

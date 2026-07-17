import { motion } from 'framer-motion';
import { Check, Minus, ShieldCheck, Server, Database, Cpu } from 'lucide-react';
import { useAuth } from '@/store/auth';
import PageHeader from '@/components/PageHeader';
import { Card, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

const ROLES = ['Super Admin', 'Admin', 'Principal', 'Teacher', 'Student', 'Parent'];

// The enforced access matrix — mirrors the API guards + route guards exactly.
const CAPS: { area: string; allow: boolean[] }[] = [
  { area: 'System settings & roles', allow: [true, false, false, false, false, false] },
  { area: 'Command Center & insights', allow: [true, true, true, false, false, false] },
  { area: 'Reports & AI Copilot', allow: [true, true, true, false, false, false] },
  { area: 'Fees & payments', allow: [true, true, true, false, false, false] },
  { area: 'Foresight (predictions)', allow: [true, true, true, false, false, false] },
  { area: 'Lumen (documents)', allow: [true, true, true, false, false, false] },
  { area: 'Time Machine & audit', allow: [true, true, true, false, false, false] },
  { area: 'Staff management', allow: [true, true, true, false, false, false] },
  { area: 'Students & classes', allow: [true, true, true, true, false, false] },
  { area: 'Attendance & Presence', allow: [true, true, true, true, false, false] },
  { area: 'Timetable (view)', allow: [true, true, true, true, false, false] },
  { area: 'Timetable (solve)', allow: [true, true, true, false, false, false] },
  { area: 'Digital Twin', allow: [true, true, true, true, false, false] },
  { area: 'Trigger emergency', allow: [true, true, true, true, false, false] },
  { area: 'Own dashboard & timetable', allow: [false, false, false, true, true, true] },
];

export default function Settings() {
  const user = useAuth((s) => s.user)!;
  return (
    <div>
      <PageHeader overline="System · Super Admin" title="System Settings" subtitle="Platform-level configuration and the enforced role-based access model. Only Super Admins can see this page." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-brand-400"><Server className="h-4 w-4" /></span><div><div className="text-sm font-semibold text-slate-900">{user.school?.name ?? 'Meridian'}</div><div className="text-xs text-slate-500">Code: {user.school?.code}</div></div></Card>
        <Card className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-cyan-400"><Database className="h-4 w-4" /></span><div><div className="text-sm font-semibold text-slate-900">Event-sourced core</div><div className="text-xs text-slate-500">Append-only · Time Machine</div></div></Card>
        <Card className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-mint-400"><Cpu className="h-4 w-4" /></span><div><div className="text-sm font-semibold text-slate-900">AI engines</div><div className="text-xs text-slate-500">Lumen · Kairos · Foresight · Copilot · Presence</div></div></Card>
      </div>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-brand-400" />
          <h2 className="font-bold text-slate-900">Role-based access control</h2>
          <Badge className="ml-auto">enforced at API + UI</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-3 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((row, i) => (
                <motion.tr key={row.area} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="border-b border-line">
                  <td className="px-5 py-2.5 text-slate-600">{row.area}</td>
                  {row.allow.map((ok, j) => (
                    <td key={j} className="px-2 py-2.5 text-center">
                      {ok ? (
                        <span className="inline-grid h-6 w-6 place-items-center rounded-md bg-mint-400/10 text-mint-400"><Check className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span className="inline-grid h-6 w-6 place-items-center rounded-md bg-ink-800/60 text-slate-400"><Minus className="h-3.5 w-3.5" /></span>
                      )}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

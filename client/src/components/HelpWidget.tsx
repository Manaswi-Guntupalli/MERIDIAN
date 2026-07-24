import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, X, Command, ArrowRight, Nfc } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import type { Role } from '@/types';

interface GuideItem {
  to: string;
  label: string;
  desc: string;
}

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
};

const ADMIN_GUIDE: GuideItem[] = [
  { to: '/', label: 'Dashboard', desc: 'School health, attendance and finances at a glance.' },
  { to: '/presence', label: 'Presence', desc: 'Face-recognition attendance with a session QR fallback and simulator.' },
  { to: '/students', label: 'Students', desc: 'Profiles, classes and each student’s full record.' },
  { to: '/kairos', label: 'Kairos', desc: 'Build and solve the school timetable.' },
  { to: '/fees', label: 'Fees', desc: 'Collections, dues and payment records.' },
  { to: '/copilot', label: 'Copilot', desc: 'Ask questions about your school in plain English.' },
  { to: '/users', label: 'Users & Access', desc: 'Accounts, roles and permissions.' },
  { to: '/trust', label: 'Time Machine', desc: 'Every change, audited and reversible.' },
];

const GUIDES: Record<Role, GuideItem[]> = {
  SUPER_ADMIN: [...ADMIN_GUIDE, { to: '/settings', label: 'System Settings', desc: 'School-wide configuration.' }],
  ADMIN: ADMIN_GUIDE,
  PRINCIPAL: ADMIN_GUIDE,
  TEACHER: [
    { to: '/', label: 'Dashboard', desc: 'Your day: classes, periods and alerts.' },
    { to: '/attendance', label: 'Attendance', desc: 'Mark your class register — present, absent, late.' },
    { to: '/presence', label: 'Presence', desc: 'Live gate activity and any student’s entry/exit history.' },
    { to: '/kairos', label: 'Kairos', desc: 'Your timetable.' },
    { to: '/students', label: 'Students', desc: 'Profiles and records for your classes.' },
    { to: '/emergency', label: 'Emergency', desc: 'Raise or respond to a school-wide alert.' },
  ],
  STUDENT: [
    { to: '/', label: 'Dashboard', desc: 'Your attendance, timetable and fee status.' },
    { to: '/notifications', label: 'Notifications', desc: 'Messages from your school.' },
  ],
  PARENT: [
    { to: '/', label: 'Dashboard', desc: 'Your child’s attendance, fees and progress at a glance.' },
    { to: '/notifications', label: 'Notifications', desc: 'Entry/exit alerts and school messages arrive here.' },
  ],
};

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['Ctrl/⌘', 'K'], desc: 'Command palette — type a page (e.g. “Kairos”) and press Enter to jump there. Staff can run commands like “Mark 8A present”.' },
  { keys: ['Ctrl/⌘', 'B'], desc: 'Collapse or expand the sidebar.' },
  { keys: ['?'], desc: 'Open or close this help panel.' },
  { keys: ['Esc'], desc: 'Close any dialog or menu.' },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false);
  const user = useAuth((s) => s.user);
  const setPalette = useUI((s) => s.setPalette);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!user) return null;
  const guide = GUIDES[user.role] ?? [];

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[70] grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-slate-500 shadow-lg transition hover:text-brand-600 hover:shadow-xl"
        title="Help & shortcuts (?)"
        aria-label="Help & shortcuts"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Help and shortcuts"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="surface fixed bottom-[4.75rem] right-5 z-[80] flex w-[24rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden !rounded-2xl !p-0"
            style={{ maxHeight: 'calc(100vh - 7.5rem)' }}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <CircleHelp className="h-4 w-4 text-brand-500" />
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-900">Help &amp; shortcuts</div>
                <div className="text-[0.7rem] text-slate-500">Signed in as {ROLE_LABEL[user.role] ?? user.role}</div>
              </div>
              <button onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-ink-800 hover:text-slate-700" aria-label="Close help">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
              <button
                onClick={() => { setOpen(false); setPalette(true); }}
                className="mb-4 flex w-full items-center gap-2.5 rounded-xl border border-brand-400/40 bg-brand-50/50 px-3 py-2.5 text-left text-xs text-brand-700 transition hover:bg-brand-50"
              >
                <Command className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 font-semibold">Open the command palette</span>
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-500">Ctrl/⌘ K</kbd>
              </button>

              <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Keyboard shortcuts</div>
              <div className="mb-4 space-y-1.5">
                {SHORTCUTS.map((s) => (
                  <div key={s.desc} className="flex items-start gap-2.5 text-xs">
                    <span className="flex shrink-0 gap-1 pt-px">
                      {s.keys.map((k) => (
                        <kbd key={k} className="rounded border border-line bg-ink-800/60 px-1.5 py-0.5 text-[0.65rem] font-semibold text-slate-600">{k}</kbd>
                      ))}
                    </span>
                    <span className="leading-snug text-slate-500">{s.desc}</span>
                  </div>
                ))}
              </div>

              <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">Where to find things</div>
              <div className="mb-1 space-y-0.5">
                {guide.map((g) => (
                  <button key={g.to} onClick={() => go(g.to)} className="group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-ink-800/60">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-800">{g.label}</span>
                      <span className="block text-[0.7rem] leading-snug text-slate-500">{g.desc}</span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-brand-500" />
                  </button>
                ))}
              </div>

              {location.pathname.startsWith('/presence') && (
                <div className="mt-3 rounded-xl border border-line bg-ink-800/40 px-3.5 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Nfc className="h-3.5 w-3.5 text-brand-500" /> About Presence</div>
                  <p className="text-[0.7rem] leading-relaxed text-slate-500">
                    A face or QR mark flows through one engine: open a session → recognise the face (or verify the QR) → anti-proxy check → write attendance once →
                    update dashboards, analytics and parent notifications everywhere. QR-only marks that never show a face become <b className="text-slate-700">Unverified QR</b> at session
                    expiry — face is the primary method, QR is the fallback. Use the Simulator to exercise every scenario without a camera.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

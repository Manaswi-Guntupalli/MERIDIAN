import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Mic, CornerDownLeft, Sparkles } from 'lucide-react';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { navFor } from '@/constants/nav';
import { api, apiError } from '@/lib/api';
import { useVoice } from '@/hooks/useVoice';
import { cn } from '@/lib/utils';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void | Promise<void>;
}

export default function CommandPalette() {
  const { paletteOpen, setPalette, pushToast } = useUI();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const isStaff = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'].includes(user.role);
  const isAdmin = user && ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'].includes(user.role);

  // Resolve "mark 8A present/absent" style commands against real classes.
  const runBulkAttendance = async (text: string) => {
    const m = text.match(/mark\s+(\d{1,2}\s?[a-z]?)\s+(present|absent|late)/i);
    if (!m) return false;
    const className = m[1].replace(/\s+/g, '').toUpperCase();
    const status = m[2].toUpperCase();
    try {
      const { data: cData } = await api.get('/classes');
      const cls = cData.classes.find((c: any) => c.name.toUpperCase() === className);
      if (!cls) {
        pushToast({ title: 'Class not found', body: `No class "${className}"`, severity: 'WARNING' });
        return true;
      }
      const { data } = await api.post('/attendance/bulk', { classId: cls.id, status });
      pushToast({ title: 'Done ✓', body: `${data.className}: ${data.marked} students marked ${status}`, severity: 'SUCCESS' });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      setPalette(false);
    } catch (e) {
      pushToast({ title: 'Failed', body: apiError(e), severity: 'CRITICAL' });
    }
    return true;
  };

  const navCommands: Command[] = useMemo(
    () =>
      user
        ? navFor(user.role).map((n) => ({
            id: 'nav-' + n.to,
            label: n.label,
            hint: n.group,
            icon: <n.icon className="h-4 w-4" />,
            run: () => {
              navigate(n.to);
              setPalette(false);
            },
          }))
        : [],
    [user, navigate, setPalette],
  );

  const actionCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [];
    if (isStaff) {
      cmds.push(
        { id: 'act-mark', label: 'Mark 9A present', hint: 'Attendance', icon: <Sparkles className="h-4 w-4" />, run: async () => { await runBulkAttendance('mark 9A present'); } },
        { id: 'act-solve', label: 'Open Kairos timetable', hint: 'Kairos', icon: <Sparkles className="h-4 w-4" />, run: () => { navigate('/kairos'); setPalette(false); } },
      );
    }
    if (isAdmin) {
      cmds.push(
        { id: 'act-copilot', label: 'Ask Copilot: Which teachers are overloaded?', hint: 'Copilot', icon: <Sparkles className="h-4 w-4" />, run: () => { navigate('/copilot?q=Which teachers are overloaded?'); setPalette(false); } },
        { id: 'act-report', label: 'Generate operations report', hint: 'Reports', icon: <Sparkles className="h-4 w-4" />, run: () => { navigate('/reports'); setPalette(false); } },
      );
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, isAdmin]);

  const all = [...actionCommands, ...navCommands];
  const filtered = q.trim()
    ? all.filter((c) => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(q.toLowerCase()))
    : all;

  // Free text falls through to Copilot (admins) or a hint (others).
  const fallbackTo = (text: string) => {
    if (isAdmin) navigate('/copilot?q=' + encodeURIComponent(text));
    else pushToast({ title: 'No matching command', body: 'Try a page name, or "Mark 8A present".', severity: 'INFO' });
    setPalette(false);
  };

  const submitFreeText = async () => {
    if (!q.trim()) return;
    // Try structured attendance command first (staff only).
    if (isStaff) {
      const handled = await runBulkAttendance(q);
      if (handled) return;
    }
    if (filtered[active]) filtered[active].run();
    else fallbackTo(q);
  };

  const voice = useVoice((text) => {
    setQ(text);
    if (isStaff) {
      runBulkAttendance(text).then((handled) => {
        if (!handled) fallbackTo(text);
      });
    } else {
      fallbackTo(text);
    }
  });

  // ⌘K to open, Esc to close, arrows to move.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!paletteOpen);
      }
      // ⌘/Ctrl+B toggles the sidebar — the familiar editor/ChatGPT shortcut.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUI.getState().toggleRail();
      }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPalette]);

  useEffect(() => {
    if (paletteOpen) {
      setQ('');
      setActive(0);
    }
  }, [paletteOpen]);

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/20 px-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setPalette(false)}
        >
          <motion.div
            className="surface w-full max-w-xl overflow-hidden !rounded-2xl p-0"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, filtered.length - 1));
                  if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
                  if (e.key === 'Enter') submitFreeText();
                }}
                placeholder="Type a command, ask Copilot, or say 'Mark 8A absent'…"
                className="flex-1 bg-transparent py-4 text-sm text-slate-900 outline-none placeholder:text-slate-500"
              />
              {voice.supported && (
                <button
                  onClick={voice.listening ? voice.stop : voice.start}
                  className={cn('rounded-lg border p-1.5 transition', voice.listening ? 'animate-pulseGlow border-rose-400/40 bg-rose-500/20 text-rose-400' : 'border-line text-slate-500 hover:text-slate-900')}
                  title="Voice command"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="no-scrollbar max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <button onClick={submitFreeText} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-600 hover:bg-ink-800">
                  <Sparkles className="h-4 w-4 text-brand-400" />
                  Ask Meridian Copilot: “{q}”
                </button>
              )}
              {filtered.map((c, i) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => c.run()}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition', i === active ? 'bg-ink-800 text-slate-900' : 'text-slate-600 hover:bg-ink-800/60')}
                >
                  <span className="text-slate-500">{c.icon}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="text-[0.65rem] uppercase tracking-wider text-slate-400">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-slate-500" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, Mic, Sparkles, User as UserIcon, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useVoice } from '@/hooks/useVoice';
import PageHeader from '@/components/PageHeader';
import { Card, Spinner, Badge } from '@/components/ui';
import { cn, confColor } from '@/lib/utils';
import type { CopilotResult } from '@/types';

interface Msg { role: 'user' | 'assistant'; text: string; meta?: CopilotResult }

export default function Copilot() {
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = useQuery({ queryKey: ['copilot', 'suggestions'], queryFn: async () => (await api.get('/copilot/suggestions')).data.suggestions as string[] });

  const ask = useMutation({
    mutationFn: async (question: string) => (await api.post('/copilot/ask', { question })).data as CopilotResult,
    onSuccess: (res) => setMessages((m) => [...m, { role: 'assistant', text: res.answer, meta: res }]),
  });

  const send = (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    ask.mutate(q);
  };

  const voice = useVoice((t) => send(t));

  // Auto-run a query passed via ?q=
  useEffect(() => {
    const q = params.get('q');
    if (q) send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, ask.isPending]);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader overline="Meridian Copilot" title="Ask anything, grounded in live data" subtitle="Answers come from the event store — never hallucinated. Actions only run on confirm, and land in the Trust Ledger." />

      {/* Pastel wash scoped to the chat window only — same family as the
          login page's gradient, spread so every corner carries colour. */}
      <Card
        className="flex flex-1 flex-col overflow-hidden !p-0"
        style={{
          background: [
            'radial-gradient(80% 60% at 8% 0%, rgba(147,197,253,0.42), transparent 60%)',
            'radial-gradient(75% 65% at 100% 12%, rgba(196,181,253,0.38), transparent 62%)',
            'radial-gradient(90% 70% at 92% 100%, rgba(249,168,212,0.42), transparent 64%)',
            'radial-gradient(70% 55% at 0% 88%, rgba(153,246,228,0.34), transparent 60%)',
            'linear-gradient(115deg, #f5f8ff 0%, #fdf2f8 55%, #f3f6ff 100%)',
          ].join(', '),
        }}
      >
        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white"><Bot className="h-8 w-8" /></div>
              <div>
                <div className="text-lg font-bold text-slate-900">Your operational assistant</div>
                <div className="text-sm text-slate-500">Try one of these:</div>
              </div>
              <div className="flex max-w-lg flex-wrap justify-center gap-2">
                {suggestions.data?.map((s) => (
                  <button key={s} onClick={() => send(s)} className="chip surface-hover !border-white/70 !bg-white/70 backdrop-blur-sm hover:!text-slate-900"><Sparkles className="h-3 w-3 text-brand-400" /> {s}</button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', m.role === 'user' ? 'bg-ink-700 text-slate-600' : 'bg-brand-600 text-white')}>
                  {m.role === 'user' ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>
                <div className={cn('max-w-[80%] rounded-2xl px-4 py-3 text-sm backdrop-blur-sm', m.role === 'user' ? 'border border-brand-500/20 bg-brand-500/15 text-slate-900' : 'border border-white/70 bg-white/75 text-slate-700 shadow-sm')}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  {m.meta && (
                    <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2 text-[0.7rem]">
                      <ShieldCheck className="h-3.5 w-3.5 text-mint-400" />
                      <span className="text-slate-500">Grounded · {m.meta.source === 'openai' ? 'OpenAI' : 'live rules'}</span>
                      <span className={cn('ml-auto font-semibold', confColor(m.meta.confidence))}>{Math.round(m.meta.confidence * 100)}% conf.</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {ask.isPending && (
            <div className="flex gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><Bot className="h-4 w-4" /></div>
              <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 text-sm text-slate-500 shadow-sm backdrop-blur-sm"><Spinner /> Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-white/70 bg-white/55 p-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {voice.supported && (
              <button onClick={voice.listening ? voice.stop : voice.start} className={cn('btn-ghost !px-3', voice.listening && 'animate-pulseGlow !border-rose-400/40 !text-rose-400')}>
                <Mic className="h-4 w-4" />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder="Ask about attendance, fees, staff load, substitutes…"
              className="input flex-1"
            />
            <button onClick={() => send(input)} disabled={!input.trim() || ask.isPending} className="btn-primary !px-4"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      </Card>
    </div>
  );
}

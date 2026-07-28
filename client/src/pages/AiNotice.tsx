import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Megaphone, Sparkles, Send, RotateCcw, Trash2, ShieldCheck, Users } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Card, Badge, Spinner, EmptyState, LoadingScreen } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// AI Notice — AI-assisted professional school communication.
//
// The staff member supplies the facts and approves the wording. The model only
// rewrites; it never sends, and nothing leaves this page without an explicit
// "Review & Send". Audiences come from the server, so the options offered are
// exactly the ones this account is permitted to use.
// ─────────────────────────────────────────────────────────────────────────────

type Scope = 'SCHOOL' | 'GRADE' | 'CLASS';
type Recipients = 'STUDENTS' | 'PARENTS' | 'BOTH' | 'TEACHERS';

interface AudienceOption {
  scope: Scope;
  label: string;
  options: { id: string; label: string }[];
  recipients: Recipients[];
}

const RECIPIENT_LABEL: Record<Recipients, string> = {
  STUDENTS: 'Students',
  PARENTS: 'Parents',
  BOTH: 'Students + Parents',
  TEACHERS: 'Teachers',
};

const CONTEXT_PLACEHOLDER =
  "Tomorrow's Chemistry practical has been moved from Period 2 to Period 5.\n\nStudents should bring their lab coat and practical record book.";

export default function AiNotice() {
  const { pushToast } = useUI();

  const audiences = useQuery({
    queryKey: ['notice-audiences'],
    queryFn: async () => (await api.get('/notices/audiences')).data as {
      audiences: AudienceOption[];
      tones: string[];
    },
  });

  const [scope, setScope] = useState<Scope | ''>('');
  const [scopeId, setScopeId] = useState('');
  const [recipients, setRecipients] = useState<Recipients | ''>('');
  const [subject, setSubject] = useState('');
  const [context, setContext] = useState('');
  const [tone, setTone] = useState('Professional');

  // The generated text and the draft it came from — the pair tells the server
  // whether a human changed the model's wording.
  const [draft, setDraft] = useState('');
  const [aiDraft, setAiDraft] = useState<string | null>(null);

  const selected = useMemo(
    () => audiences.data?.audiences.find((a) => a.scope === scope),
    [audiences.data, scope],
  );

  // Only offer recipient groups that are valid for the chosen scope.
  const recipientChoices = selected?.recipients ?? [];
  const needsOption = scope === 'GRADE' || scope === 'CLASS';
  const audiencePayload = { scope, scopeId: scopeId || undefined, recipients };

  const canDraft =
    !!scope && !!recipients && (!needsOption || !!scopeId) && subject.trim() !== '' && context.trim() !== '';

  const generate = useMutation({
    mutationFn: async () =>
      (await api.post('/notices/draft', { subject, context, tone, audience: audiencePayload })).data as {
        draft: string;
        audience: string;
        recipientCount: number;
      },
    onSuccess: (res) => {
      setDraft(res.draft);
      setAiDraft(res.draft);
    },
    // The typed context is never cleared on failure — it is the staff
    // member's own work.
    onError: (e) => pushToast({ title: 'Unable to generate draft. Please try again.', body: apiError(e), severity: 'CRITICAL' }),
  });

  const send = useMutation({
    mutationFn: async () =>
      (await api.post('/notices/send', {
        subject,
        body: draft,
        audience: audiencePayload,
        aiAssisted: aiDraft !== null,
        aiDraft: aiDraft ?? undefined,
      })).data as { delivered: number; audience: string; teacherEdited: boolean },
    onSuccess: (res) => {
      pushToast({
        title: 'Notice sent',
        body: `Delivered to ${res.delivered} recipient(s) — ${res.audience}.`,
        severity: 'SUCCESS',
      });
      setDraft('');
      setAiDraft(null);
      setSubject('');
      setContext('');
    },
    // The draft survives a failed send so it can simply be retried.
    onError: (e) => pushToast({ title: 'Could not send the notice', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (audiences.isLoading) return <LoadingScreen label="Checking what you may send…" />;

  const options = audiences.data?.audiences ?? [];
  if (options.length === 0) {
    return (
      <div>
        <PageHeader overline="Trust Core" title="AI Notice" subtitle="AI-assisted professional school communication." />
        <EmptyState
          icon={<Megaphone className="h-7 w-7" />}
          title="No audiences available to you"
          hint="Notices are sent to classes you teach. Ask the office if you expect to see one here."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        overline="Trust Core"
        title="AI Notice"
        subtitle="Draft professional school notices using AI. You remain in full control before anything is sent."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Compose ── */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-400" />
            <h2 className="font-bold text-slate-900">Recipients</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1 block">Target</label>
              <select
                className="input"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Scope);
                  setScopeId('');
                  setRecipients('');
                }}
              >
                <option value="">Choose…</option>
                {options.map((a) => (
                  <option key={a.scope} value={a.scope}>{a.label}</option>
                ))}
              </select>
            </div>

            {needsOption && (
              <div>
                <label className="label mb-1 block">{scope === 'GRADE' ? 'Grade' : 'Class'}</label>
                <select className="input" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                  <option value="">Choose…</option>
                  {selected?.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="label mb-1 block">Send to</label>
              <select
                className="input"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value as Recipients)}
                disabled={!scope}
              >
                <option value="">Choose…</option>
                {recipientChoices.map((r) => (
                  <option key={r} value={r}>{RECIPIENT_LABEL[r]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1 block">Tone</label>
              <select className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
                {(audiences.data?.tones ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="label mb-1 block">Subject</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Chemistry practical rescheduled"
              maxLength={160}
            />
          </div>

          <div className="mt-4">
            <label className="label mb-1 block">Context</label>
            <textarea
              className="input min-h-[170px] resize-y"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={CONTEXT_PLACEHOLDER}
              maxLength={4000}
            />
            <p className="mt-1.5 text-[0.72rem] text-slate-500">
              Write the facts. The assistant improves the wording only — it never adds dates, times or details you did not write.
            </p>
          </div>

          <button
            onClick={() => generate.mutate()}
            disabled={!canDraft || generate.isPending}
            className="btn-primary mt-4"
          >
            {generate.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />} Draft with AI
          </button>
        </Card>

        {/* ── Review ── */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-brand-400" />
            <h2 className="font-bold text-slate-900">AI Draft</h2>
            {aiDraft && draft.trim() !== aiDraft.trim() && <Badge severity="INFO">edited by you</Badge>}
          </div>

          {!draft ? (
            <EmptyState
              icon={<Sparkles className="h-7 w-7" />}
              title="No draft yet"
              hint="Fill in the recipients and context, then use Draft with AI."
            />
          ) : (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <textarea
                className="input min-h-[320px] resize-y"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={8000}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => send.mutate()}
                  disabled={send.isPending || draft.trim() === ''}
                  className="btn-primary"
                >
                  {send.isPending ? <Spinner /> : <Send className="h-4 w-4" />} Review &amp; Send
                </button>
                <button
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending || !canDraft}
                  className="btn-ghost"
                >
                  <RotateCcw className="h-4 w-4" /> Regenerate
                </button>
                <button
                  onClick={() => { setDraft(''); setAiDraft(null); }}
                  disabled={send.isPending}
                  className="btn-ghost"
                >
                  <Trash2 className="h-4 w-4" /> Discard
                </button>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-ink-800/40 px-3 py-2.5 text-[0.72rem] leading-relaxed text-slate-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-400" />
                <span>
                  Nothing is sent until you choose to send it. Recipients are resolved on the server from your
                  permissions, and the notice you approve — not the AI draft — is what is delivered and recorded in
                  the Trust Ledger.
                </span>
              </div>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}

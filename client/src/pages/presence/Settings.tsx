import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useUI } from '@/store/ui';
import { Card, LoadingScreen } from '@/components/ui';
import type { PresenceSettings } from '@/types';

export default function PresenceSettingsPage() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const settings = useQuery({ queryKey: ['presence-settings'], queryFn: async () => (await api.get('/presence/settings')).data as PresenceSettings });
  const [form, setForm] = useState<PresenceSettings | null>(null);

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: async (body: PresenceSettings) => (await api.put('/presence/settings', body)).data,
    onSuccess: (data) => {
      setForm(data);
      qc.invalidateQueries({ queryKey: ['presence-settings'] });
      pushToast({ title: 'Settings saved', body: 'New scans will use the updated policy immediately.', severity: 'SUCCESS' });
    },
    onError: (e) => pushToast({ title: 'Could not save settings', body: apiError(e), severity: 'CRITICAL' }),
  });

  if (settings.isLoading || !form) return <LoadingScreen />;

  return (
    <Card className="max-w-lg">
      <h2 className="mb-1 font-bold text-slate-900">Attendance policy</h2>
      <p className="mb-5 text-sm text-slate-500">Governs every source — RFID, manual and face recognition read the same policy.</p>
      <form
        onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}
        className="space-y-4"
      >
        <Field label="School start time" hint="Entries after this time (+ grace) are classified LATE.">
          <input type="time" value={form.schoolStartTime} onChange={(e) => setForm({ ...form, schoolStartTime: e.target.value })} className="input w-full" />
        </Field>
        <Field label="Late grace period (minutes)">
          <input type="number" min={0} max={120} value={form.lateGraceMinutes} onChange={(e) => setForm({ ...form, lateGraceMinutes: Number(e.target.value) })} className="input w-full" />
        </Field>
        <Field label="Duplicate scan window (seconds)" hint="Repeated scans of the same card within this window are ignored and logged, not double-counted.">
          <input type="number" min={0} max={3600} value={form.duplicateWindowSeconds} onChange={(e) => setForm({ ...form, duplicateWindowSeconds: Number(e.target.value) })} className="input w-full" />
        </Field>
        <Field label="Reader offline threshold (seconds)" hint="A reader with no heartbeat for longer than this is shown offline.">
          <input type="number" min={15} max={3600} value={form.heartbeatOfflineThresholdSeconds} onChange={(e) => setForm({ ...form, heartbeatOfflineThresholdSeconds: Number(e.target.value) })} className="input w-full" />
        </Field>
        <button type="submit" disabled={save.isPending} className="btn-primary w-full !py-2.5"><Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save policy'}</button>
      </form>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

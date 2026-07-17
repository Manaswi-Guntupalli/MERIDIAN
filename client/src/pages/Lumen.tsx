import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Copy, Download, FileScan,
  FileSpreadsheet, FileJson, FileText, History, Loader2, Pencil, RefreshCw, ScanLine,
  Search, ShieldCheck, Sparkles, Trash2, Undo2, UploadCloud, UserPlus, Wand2, X, XCircle,
} from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { useUI } from '@/store/ui';
import PageHeader from '@/components/PageHeader';
import { Badge, EmptyState, LoadingScreen, Meter, Spinner, StatTile } from '@/components/ui';
import { cn, confColor } from '@/lib/utils';
import type { DocActivity, DocDetail, DocInsight, DocSummary, ExtractedField, LumenStats } from '@/types';

// ─────────────────────────────  helpers  ─────────────────────────────

/** Previews live behind the authenticated API, so <img src> can't reach them
 *  (the JWT rides in a header, not a cookie). Fetch as a blob instead. */
function AuthImage({ docId, page, className }: { docId: string; page: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    api
      .get(`/documents/${docId}/page/${page}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        revoke = URL.createObjectURL(res.data);
        setUrl(revoke);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [docId, page]);

  if (!url) {
    return <div className={cn('shimmer aspect-[3/4] w-full rounded-[10px] bg-ink-800', className)} />;
  }
  return <img src={url} alt={`Page ${page + 1}`} className={className} draggable={false} />;
}

function downloadBlob(data: Blob, fileName: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_META: Record<DocSummary['status'], { label: string; severity: string }> = {
  QUEUED: { label: 'Queued', severity: 'INFO' },
  PROCESSING: { label: 'Processing', severity: 'INFO' },
  REVIEW: { label: 'Needs review', severity: 'WARNING' },
  VERIFIED: { label: 'Verified', severity: 'SUCCESS' },
  COMMITTED: { label: 'Committed', severity: 'SUCCESS' },
  FAILED: { label: 'Failed', severity: 'CRITICAL' },
};

const INSIGHT_ICON: Record<DocInsight['kind'], typeof Copy> = {
  DUPLICATE: Copy,
  INCONSISTENCY: AlertTriangle,
  MISSING: CircleAlert,
  CORRECTION: Wand2,
  QUALITY: ScanLine,
};

const SOURCE_LABEL: Record<ExtractedField['source'], string> = {
  TEXT_LAYER: 'read from digital text',
  OCR: 'read by OCR',
  REGEX: 'found by pattern — check it belongs to this field',
  AI: 'repaired by AI, grounded in the page',
  DERIVED: 'derived, not read',
};

interface Progress {
  stage: string;
  pct: number;
}

type Bucket = 'ALL' | 'REVIEW' | 'BUSY' | 'DONE' | 'FAILED';

const BUCKET_OF: Record<DocSummary['status'], Bucket> = {
  QUEUED: 'BUSY',
  PROCESSING: 'BUSY',
  REVIEW: 'REVIEW',
  VERIFIED: 'DONE',
  COMMITTED: 'DONE',
  FAILED: 'FAILED',
};

// ─────────────────────────────  page  ─────────────────────────────

export default function Lumen() {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [filter, setFilter] = useState<Bucket>('ALL');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [docType, setDocType] = useState('AUTO');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);
  const autoSelected = useRef(false);
  // Distinguish "user dragging files" from other drag events (text selection).
  const dragDepth = useRef(0);

  const stats = useQuery({
    queryKey: ['lumen-stats'],
    queryFn: async () => (await api.get('/documents/stats')).data.stats as LumenStats,
  });
  const docs = useQuery({
    queryKey: ['documents'],
    queryFn: async () => (await api.get('/documents')).data.documents as DocSummary[],
  });
  const templates = useQuery({
    queryKey: ['lumen-templates'],
    queryFn: async () => (await api.get('/documents/templates')).data.templates as { type: string; label: string }[],
    staleTime: Infinity,
  });

  // Live pipeline progress, straight off the school's socket room.
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;
    const onProgress = (p: { documentId: string; stage: string; pct: number }) =>
      setProgress((prev) => ({ ...prev, [p.documentId]: { stage: p.stage, pct: p.pct } }));
    const onDone = (d: { documentId: string; status: string; error?: string }) => {
      setProgress((prev) => {
        const next = { ...prev };
        delete next[d.documentId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['lumen-stats'] });
      qc.invalidateQueries({ queryKey: ['document', d.documentId] });
      if (d.status === 'FAILED') {
        pushToast({ title: 'Processing failed', body: d.error ?? 'Unknown error', severity: 'CRITICAL' });
      }
    };
    socket.on('lumen:progress', onProgress);
    socket.on('lumen:done', onDone);
    return () => {
      socket.off('lumen:progress', onProgress);
      socket.off('lumen:done', onDone);
    };
  }, [qc, pushToast]);

  const uploadFiles = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      form.append('type', docType);
      return (await api.post('/documents/upload', form)).data;
    },
    onSuccess: (data: { documents: { id: string }[] }) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['lumen-stats'] });
      // Jump straight to the first new document so its progress is visible
      // without hunting for it in the list.
      if (data.documents[0]) setOpenId(data.documents[0].id);
      setFilter('ALL');
      pushToast({
        title: 'Upload accepted',
        body: `${data.documents.length} document${data.documents.length > 1 ? 's' : ''} queued — extraction is running now.`,
        severity: 'SUCCESS',
      });
    },
    onError: (e) => pushToast({ title: 'Upload failed', body: apiError(e), severity: 'CRITICAL' }),
  });

  const acceptFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const files = [...list].filter((f) => /\.(pdf|png|jpe?g|webp|tiff?)$/i.test(f.name));
      const skipped = list.length - files.length;
      if (skipped) pushToast({ title: `${skipped} file(s) skipped`, body: 'Only PDF, PNG, JPG, WEBP and TIFF are supported.', severity: 'WARNING' });
      if (files.length) uploadFiles.mutate(files);
    },
    [uploadFiles, pushToast],
  );

  const exportAs = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx' | 'json') => {
      const res = await api.post('/documents/export', { format }, { responseType: 'blob' });
      downloadBlob(res.data, `lumen-export.${format}`);
    },
    onError: (e) => pushToast({ title: 'Export failed', body: apiError(e), severity: 'WARNING' }),
  });

  const s = stats.data;
  const all = docs.data ?? [];

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { ALL: all.length, REVIEW: 0, BUSY: 0, DONE: 0, FAILED: 0 };
    for (const d of all) c[BUCKET_OF[d.status]]++;
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const order: DocSummary['status'][] = ['PROCESSING', 'QUEUED', 'REVIEW', 'VERIFIED', 'COMMITTED', 'FAILED'];
    let list = [...all].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    if (filter !== 'ALL') list = list.filter((d) => BUCKET_OF[d.status] === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((d) => (d.fileName + ' ' + d.typeLabel).toLowerCase().includes(q));
    return list;
  }, [all, filter, search]);

  // First load: open the most urgent document so the review pane is never a
  // dead "select something" placard. Only once — after that the selection is
  // the user's, including their choice to close it.
  useEffect(() => {
    if (autoSelected.current || openId || !all.length) return;
    autoSelected.current = true;
    const firstReview = all.find((d) => d.status === 'REVIEW');
    setOpenId((firstReview ?? all[0]).id);
  }, [all, openId]);

  // Selecting a document resets the review pane to its top; on narrow
  // screens (stacked layout) also bring the pane into view.
  useEffect(() => {
    if (!openId) return;
    detailPaneRef.current?.scrollTo({ top: 0 });
    if (window.innerWidth < 1280) detailPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId]);

  return (
    <div
      // The entire page is a drop target — nobody should have to aim a file
      // at a small box when the whole screen is available.
      onDragEnter={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        acceptFiles(e.dataTransfer.files);
      }}
      className="relative"
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-brand-600/10 backdrop-blur-[2px]"
          >
            <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-surface px-10 py-8 text-center shadow-lg">
              <UploadCloud className="mx-auto mb-2 h-8 w-8 text-brand-600" />
              <div className="font-display text-lg font-semibold text-slate-900">Drop to start reading</div>
              <div className="mt-1 text-xs text-slate-500">PDF · PNG · JPG · up to 12 files</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PageHeader
        overline="Engine 01 · Lumen"
        title="Documents that read themselves"
        subtitle="Drop a form anywhere on this page. Every value keeps its confidence score and a proof crop of the exact pixels it was read from."
      />

      {/* ── metrics ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile index={0} label="Documents processed" icon={<FileScan className="h-4 w-4" />} value={s ? s.total - s.failed : '—'} sub={s && s.failed > 0 ? `${s.failed} failed` : 'all time'} />
        <StatTile index={1} label="Average confidence" accent="mint" icon={<ShieldCheck className="h-4 w-4" />} value={s ? `${Math.round(s.avgConfidence * 100)}%` : '—'} sub={s ? `${(s.avgMs / 1000).toFixed(1)}s per document` : undefined} />
        <StatTile index={2} label="Awaiting review" accent="amber" icon={<CircleAlert className="h-4 w-4" />} value={s?.needsReview ?? '—'} sub={s && s.queued > 0 ? `${s.queued} in the queue` : 'human-in-the-loop'} />
        <StatTile index={3} label="Records committed" accent="cyan" icon={<UserPlus className="h-4 w-4" />} value={s?.committed ?? '—'} sub="zero retyping" />
        <StatTile index={4} label="Time saved" accent="brand" icon={<Sparkles className="h-4 w-4" />} value={s ? `${s.timeSavedMinutes}m` : '—'} sub="vs. manual data entry" />
      </div>

      {/* ── workspace: queue rail + review pane, each with its own scroll ── */}
      <div className="surface flex flex-col overflow-hidden !p-0 xl:h-[max(540px,calc(100vh-355px))] xl:flex-row">
        {/* ═ queue rail ═ */}
        <div className="flex shrink-0 flex-col border-b border-line xl:w-[330px] xl:border-b-0 xl:border-r">
          {/* upload strip */}
          <div className="border-b border-line p-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFiles.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-[9px] border border-dashed border-ink-500 py-2.5 text-[0.76rem] font-medium text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700"
            >
              {uploadFiles.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploadFiles.isPending ? 'Uploading…' : 'Drop files anywhere, or browse'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff"
              className="hidden"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input mt-2 !h-7 w-full !py-0 text-[0.7rem]" title="Document type for the next upload">
              <option value="AUTO">Type: auto-detect (recommended)</option>
              {templates.data?.map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* filters + search */}
          <div className="space-y-2 border-b border-line px-3 py-2.5">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['ALL', 'All'],
                  ['REVIEW', 'Review'],
                  ['BUSY', 'Working'],
                  ['DONE', 'Done'],
                  ['FAILED', 'Failed'],
                ] as [Bucket, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[0.66rem] font-semibold transition',
                    filter === key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line text-slate-500 hover:text-slate-900',
                    counts[key] === 0 && key !== 'ALL' && 'opacity-40',
                  )}
                >
                  {label} <span className="tnum">{counts[key]}</span>
                </button>
              ))}
            </div>
            {all.length > 6 && (
              <div className="flex items-center gap-1.5 rounded-[8px] border border-line bg-canvas px-2">
                <Search className="h-3 w-3 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name or type…"
                  className="w-full bg-transparent py-1 text-[0.72rem] text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            )}
          </div>

          {/* the list — its own scroll, never the page's */}
          <div className="min-h-[120px] flex-1 overflow-y-auto max-xl:max-h-[300px]">
            {docs.isLoading ? (
              <div className="p-4"><LoadingScreen /></div>
            ) : visible.length === 0 ? (
              <div className="px-4 py-8">
                <EmptyState
                  icon={<FileScan className="h-5 w-5" />}
                  title={all.length ? 'Nothing matches this filter' : 'No documents yet'}
                  hint={all.length ? 'Try another filter.' : 'Drop an admission form or fee receipt anywhere on this page.'}
                />
              </div>
            ) : (
              visible.map((d) => (
                <QueueRow key={d.id} doc={d} progress={progress[d.id]} active={openId === d.id} onOpen={() => setOpenId(d.id)} />
              ))
            )}
          </div>

          {/* export strip */}
          <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
            <span className="px-1 text-[0.64rem] font-semibold uppercase tracking-wide text-slate-400">Export</span>
            <button onClick={() => exportAs.mutate('csv')} disabled={exportAs.isPending} className="btn-quiet !px-2 !py-1 text-[0.7rem]"><FileText className="h-3 w-3" /> CSV</button>
            <button onClick={() => exportAs.mutate('xlsx')} disabled={exportAs.isPending} className="btn-quiet !px-2 !py-1 text-[0.7rem]"><FileSpreadsheet className="h-3 w-3" /> Excel</button>
            <button onClick={() => exportAs.mutate('json')} disabled={exportAs.isPending} className="btn-quiet !px-2 !py-1 text-[0.7rem]"><FileJson className="h-3 w-3" /> JSON</button>
          </div>
        </div>

        {/* ═ review pane ═ */}
        {/* At xl the pane itself stops scrolling — the preview and the field
            list each manage their own overflow, so the commit footer and the
            document header are always on screen. Below xl the pane flows. */}
        <div ref={detailPaneRef} className="min-w-0 flex-1 overflow-y-auto bg-canvas/60 xl:overflow-hidden">
          {openId ? (
            <DetailPanel docId={openId} onClose={() => setOpenId(null)} />
          ) : (
            <div className="grid h-full min-h-[260px] place-items-center p-8 text-center text-sm text-slate-500">
              <div>
                <Sparkles className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                Pick a document from the queue to review it against the original scan.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────  queue row  ─────────────────────────────

function QueueRow({
  doc,
  progress,
  active,
  onOpen,
}: {
  doc: DocSummary;
  progress?: Progress;
  active: boolean;
  onOpen: () => void;
}) {
  const busy = doc.status === 'QUEUED' || doc.status === 'PROCESSING';

  return (
    <button
      onClick={onOpen}
      className={cn(
        'relative block w-full border-b border-line/70 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-brand-50/70' : 'hover:bg-ink-800/60',
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-600" />}
      <div className="flex items-center gap-2.5">
        <span className="shrink-0">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          ) : doc.status === 'FAILED' ? (
            <XCircle className="h-4 w-4 text-rose-400" />
          ) : doc.status === 'COMMITTED' ? (
            <UserPlus className="h-4 w-4 text-cyan-500" />
          ) : doc.status === 'VERIFIED' ? (
            <CheckCircle2 className="h-4 w-4 text-mint-400" />
          ) : (
            <CircleAlert className="h-4 w-4 text-amber-400" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-[0.8rem]', active ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
            {doc.fileName}
          </div>
          <div className="truncate text-[0.66rem] text-slate-400">
            {busy
              ? progress?.stage ?? 'Waiting for a worker…'
              : doc.status === 'FAILED'
                ? doc.errorMessage ?? 'Failed'
                : `${doc.typeLabel} · ${Math.round(doc.overallConfidence * 100)}%`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {doc.criticalInsights > 0 && !busy && (
            <span title={`${doc.criticalInsights} critical finding(s)`}><AlertTriangle className="h-3.5 w-3.5 text-rose-400" /></span>
          )}
          {doc.status === 'REVIEW' && (
            <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[0.62rem] font-bold text-amber-600">{doc.needsReview}</span>
          )}
          {busy && <span className="tnum text-[0.64rem] text-slate-400">{progress?.pct ?? 0}%</span>}
        </div>
      </div>
      {busy && <Meter value={progress?.pct ?? 2} className="mt-1.5 !h-1" />}
    </button>
  );
}

// ─────────────────────────────  detail  ─────────────────────────────

function DetailPanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { pushToast } = useUI();
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState<ExtractedField | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'fields' | 'history'>('fields');

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', docId],
    queryFn: async () => (await api.get(`/documents/${docId}`)).data.document as DocDetail,
  });

  useEffect(() => {
    setPage(0);
    setEditing(null);
    setHover(null);
    setTab('fields');
  }, [docId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['document', docId] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['lumen-stats'] });
    qc.invalidateQueries({ queryKey: ['document-history', docId] });
  };

  const confirm = useMutation({
    mutationFn: async ({ fieldId, value }: { fieldId: string; value?: string }) =>
      (await api.patch(`/documents/field/${fieldId}`, value !== undefined ? { value } : {})).data,
    onSuccess: (data) => {
      setEditing(null);
      invalidate();
      if (data.verified) pushToast({ title: 'Document verified ✓', body: 'All fields resolved — ready to commit.', severity: 'SUCCESS' });
    },
    onError: (e) => pushToast({ title: 'Could not save', body: apiError(e), severity: 'WARNING' }),
  });

  const commit = useMutation({
    mutationFn: async () => (await api.post(`/documents/${docId}/commit`)).data.committed,
    onSuccess: (c: { kind: string; summary: string; notes: string[] }) => {
      invalidate();
      qc.invalidateQueries({ queryKey: [c.kind === 'STUDENT' ? 'students' : 'staff'] });
      pushToast({ title: `${c.kind === 'STUDENT' ? 'Student' : 'Staff'} record created ✓`, body: [c.summary, ...c.notes].join(' · '), severity: 'SUCCESS' });
    },
    onError: (e) => pushToast({ title: 'Commit blocked', body: apiError(e), severity: 'WARNING' }),
  });

  const reprocess = useMutation({
    mutationFn: async (type: string) => api.post(`/documents/${docId}/reprocess`, type ? { type } : {}),
    onSuccess: () => {
      invalidate();
      pushToast({ title: 'Reprocessing', body: 'Running the pipeline again.', severity: 'INFO' });
    },
    onError: (e) => pushToast({ title: 'Could not reprocess', body: apiError(e), severity: 'WARNING' }),
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(`/documents/${docId}`),
    onSuccess: () => {
      onClose();
      invalidate();
      pushToast({ title: 'Document deleted', body: 'The file and its extraction were removed.', severity: 'INFO' });
    },
    onError: (e) => pushToast({ title: 'Could not delete', body: apiError(e), severity: 'WARNING' }),
  });

  const downloadOriginal = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/documents/${docId}/original`, { responseType: 'blob' });
      downloadBlob(res.data, doc?.fileName ?? 'document');
    },
  });

  const templates = useQuery({
    queryKey: ['lumen-templates'],
    queryFn: async () => (await api.get('/documents/templates')).data.templates as { type: string; label: string }[],
    staleTime: Infinity,
  });

  if (isLoading || !doc) return <div className="p-6"><LoadingScreen /></div>;

  const busy = doc.status === 'QUEUED' || doc.status === 'PROCESSING';
  const fields = doc.fields;
  const currentPageMeta = doc.pages.find((p) => p.index === page);
  const highlight = hover && hover.page === page && hover.cropW > 0 ? hover : null;

  return (
    <div className="flex min-h-full flex-col xl:h-full xl:min-h-0">
      {/* header — sticky so the status and actions never scroll away */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{doc.fileName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-slate-500">
            <span>{doc.typeLabel}</span>
            {doc.typeConfidence > 0 && doc.typeConfidence < 1 && (
              <span className={confColor(doc.typeConfidence)}>type {Math.round(doc.typeConfidence * 100)}%</span>
            )}
            <span>· {(doc.processingMs / 1000).toFixed(1)}s</span>
            {doc.pages.length > 0 && (
              <span>· {doc.pages.every((p) => p.source === 'TEXT_LAYER') ? 'digital text — no OCR needed' : 'OCR pipeline'}</span>
            )}
            {currentPageMeta?.quality && currentPageMeta.quality.verdict !== 'GOOD' && (
              <Badge severity={currentPageMeta.quality.verdict === 'POOR' ? 'CRITICAL' : 'WARNING'} className="!text-[0.62rem]">
                {currentPageMeta.quality.verdict === 'POOR' ? 'poor scan' : 'fair scan'}
              </Badge>
            )}
          </div>
        </div>
        {!busy && doc.status !== 'FAILED' && (
          <div className="flex items-center rounded-[8px] border border-line bg-canvas p-0.5" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'fields'}
              onClick={() => setTab('fields')}
              className={cn('rounded-[6px] px-2.5 py-1 text-[0.72rem] font-semibold transition', tab === 'fields' ? 'bg-surface text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
            >
              Fields
            </button>
            <button
              role="tab"
              aria-selected={tab === 'history'}
              onClick={() => setTab('history')}
              className={cn('flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-[0.72rem] font-semibold transition', tab === 'history' ? 'bg-surface text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
            >
              <History className="h-3 w-3" /> History
            </button>
          </div>
        )}
        <Badge severity={STATUS_META[doc.status].severity}>{STATUS_META[doc.status].label}</Badge>
        <button onClick={onClose} className="btn-quiet !px-1.5" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {busy ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-slate-500">
          <div>
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-brand-500" />
            Reading the document… fields appear here the moment extraction finishes.
          </div>
        </div>
      ) : doc.status === 'FAILED' ? (
        <div className="p-5">
          <div className="rounded-xl bg-rose-400/[0.07] p-4 text-sm text-rose-500">{doc.errorMessage ?? 'Processing failed.'}</div>
          <button onClick={() => reprocess.mutate('')} disabled={reprocess.isPending} className="btn-ghost mt-3 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : tab === 'history' ? (
        <HistoryTimeline docId={docId} fileName={doc.fileName} />
      ) : (
        <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:min-h-0 xl:overflow-hidden">
          {/* ── page preview: sticky while the page scrolls (mobile/lg); at xl
              it becomes its own scroll region sized to the workspace, so the
              scan is always exactly as tall as the panel. ── */}
          <div className="border-b border-line p-4 lg:sticky lg:top-[64px] lg:self-start lg:border-b-0 xl:static xl:h-full xl:min-h-0 xl:self-auto xl:overflow-y-auto">
            <div className="tilt-3d relative overflow-hidden rounded-[10px] border border-line bg-white shadow-xs">
              <AuthImage docId={doc.id} page={page} className="w-full select-none" />
              <AnimatePresence>
                {highlight && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="pointer-events-none absolute rounded-[3px] border-2 border-brand-500 bg-brand-500/10"
                    style={{
                      left: `${highlight.cropX * 100}%`,
                      top: `${highlight.cropY * 100}%`,
                      width: `${highlight.cropW * 100}%`,
                      height: `${highlight.cropH * 100}%`,
                    }}
                  >
                    <span className="absolute -top-[19px] left-0 whitespace-nowrap rounded bg-brand-600 px-1.5 py-px text-[0.6rem] font-bold text-white">
                      {highlight.label}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="mt-2 flex items-center justify-between">
              {doc.pages.length > 1 ? (
                <div className="flex items-center gap-1">
                  {doc.pages.map((p) => (
                    <button
                      key={p.index}
                      onClick={() => setPage(p.index)}
                      className={cn('rounded-md border px-2 py-0.5 text-[0.68rem] font-semibold transition', page === p.index ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line text-slate-500 hover:text-slate-900')}
                    >
                      {p.index + 1}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[0.68rem] text-slate-400">Hover a field to see the exact pixels it was read from.</span>
              )}
              <button onClick={() => downloadOriginal.mutate()} className="btn-quiet !px-2 text-[0.7rem]" title="Download original">
                <Download className="h-3.5 w-3.5" /> Original
              </button>
            </div>
          </div>

          {/* ── fields + insights (scrolling) with the actions footer pinned ── */}
          <div className="flex min-w-0 flex-col lg:border-l lg:border-line xl:h-full xl:min-h-0 xl:overflow-hidden">
            {/* One scroll region for insights + fields. At xl it fills the
                workspace exactly; below xl it is capped so a 20-field form
                can never push the confidence bar and commit button off the
                bottom of the page. */}
            <div className="min-h-0 flex-1 overflow-y-auto max-xl:max-h-[55vh]">
              {doc.insights.length > 0 && (
                <div className="space-y-1.5 border-b border-line p-3">
                  {doc.insights.slice(0, 6).map((i) => {
                    const Icon = INSIGHT_ICON[i.kind] ?? Sparkles;
                    return (
                      <div
                        key={i.id}
                        className={cn(
                          'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[0.72rem] leading-snug',
                          i.severity === 'CRITICAL' ? 'bg-rose-400/[0.08] text-rose-500' : i.severity === 'WARNING' ? 'bg-amber-400/[0.08] text-amber-600' : 'bg-ink-800 text-slate-500',
                        )}
                      >
                        <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>{i.message}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="divide-y divide-line px-4">
                {fields.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    editing={editing === f.id}
                    draft={draft}
                    committed={doc.status === 'COMMITTED'}
                    onHover={setHover}
                    onEdit={() => {
                      setEditing(f.id);
                      setDraft(f.value);
                      if (f.page !== page) setPage(f.page);
                    }}
                    onDraft={setDraft}
                    onCancel={() => setEditing(null)}
                    onConfirm={(value) => confirm.mutate({ fieldId: f.id, value })}
                    saving={confirm.isPending && editing === f.id}
                  />
                ))}
              </div>
            </div>

            {/* footer: overall + actions */}
            <div className="border-t border-line p-4">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Overall confidence</span>
                <span className={cn('tnum font-bold', confColor(doc.overallConfidence))}>{Math.round(doc.overallConfidence * 100)}%</span>
              </div>
              <Meter value={doc.overallConfidence * 100} tone={doc.overallConfidence >= 0.85 ? 'mint' : doc.overallConfidence >= 0.6 ? 'amber' : 'rose'} />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {doc.status === 'VERIFIED' && doc.commits && (
                  <button onClick={() => commit.mutate()} disabled={commit.isPending} className="btn-primary !py-2 text-xs">
                    {commit.isPending ? <Spinner /> : <UserPlus className="h-3.5 w-3.5" />}
                    Create {doc.commits === 'STUDENT' ? 'student' : 'staff'} record
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                {doc.status === 'COMMITTED' && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-mint-500">
                    <CheckCircle2 className="h-4 w-4" /> Committed to {doc.committedKind === 'STUDENT' ? 'students' : 'staff'} — undo from the Trust ledger.
                  </span>
                )}
                {doc.status !== 'COMMITTED' && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && reprocess.mutate(e.target.value)}
                    className="input !h-8 !w-auto !py-0 text-[0.7rem]"
                    title="Re-run extraction as a different document type"
                  >
                    <option value="">Reprocess as…</option>
                    {templates.data?.map((t) => (
                      <option key={t.type} value={t.type}>{t.label}</option>
                    ))}
                  </select>
                )}
                <span className="flex-1" />
                {doc.status !== 'COMMITTED' && (
                  <button
                    onClick={() => window.confirm(`Delete "${doc.fileName}" and its extraction?`) && remove.mutate()}
                    disabled={remove.isPending}
                    className="btn-quiet !px-2 text-xs !text-rose-400 hover:!bg-rose-400/[0.08]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {doc.pipeline?.timings && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.62rem] text-slate-400">
                  {doc.pipeline.timings.map((t) => (
                    <span key={t.stage} className="tnum">
                      {t.stage} {t.ms}ms{t.note ? ` (${t.note})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────  processing history  ─────────────────────────

/** One rendered node on the timeline. */
interface TimelineNode {
  id: string;
  icon: typeof UploadCloud;
  tone: string; // tailwind text-* for the icon chip
  title: string;
  sub?: string;
  /** Per-field change lines for grouped review sessions. */
  lines?: { label: string; from?: string; to?: string }[];
  time: string;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Fold the raw activity feed into presentable nodes. The one transformation:
 * consecutive field confirmations/corrections by the same person collapse
 * into a single "review session" node — a clerk resolving twelve fields is
 * one sitting, and "5 corrections" (with the details beneath) reads the way
 * a human would tell it.
 */
function buildTimeline(entries: DocActivity[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let session: { actor: string; corrections: DocActivity[]; confirmations: DocActivity[]; last: DocActivity } | null = null;

  const flushSession = () => {
    if (!session) return;
    const c = session.corrections.length;
    const k = session.confirmations.length;
    const parts = [];
    if (c) parts.push(`${c} correction${c > 1 ? 's' : ''}`);
    if (k) parts.push(`${k} confirmed as read`);
    nodes.push({
      id: session.last.id,
      icon: Pencil,
      tone: c ? 'text-amber-500 bg-amber-400/[0.1]' : 'text-mint-500 bg-mint-400/[0.1]',
      title: parts.join(' · '),
      sub: `Reviewed by ${session.actor}`,
      lines: session.corrections.map((a) => ({
        label: String(a.detail?.label ?? 'Field'),
        from: String(a.detail?.from ?? ''),
        to: String(a.detail?.to ?? ''),
      })),
      time: fmtTime(session.last.createdAt),
    });
    session = null;
  };

  for (const a of entries) {
    if (a.kind === 'FIELD_CORRECTED' || a.kind === 'FIELD_CONFIRMED') {
      const actor = a.actorName ?? 'Staff';
      if (session && session.actor !== actor) flushSession();
      session ??= { actor, corrections: [], confirmations: [], last: a };
      (a.kind === 'FIELD_CORRECTED' ? session.corrections : session.confirmations).push(a);
      session.last = a;
      continue;
    }
    flushSession();

    const d = a.detail ?? {};
    switch (a.kind) {
      case 'UPLOADED':
        nodes.push({
          id: a.id, icon: UploadCloud, tone: 'text-brand-600 bg-brand-50',
          title: `Uploaded by ${a.actorName ?? 'Staff'}`,
          sub: d.sizeBytes ? `${(Number(d.sizeBytes) / 1024).toFixed(0)} KB${d.forcedType ? ` · type forced: ${d.forcedType}` : ''}` : undefined,
          time: fmtTime(a.createdAt),
        });
        break;
      case 'PROCESSED':
        nodes.push({
          id: a.id, icon: ScanLine, tone: 'text-cyan-600 bg-cyan-400/[0.1]',
          title: `Read as ${d.typeLabel ?? 'document'} — ${Math.round(Number(d.confidence ?? 0) * 100)}% confidence`,
          sub: `${d.fieldsRead}/${d.fieldsTotal} fields · ${d.engine} · ${(Number(d.ms ?? 0) / 1000).toFixed(1)}s`,
          time: fmtTime(a.createdAt),
        });
        break;
      case 'FAILED':
        nodes.push({
          id: a.id, icon: XCircle, tone: 'text-rose-500 bg-rose-400/[0.1]',
          title: 'Processing failed', sub: String(d.message ?? ''), time: fmtTime(a.createdAt),
        });
        break;
      case 'REPROCESSED':
        nodes.push({
          id: a.id, icon: RefreshCw, tone: 'text-slate-500 bg-ink-800',
          title: `Reprocessed by ${a.actorName ?? 'Staff'}`,
          sub: d.forcedType ? `as ${String(d.forcedType)}` : 'same settings',
          time: fmtTime(a.createdAt),
        });
        break;
      case 'VERIFIED':
        nodes.push({
          id: a.id, icon: ShieldCheck, tone: 'text-mint-500 bg-mint-400/[0.1]',
          title: 'Verified — every field resolved',
          sub: a.actorName ? `Completed by ${a.actorName}` : undefined,
          time: fmtTime(a.createdAt),
        });
        break;
      case 'COMMITTED':
        nodes.push({
          id: a.id, icon: UserPlus, tone: 'text-white bg-brand-600',
          title: `Imported by ${a.actorName ?? 'Staff'}`,
          sub: String(d.summary ?? `Created a ${String(d.kind ?? '').toLowerCase()} record`),
          time: fmtTime(a.createdAt),
        });
        break;
      case 'COMMIT_UNDONE':
        nodes.push({
          id: a.id, icon: Undo2, tone: 'text-amber-500 bg-amber-400/[0.1]',
          title: 'Commit undone via the Trust ledger',
          sub: 'The created record was removed; the document returned to Verified.',
          time: fmtTime(a.createdAt),
        });
        break;
    }
  }
  flushSession();
  return nodes;
}

function HistoryTimeline({ docId, fileName }: { docId: string; fileName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['document-history', docId],
    queryFn: async () => (await api.get(`/documents/${docId}/history`)).data.history as DocActivity[],
  });

  if (isLoading) return <div className="p-6"><LoadingScreen /></div>;
  const nodes = buildTimeline(data ?? []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 text-[0.72rem] text-slate-500">
        Everything that has happened to <span className="font-semibold text-slate-700">{fileName}</span>, oldest first.
        This trail is append-only — it is the document's audit record.
      </div>
      {nodes.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">No history recorded yet.</div>
      ) : (
        <div className="max-w-xl">
          {nodes.map((n, i) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex gap-3"
            >
              {/* node chip + connector */}
              <div className="flex flex-col items-center">
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full shadow-xs ring-1 ring-line', n.tone)}>
                  <n.icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                {i < nodes.length - 1 && <span className="w-px flex-1 bg-line" aria-hidden />}
              </div>
              {/* card */}
              <div className={cn('min-w-0 flex-1', i < nodes.length - 1 && 'pb-5')}>
                <div className="lift-3d rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.82rem] font-semibold text-slate-900">{n.title}</span>
                    <span className="tnum shrink-0 text-[0.64rem] text-slate-400">{n.time}</span>
                  </div>
                  {n.sub && <div className="mt-0.5 text-[0.7rem] text-slate-500">{n.sub}</div>}
                  {n.lines && n.lines.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-line pt-2">
                      {n.lines.map((l, j) => (
                        <div key={j} className="flex flex-wrap items-baseline gap-x-1.5 text-[0.68rem]">
                          <span className="font-semibold text-slate-600">{l.label}:</span>
                          <span className="text-rose-400 line-through decoration-rose-300">{l.from || '—'}</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-medium text-mint-600">{l.to || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────  field row  ─────────────────────────────

function FieldRow({
  field: f,
  editing,
  draft,
  committed,
  saving,
  onHover,
  onEdit,
  onDraft,
  onCancel,
  onConfirm,
}: {
  field: ExtractedField;
  editing: boolean;
  draft: string;
  committed: boolean;
  saving: boolean;
  onHover: (f: ExtractedField | null) => void;
  onEdit: () => void;
  onDraft: (v: string) => void;
  onCancel: () => void;
  onConfirm: (value?: string) => void;
}) {
  const needsAttention = f.status === 'REVIEW' || f.status === 'MISSING';

  return (
    <div
      onMouseEnter={() => onHover(f)}
      onMouseLeave={() => onHover(null)}
      className={cn('py-2.5 transition-colors', needsAttention && '-mx-2 rounded-lg bg-amber-400/[0.05] px-2', f.status === 'MISSING' && '!bg-rose-400/[0.05]')}
    >
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[0.68rem] text-slate-500">
            {f.label}
            {f.required && <span className="text-rose-400">*</span>}
            {f.corrected && (
              <span title={`Machine-repaired${f.rawValue ? ` from "${f.rawValue}"` : ''} — ${SOURCE_LABEL[f.source]}`}>
                <Wand2 className="h-3 w-3 text-cyan-500" />
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirm(draft);
                  if (e.key === 'Escape') onCancel();
                }}
                className="input !h-8 flex-1 !py-0 text-sm"
              />
              <button onClick={() => onConfirm(draft)} disabled={saving} className="btn-primary !px-2.5 !py-1.5 text-xs">
                {saving ? <Spinner /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <button onClick={onCancel} className="btn-quiet !px-2 !py-1.5 text-xs">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="truncate text-sm font-semibold text-slate-900" title={f.rawValue && f.rawValue !== f.value ? `Machine read: "${f.rawValue}"` : undefined}>
              {f.value || <span className="font-normal italic text-slate-400">not found</span>}
            </div>
          )}

          {f.validationMessage && !editing && (
            <div className="mt-0.5 text-[0.66rem] leading-snug text-amber-600">{f.validationMessage}</div>
          )}
        </div>

        {!editing && (
          <>
            <span className={cn('tnum shrink-0 text-xs font-bold', confColor(f.confidence))}>{Math.round(f.confidence * 100)}%</span>
            {f.status === 'CONFIRMED' ? (
              <span title="Confirmed by a human"><CheckCircle2 className="h-4 w-4 shrink-0 text-mint-400" /></span>
            ) : f.status === 'AUTO' ? (
              <span title={`Auto-accepted — ${SOURCE_LABEL[f.source]}`}><ShieldCheck className="h-4 w-4 shrink-0 text-slate-300" /></span>
            ) : null}
            {!committed && (
              <div className="flex shrink-0 items-center gap-1">
                {needsAttention && (
                  <button onClick={() => onConfirm(undefined)} className="btn-ghost !px-2 !py-1 text-[0.7rem]" title="The value is correct as read">
                    Confirm
                  </button>
                )}
                <button onClick={onEdit} className="btn-quiet !px-1.5 !py-1" title="Edit value">
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

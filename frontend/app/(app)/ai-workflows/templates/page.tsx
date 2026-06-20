'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText, Loader2, Wand2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { workflows, type WorkflowTemplate, ApiError } from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

export default function WorkflowTemplatesPage() {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<WorkflowTemplate | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await workflows.templates();
        setTemplates(res.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  function openStart(t: WorkflowTemplate) {
    setPicked(t);
    setName(t.name);
  }

  async function create() {
    if (!picked || !name.trim()) return;
    setCreating(true);
    try {
      const wf = await workflows.create({ template: picked.id, name: name.trim() });
      toast.success(`Workflow “${wf.name}” created.`, { major: true });
      router.push(`/ai-workflows/${wf.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start workflow.');
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/ai-workflows"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
      >
        <ArrowLeft size={12} /> Workflows
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Templates</h1>
      <p className="mt-1 text-sm text-muted">
        Each template defines an ordered set of stages with sensible defaults — edit each stage&rsquo;s prompt before you run it.
      </p>

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <SkeletonCard className="h-44" />
          <SkeletonCard className="h-44" />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id} className="card flex flex-col">
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
                  <FileText size={18} />
                </span>
                <div>
                  <h3 className="font-semibold">{t.name}</h3>
                  <p className="text-[11px] uppercase tracking-wide text-muted">{t.matter_type || '—'}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink/80">{t.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(t.stages ?? []).map((s) => (
                  <span key={s.slug} className="badge-muted text-[10px]">{s.title}</span>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  onClick={() => openStart(t)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  Start workflow
                  <ArrowRight size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !creating && setPicked(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">Start workflow</h3>
                <p className="mt-0.5 text-sm text-muted">From “{picked.name}” template.</p>
              </div>
              <button onClick={() => !creating && setPicked(null)} className="text-muted hover:text-ink"><X size={18} /></button>
            </div>
            <label className="mt-4 block text-xs font-semibold text-muted">Workflow name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="e.g. Answering Affidavit — Doe v Acme"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPicked(null)} disabled={creating} className="btn-outline">Cancel</button>
              <button onClick={create} disabled={creating || !name.trim()} className="btn-primary">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {creating ? 'Creating…' : 'Create workflow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

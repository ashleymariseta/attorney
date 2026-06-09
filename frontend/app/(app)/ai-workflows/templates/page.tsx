'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { workflows, type WorkflowTemplate, ApiError } from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

export default function WorkflowTemplatesPage() {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await workflows.templates();
        setTemplates(res.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function start(t: WorkflowTemplate) {
    const name = prompt(`Name this ${t.name} workflow:`, t.name);
    if (!name?.trim()) return;
    setStarting(t.id);
    try {
      const wf = await workflows.create({ template: t.id, name: name.trim() });
      toast.success(`Workflow “${wf.name}” created.`, { major: true });
      router.push(`/ai-workflows/${wf.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start workflow.');
    } finally {
      setStarting(null);
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
        Each template defines an ordered set of stages with sensible default providers — all overridable per stage.
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
                  disabled={starting === t.id}
                  onClick={() => start(t)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  {starting === t.id ? 'Starting…' : 'Start workflow'}
                  <ArrowRight size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

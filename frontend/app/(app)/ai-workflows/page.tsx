'use client';

import Link from 'next/link';
import { ArrowRight, FileText, KeyRound, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { workflows, type WorkflowListItem } from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';

export default function MyWorkflowsPage() {
  const [list, setList] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await workflows.list();
        setList(res.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI Workflows</h1>
          <p className="mt-1 text-sm text-muted">
            Stage-based legal-work pipelines — grounded retrieval, verifiable citations, your provider of choice per stage.
          </p>
        </div>
        <Link
          href="/ai-workflows/templates"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
        >
          Start a workflow
          <ArrowRight size={14} />
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <SkeletonCard className="h-28" />
          <SkeletonCard className="h-28" />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-light/30 text-brand-dark">
            <Sparkles size={20} />
          </span>
          <h2 className="mt-3 text-base font-bold">No workflows yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Pick a template (e.g. <em>Spoliation Application</em>, <em>Conveyancing Transfer</em>) and we&rsquo;ll spin up an
            intake → research → skeleton → draft pipeline for the matter.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/ai-workflows/templates" className="btn-primary">
              <FileText size={14} /> Browse templates
            </Link>
            <Link href="/ai-workflows/providers" className="btn-outline">
              <KeyRound size={14} /> Add a provider
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {list.map((w) => (
            <li key={w.id}>
              <Link
                href={`/ai-workflows/${w.id}`}
                className="block rounded-xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
                  {w.template_name ?? '—'}
                </p>
                <h3 className="mt-0.5 font-semibold">{w.name}</h3>
                <p className="mt-2 text-xs text-muted">
                  {w.approved_count}/{w.stage_count} stages approved · started {new Date(w.created_at).toLocaleDateString()}
                </p>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{w.status_display}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

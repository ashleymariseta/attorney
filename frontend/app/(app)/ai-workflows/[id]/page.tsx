'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  PencilLine,
  Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  workflows,
  workflowStages,
  ApiError,
  type WorkflowDetail,
  type WorkflowStageData,
} from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

const STATUS_TINT: Record<string, string> = {
  pending: 'bg-canvas text-muted',
  in_progress: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  awaiting_approval: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
};

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const toast = useToast();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function reload() {
    const data = await workflows.get(id);
    setWf(data);
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {}
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run(stage: WorkflowStageData) {
    setBusy(stage.id);
    try {
      await workflowStages.run(stage.id, {
        system_prompt: stage.purpose,
        user_prompt: stage.prompt_template,
      });
      await reload();
      toast.success(`${stage.title} run complete — review the result.`, { major: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Run failed.');
    } finally {
      setBusy(null);
    }
  }

  async function approve(stage: WorkflowStageData) {
    setBusy(stage.id);
    try {
      await workflowStages.approve(stage.id);
      await reload();
      toast.success(`${stage.title} approved.`, { major: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not approve.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <SkeletonCard className="h-32" />
      </div>
    );
  }
  if (!wf) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12 text-center">
        <h1 className="text-xl font-bold">Workflow not found</h1>
        <Link href="/ai-workflows" className="mt-4 inline-flex btn-primary">Back</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/ai-workflows"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
      >
        <ArrowLeft size={12} /> Workflows
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{wf.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {wf.template_name ? `From “${wf.template_name}”` : 'Custom workflow'} ·{' '}
        {wf.approved_count}/{wf.stage_count} stages approved
      </p>

      <ol className="mt-6 space-y-3">
        {wf.stages.map((stage, idx) => {
          const open = expanded === stage.id;
          const isApproved = stage.status === 'approved';
          return (
            <li key={stage.id} className="overflow-hidden rounded-2xl border border-line bg-white">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : stage.id)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${
                    isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-light/30 text-brand-dark'
                  }`}
                >
                  {isApproved ? <CheckCircle2 size={16} /> : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{stage.title}</p>
                  <p className="text-xs text-muted">{stage.purpose}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TINT[stage.status] ?? 'bg-canvas'}`}>
                  {stage.status_display}
                </span>
                <ChevronDown size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open && (
                <div className="space-y-4 border-t border-line bg-canvas/40 px-5 py-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Detail label="Provider">{stage.provider_display}</Detail>
                    <Detail label="Default model">{stage.model || '—'}</Detail>
                    <Detail label="Retrieval scope">{stage.retrieval_scope || 'none'}</Detail>
                  </div>

                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <PencilLine size={11} /> Prompt template
                    </p>
                    <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-ink ring-1 ring-inset ring-line">
                      {stage.prompt_template || '—'}
                    </pre>
                  </div>

                  {stage.latest_result ? (
                    <div>
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Latest output · {stage.latest_result.provider} · {stage.latest_result.model}
                      </p>
                      {stage.latest_result.error ? (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{stage.latest_result.error}</p>
                      ) : (
                        <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-ink ring-1 ring-inset ring-line">
                          {stage.latest_result.output_text}
                        </pre>
                      )}
                      <p className="mt-1 text-[11px] text-muted">
                        {stage.latest_result.tokens_in} in / {stage.latest_result.tokens_out} out tokens ·{' '}
                        {new Date(stage.latest_result.created_at).toLocaleString()}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted">
                      <CircleDashed size={14} /> No run yet for this stage.
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => run(stage)}
                      disabled={busy === stage.id || isApproved}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white hover:bg-brand disabled:opacity-50"
                    >
                      <Play size={12} /> {busy === stage.id ? 'Running…' : 'Run stage'}
                    </button>
                    <button
                      onClick={() => approve(stage)}
                      disabled={busy === stage.id || isApproved}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-brand disabled:opacity-50"
                    >
                      <CheckCircle2 size={12} /> Approve
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm text-ink">{children}</p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, Loader2 } from 'lucide-react';
import { contractReviews, ApiError, type ContractReview, type ContractSection, type RiskLevel } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { SkeletonCard } from '@/components/Skeleton';
import Markdown from '@/components/Markdown';

const RISK_BADGE: Record<RiskLevel, string> = {
  high: 'bg-rose-100 text-rose-700 ring-rose-200',
  medium: 'bg-amber-100 text-amber-700 ring-amber-200',
  low: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
};
const RISK_DOT: Record<RiskLevel, string> = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};
const RISK_BORDER: Record<RiskLevel, string> = {
  high: 'border-l-rose-400',
  medium: 'border-l-amber-400',
  low: 'border-l-emerald-400',
};

export default function ContractReviewPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const toast = useToast();
  const [review, setReview] = useState<ContractReview | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await contractReviews.get(id);
        if (!alive) return;
        setReview(r);
        setLoading(false);
        if (r.status === 'processing' || r.status === 'pending') {
          pollRef.current = setTimeout(tick, 2500);
        }
      } catch (err) {
        if (!alive) return;
        setLoading(false);
        toast.error(err instanceof ApiError ? err.message : 'Could not load the review.');
      }
    }
    tick();
    return () => { alive = false; if (pollRef.current) clearTimeout(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6"><SkeletonCard className="h-64" /></div>;
  if (!review) return (
    <div className="mx-auto max-w-xl px-6 py-12 text-center">
      <h1 className="text-xl font-bold">Review not found</h1>
      <Link href="/ai-workflows/contracts" className="mt-4 inline-flex btn-primary">Back</Link>
    </div>
  );

  const result = (review.result && 'sections' in review.result) ? review.result : null;
  const sections = result?.sections ?? [];
  const counts = { high: 0, medium: 0, low: 0 } as Record<RiskLevel, number>;
  sections.forEach((s) => { counts[s.risk] = (counts[s.risk] ?? 0) + 1; });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/ai-workflows/contracts" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
        <ArrowLeft size={12} /> Contract Review
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{review.title || 'Contract review'}</h1>

      {(review.status === 'processing' || review.status === 'pending') && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-white p-5 text-sm text-muted shadow-sm">
          <Loader2 size={16} className="animate-spin text-brand-dark" /> Analysing the contract — this can take up to a minute…
        </div>
      )}

      {review.status === 'error' && (
        <div className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={14} className="mr-1 inline" /> {review.error || 'The review failed.'}
        </div>
      )}

      {review.status === 'done' && result && (
        <>
          {/* Overview */}
          <div className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ring-1 ring-inset ${RISK_BADGE[result.overall_risk]}`}>
                {result.overall_risk} risk
              </span>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.high}`} /> {counts.high} high</span>
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.medium}`} /> {counts.medium} medium</span>
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.low}`} /> {counts.low} low</span>
              </div>
            </div>
            {result.parties?.length > 0 && (
              <p className="mt-3 text-xs text-muted"><span className="font-semibold">Parties:</span> {result.parties.join(' · ')}</p>
            )}
            <div className="mt-2"><Markdown size="sm">{result.summary}</Markdown></div>

            {/* Heat-map strip */}
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Heat map</p>
              <div className="flex flex-wrap gap-1">
                {sections.map((s, i) => (
                  <a key={i} href={`#sec-${i}`} title={`${s.heading} — ${s.risk}`} className={`h-6 w-6 rounded ${RISK_DOT[s.risk]} opacity-80 transition hover:opacity-100`} />
                ))}
              </div>
            </div>
          </div>

          {/* Sections */}
          <div className="mt-5 space-y-3">
            {sections.map((s, i) => <SectionCard key={i} idx={i} section={s} />)}
          </div>

          <p className="mt-6 text-[11px] text-muted">
            AI-generated analysis — not legal advice. Review against the contract text before relying on it.
          </p>
        </>
      )}
    </div>
  );
}

function SectionCard({ idx, section }: { idx: number; section: ContractSection }) {
  const [open, setOpen] = useState(section.risk === 'high');
  return (
    <div id={`sec-${idx}`} className={`overflow-hidden rounded-xl border border-line border-l-4 bg-white shadow-sm ${RISK_BORDER[section.risk]}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${RISK_DOT[section.risk]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{section.heading}</span>
          <span className="block truncate text-xs text-muted">{section.summary}</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset ${RISK_BADGE[section.risk]}`}>{section.risk}</span>
        {section.issues.length > 0 && <span className="text-[11px] text-muted">{section.issues.length}</span>}
        <ChevronDown size={15} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-line bg-canvas/40 px-4 py-3">
          {section.excerpt && (
            <blockquote className="mb-3 border-l-2 border-line pl-3 text-xs italic text-ink/70">“{section.excerpt}”</blockquote>
          )}
          {section.issues.length === 0 ? (
            <p className="text-xs text-emerald-700">No issues flagged.</p>
          ) : (
            <ul className="space-y-2.5">
              {section.issues.map((it, j) => (
                <li key={j} className="rounded-lg bg-white p-3 ring-1 ring-inset ring-line">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset ${RISK_BADGE[it.severity]}`}>{it.severity}</span>
                    <span className="text-sm font-medium text-ink">{it.issue}</span>
                  </div>
                  {it.recommendation && (
                    <p className="mt-1.5 text-xs text-muted"><span className="font-semibold text-ink">Fix:</span> {it.recommendation}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

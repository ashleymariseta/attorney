'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileWarning, Loader2, ShieldAlert, Upload, X } from 'lucide-react';
import {
  contractReviews, ApiError, type ContractReviewListItem, type RiskLevel,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { SkeletonCard } from '@/components/Skeleton';

const RISK_TINT: Record<RiskLevel, string> = {
  high: 'bg-rose-100 text-rose-700 ring-rose-200',
  medium: 'bg-amber-100 text-amber-700 ring-amber-200',
  low: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
};

export default function ContractsPage() {
  const toast = useToast();
  const router = useRouter();
  const [list, setList] = useState<ContractReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      const r = await contractReviews.list();
      setList(r.results);
    } catch {}
  }
  useEffect(() => { reload().finally(() => setLoading(false)); }, []);

  async function upload(file: File) {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File too large (max 15 MB).');
      return;
    }
    setUploading(true);
    try {
      const review = await contractReviews.create(file, file.name.replace(/\.[^.]+$/, ''));
      router.push(`/ai-workflows/contracts/${review.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start the review.');
      setUploading(false);
    }
  }

  async function del(id: number) {
    const ok = await toast.confirm({ title: 'Delete this review?', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await contractReviews.remove(id);
      setList((l) => l.filter((x) => x.id !== id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/ai-workflows" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
        <ArrowLeft size={12} /> Workflows
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Contract Review</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a contract — Claude breaks it into sections and flags risk with a clause-by-clause heat map.
      </p>

      {/* Upload */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
        className="mt-6 rounded-2xl border-2 border-dashed border-line bg-white p-8 text-center"
      >
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-light/30 text-brand-dark"><ShieldAlert size={22} /></span>
        <p className="mt-3 text-sm font-semibold">Drop a contract here, or</p>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary mt-3">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Starting review…' : 'Choose file'}
        </button>
        <p className="mt-2 text-[11px] text-muted">PDF, image, or text · up to 15 MB</p>
      </div>

      {/* List */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Your reviews</h2>
      {loading ? (
        <div className="mt-3 grid gap-2"><SkeletonCard className="h-16" /><SkeletonCard className="h-16" /></div>
      ) : list.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No reviews yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <FileWarning size={16} className="shrink-0 text-muted" />
              <Link href={`/ai-workflows/contracts/${r.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold hover:underline">{r.title || 'Untitled contract'}</p>
                <p className="text-xs text-muted">
                  {r.status === 'done'
                    ? `${r.section_count} sections · ${new Date(r.created_at).toLocaleDateString()}`
                    : r.status_display}
                </p>
              </Link>
              {r.status === 'done' && r.overall_risk && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset ${RISK_TINT[r.overall_risk]}`}>
                  {r.overall_risk}
                </span>
              )}
              {r.status === 'processing' && <Loader2 size={14} className="animate-spin text-muted" />}
              <button onClick={() => del(r.id)} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-rose-600"><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Loader2, Plus, Send, Sparkles, X } from 'lucide-react';
import {
  precedents as precedentsApi, workflowDocuments, ApiError,
  type Precedent, type WorkflowDocumentItem,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { SkeletonCard } from '@/components/Skeleton';

export default function DocumentsPage() {
  const toast = useToast();
  const [docs, setDocs] = useState<WorkflowDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);

  async function reload() {
    const r = await workflowDocuments.list();
    setDocs(r.results);
  }

  useEffect(() => {
    (async () => {
      try { await reload(); } catch {}
      setLoading(false);
    })();
  }, []);

  async function del(d: WorkflowDocumentItem) {
    const ok = await toast.confirm({ title: 'Delete this document?', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await workflowDocuments.remove(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/ai-workflows" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
        <ArrowLeft size={12} /> Workflows
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="mt-1 text-sm text-muted">Draft from a precedent or from a saved AI output — edit, download, and send to a matter.</p>
        </div>
        <button onClick={() => setPicking(true)} className="btn-primary"><Plus size={15} /> New from precedent</button>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><SkeletonCard className="h-24" /><SkeletonCard className="h-24" /></div>
      ) : docs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-light/30 text-brand-dark"><FileText size={20} /></span>
          <h2 className="mt-3 text-base font-bold">No documents yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Start one from a precedent (e.g. <em>Answering Affidavit</em>) — fill a few details and we&rsquo;ll prepopulate it.</p>
          <button onClick={() => setPicking(true)} className="btn-primary mt-5"><Plus size={14} /> New from precedent</button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <FileText size={16} className="shrink-0 text-brand-dark" />
              <Link href={`/ai-workflows/documents/${d.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold hover:underline">{d.title}</p>
                <p className="text-xs text-muted">
                  {d.precedent_name || 'Document'} · updated {new Date(d.updated_at).toLocaleDateString()}
                  {d.sent_at && <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600"><Send size={10} /> sent</span>}
                </p>
              </Link>
              <Link href={`/ai-workflows/documents/${d.id}`} className="btn-outline text-xs">Open</Link>
              <button onClick={() => del(d)} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-rose-600"><X size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      {picking && <PrecedentPicker onClose={() => setPicking(false)} />}
    </div>
  );
}

function PrecedentPicker({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [list, setList] = useState<Precedent[]>([]);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<Precedent | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await precedentsApi.list(); setList(r.results); } catch {}
      setLoading(false);
    })();
  }, []);

  async function create() {
    if (!chosen) return;
    const missing = (chosen.variables || []).filter((v) => v.required && !values[v.key]?.trim());
    if (missing.length) {
      toast.error(`Fill required: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    setCreating(true);
    try {
      const doc = await workflowDocuments.create({ precedent: chosen.id, field_values: values });
      router.push(`/ai-workflows/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create document.');
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-lg font-bold">{chosen ? chosen.name : 'Choose a precedent'}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {!chosen ? (
            loading ? (
              <p className="text-sm text-muted">Loading precedents…</p>
            ) : (
              <ul className="space-y-2">
                {list.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => { setChosen(p); setValues({}); }} className="flex w-full items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:border-brand">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-light/25 text-brand-dark"><FileText size={15} /></span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block text-xs text-muted">{p.category} · {p.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted">Fill the details below — we&rsquo;ll prepopulate the document. You can edit everything afterwards.</p>
              {(chosen.variables || []).map((v) => (
                <div key={v.key}>
                  <label className="text-xs font-semibold text-muted">{v.label}{v.required && <span className="text-rose-500"> *</span>}</label>
                  {v.type === 'textarea' ? (
                    <textarea
                      value={values[v.key] || ''}
                      onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                      placeholder={v.help || ''}
                    />
                  ) : (
                    <input
                      value={values[v.key] || ''}
                      onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                      placeholder={v.help || ''}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
          {chosen ? (
            <>
              <button onClick={() => setChosen(null)} className="btn-outline text-sm">Back</button>
              <button onClick={create} disabled={creating} className="btn-primary">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {creating ? 'Preparing…' : 'Create document'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn-outline ml-auto text-sm">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

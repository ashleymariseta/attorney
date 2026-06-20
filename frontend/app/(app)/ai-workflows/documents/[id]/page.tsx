'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Check, Download, Eye, FileText, Loader2, Pencil, Printer, Save, Send,
} from 'lucide-react';
import {
  workflowDocuments, matters, ApiError,
  type WorkflowDocumentItem, type Matter,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { SkeletonCard } from '@/components/Skeleton';
import Markdown from '@/components/Markdown';

type Tab = 'edit' | 'preview';

export default function DocumentEditorPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const toast = useToast();
  const router = useRouter();
  const [doc, setDoc] = useState<WorkflowDocumentItem | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<Tab>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await workflowDocuments.get(id);
        setDoc(d);
        setTitle(d.title);
        setBody(d.body);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Document not found.');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      const d = await workflowDocuments.update(id, { title: title.trim() || 'Untitled document', body });
      setDoc(d);
      setDirty(false);
      toast.success('Saved.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  function downloadMd() {
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'document').replace(/[^\w.-]+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    const html = printRef.current?.innerHTML ?? '';
    const w = window.open('', '_blank', 'width=820,height=1060');
    if (!w) {
      toast.error('Allow pop-ups to print/save as PDF.');
      return;
    }
    w.document.write(`<!doctype html><html><head><title>${title}</title>
      <style>
        @page { margin: 25mm 20mm; }
        body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.55; color:#111; }
        h1 { text-align:center; text-transform:uppercase; font-size:14pt; }
        h2 { text-transform:uppercase; font-size:12.5pt; }
        table { border-collapse: collapse; width:100%; }
        th,td { border:1px solid #999; padding:6px; }
        hr { border:none; border-top:1px solid #ccc; margin:18px 0; }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6"><SkeletonCard className="h-64" /></div>;
  }
  if (!doc) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12 text-center">
        <h1 className="text-xl font-bold">Document not found</h1>
        <Link href="/ai-workflows/documents" className="mt-4 inline-flex btn-primary">Back to documents</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/ai-workflows/documents" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
        <ArrowLeft size={12} /> Documents
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent text-2xl font-bold outline-none hover:border-line focus:border-brand focus:bg-white px-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadMd} className="btn-outline text-xs"><Download size={13} /> .md</button>
          <button onClick={printPdf} className="btn-outline text-xs"><Printer size={13} /> Print / PDF</button>
          <button onClick={() => setSendOpen(true)} className="btn-outline text-xs"><Send size={13} /> Send to matter</button>
          <button onClick={save} disabled={saving || !dirty} className="btn-primary text-xs">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">
        {doc.precedent_name ? `From precedent “${doc.precedent_name}”` : 'Document'}
        {doc.sent_at ? ` · sent to matter ${new Date(doc.sent_at).toLocaleDateString()}` : ''}
      </p>

      {/* Tabs */}
      <div className="mt-4 inline-flex rounded-lg border border-line bg-white p-0.5 text-xs font-semibold">
        <button onClick={() => setTab('edit')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === 'edit' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
          <Pencil size={12} /> Edit
        </button>
        <button onClick={() => setTab('preview')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === 'preview' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
          <Eye size={12} /> Preview
        </button>
      </div>

      <div className="mt-3">
        {tab === 'edit' ? (
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            spellCheck
            className="min-h-[60vh] w-full rounded-xl border border-line bg-white p-4 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-brand"
            placeholder="Write your document in Markdown…"
          />
        ) : (
          <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
            <Markdown>{body || '_Nothing to preview yet._'}</Markdown>
          </div>
        )}
      </div>

      {/* Offscreen render used for Print/PDF */}
      <div ref={printRef} className="pointer-events-none absolute -left-[9999px] top-0" aria-hidden>
        <Markdown>{body}</Markdown>
      </div>

      {sendOpen && (
        <SendToMatterModal docId={id} onClose={() => setSendOpen(false)} onSent={(d) => { setDoc(d); setSendOpen(false); toast.success('Sent to the matter.', { major: true }); }} />
      )}
    </div>
  );
}

function SendToMatterModal({ docId, onClose, onSent }: { docId: number; onClose: () => void; onSent: (d: WorkflowDocumentItem) => void }) {
  const toast = useToast();
  const [list, setList] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await matters.list();
        setList(r.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function send() {
    if (!sel) return;
    setBusy(true);
    try {
      const d = await workflowDocuments.sendToMatter(docId, sel);
      onSent(d);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Send to matter</h3>
        <p className="mt-0.5 text-sm text-muted">Adds this document as a draft in the matter room.</p>
        <div className="mt-4 max-h-72 space-y-1 overflow-auto">
          {loading ? (
            <p className="text-sm text-muted">Loading matters…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted">You have no matters.</p>
          ) : (
            list.map((m) => (
              <button
                key={m.id}
                onClick={() => setSel(m.id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${sel === m.id ? 'border-brand bg-brand-light/20' : 'border-line hover:border-brand'}`}
              >
                <FileText size={14} className="text-brand-dark" />
                <span className="flex-1 truncate">{m.title}</span>
                {sel === m.id && <Check size={14} className="text-brand-dark" />}
              </button>
            ))
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-outline">Cancel</button>
          <button onClick={send} disabled={busy || !sel} className="btn-primary">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

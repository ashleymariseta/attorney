'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, Download, Loader2, Pencil, Plus, Save, Send, Trash2, X,
} from 'lucide-react';
import {
  contractReviews, matters, ApiError,
  type ContractReview, type ContractResult, type ContractSection, type ContractIssue,
  type Matter, type RiskLevel,
} from '@/lib/api';
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
const RISK_HEX: Record<RiskLevel, string> = { high: '#e11d48', medium: '#f59e0b', low: '#10b981' };
const RISKS: RiskLevel[] = ['high', 'medium', 'low'];

function emptySection(): ContractSection {
  return { heading: 'New section', risk: 'low', summary: '', excerpt: '', issues: [] };
}
function emptyIssue(): ContractIssue {
  return { severity: 'medium', issue: '', recommendation: '' };
}

export default function ContractReviewPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const toast = useToast();
  const [review, setReview] = useState<ContractReview | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit state — a working copy of the report the lawyer can curate.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ title: string; result: ContractResult } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

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

  const savedResult = (review.result && 'sections' in review.result) ? (review.result as ContractResult) : null;
  // What we render: the draft while editing, otherwise the saved report.
  const view = editing && draft ? draft.result : savedResult;
  const sections = view?.sections ?? [];
  const counts = { high: 0, medium: 0, low: 0 } as Record<RiskLevel, number>;
  sections.forEach((s) => { counts[s.risk] = (counts[s.risk] ?? 0) + 1; });

  function startEdit() {
    if (!savedResult) return;
    setDraft({ title: review!.title || '', result: JSON.parse(JSON.stringify(savedResult)) });
    setDirty(false);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setDirty(false);
  }
  function mutate(fn: (r: ContractResult) => void) {
    setDraft((d) => {
      if (!d) return d;
      const next = JSON.parse(JSON.stringify(d.result)) as ContractResult;
      fn(next);
      return { ...d, result: next };
    });
    setDirty(true);
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await contractReviews.update(id, { title: draft.title.trim(), result: draft.result });
      setReview(r);
      setEditing(false);
      setDraft(null);
      setDirty(false);
      toast.success('Report saved.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the report.');
    } finally {
      setSaving(false);
    }
  }

  function downloadPdf() {
    if (!view) return;
    const html = reportHtml(editing && draft ? draft.title : review!.title, view);
    const w = window.open('', '_blank', 'width=860,height=1100');
    if (!w) { toast.error('Allow pop-ups to download / print the report.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  const titleText = (editing && draft ? draft.title : review.title) || view?.title || 'Contract review';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/ai-workflows/contracts" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
        <ArrowLeft size={12} /> Contract Review
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        {editing && draft ? (
          <input
            value={draft.title}
            onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }}
            placeholder="Report title"
            className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-2xl font-bold outline-none focus:border-brand"
          />
        ) : (
          <h1 className="min-w-0 flex-1 text-2xl font-bold">{titleText}</h1>
        )}

        {review.status === 'done' && savedResult && (
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button onClick={cancelEdit} disabled={saving} className="btn-outline text-xs">Cancel</button>
                <button onClick={save} disabled={saving || !dirty} className="btn-primary text-xs">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                </button>
              </>
            ) : (
              <>
                <button onClick={startEdit} className="btn-outline text-xs"><Pencil size={13} /> Edit</button>
                <button onClick={downloadPdf} className="btn-outline text-xs"><Download size={13} /> Download PDF</button>
                <button onClick={() => setSendOpen(true)} className="btn-outline text-xs"><Send size={13} /> Send to matter</button>
              </>
            )}
          </div>
        )}
      </div>

      {!editing && review.sent_at && (
        <p className="mt-1 text-xs text-emerald-600"><Check size={12} className="mr-0.5 inline" /> Sent to a matter {new Date(review.sent_at).toLocaleDateString()}</p>
      )}

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

      {review.status === 'done' && view && (
        <>
          {/* Overview */}
          <div className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {editing && draft ? (
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted">
                  Overall risk
                  <select
                    value={view.overall_risk}
                    onChange={(e) => mutate((r) => { r.overall_risk = e.target.value as RiskLevel; })}
                    className="rounded-lg border border-line px-2 py-1 text-xs font-bold uppercase"
                  >
                    {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              ) : (
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ring-1 ring-inset ${RISK_BADGE[view.overall_risk]}`}>
                  {view.overall_risk} risk
                </span>
              )}
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.high}`} /> {counts.high} high</span>
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.medium}`} /> {counts.medium} medium</span>
                <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT.low}`} /> {counts.low} low</span>
              </div>
            </div>

            {editing && draft ? (
              <>
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">Parties (comma-separated)</label>
                <input
                  value={(view.parties || []).join(', ')}
                  onChange={(e) => mutate((r) => { r.parties = e.target.value.split(',').map((p) => p.trim()).filter(Boolean); })}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">Summary</label>
                <textarea
                  value={view.summary}
                  onChange={(e) => mutate((r) => { r.summary = e.target.value; })}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </>
            ) : (
              <>
                {view.parties?.length > 0 && (
                  <p className="mt-3 text-xs text-muted"><span className="font-semibold">Parties:</span> {view.parties.join(' · ')}</p>
                )}
                <div className="mt-2"><Markdown size="sm">{view.summary}</Markdown></div>
              </>
            )}

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
            {sections.map((s, i) => (
              editing && draft ? (
                <SectionEditor
                  key={i}
                  idx={i}
                  section={s}
                  onChange={(patch) => mutate((r) => { r.sections[i] = { ...r.sections[i], ...patch }; })}
                  onDelete={() => mutate((r) => { r.sections.splice(i, 1); })}
                  onAddIssue={() => mutate((r) => { r.sections[i].issues.push(emptyIssue()); })}
                  onChangeIssue={(j, patch) => mutate((r) => { r.sections[i].issues[j] = { ...r.sections[i].issues[j], ...patch }; })}
                  onDeleteIssue={(j) => mutate((r) => { r.sections[i].issues.splice(j, 1); })}
                />
              ) : (
                <SectionCard key={i} idx={i} section={s} />
              )
            ))}
            {editing && draft && (
              <button
                onClick={() => mutate((r) => { r.sections.push(emptySection()); })}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-sm font-semibold text-muted hover:border-brand hover:text-brand-dark"
              >
                <Plus size={15} /> Add section
              </button>
            )}
          </div>

          <p className="mt-6 text-[11px] text-muted">
            AI-generated analysis — not legal advice. Review against the contract text before relying on it.
          </p>
        </>
      )}

      {sendOpen && (
        <SendToMatterModal
          reviewId={id}
          onClose={() => setSendOpen(false)}
          onSent={(r) => { setReview(r); setSendOpen(false); toast.success('Report sent to the matter.', { major: true }); }}
        />
      )}
    </div>
  );
}

/* ---------------- read-only section (view mode) ---------------- */

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

/* ---------------- editable section (edit mode) ---------------- */

function SectionEditor({
  idx, section, onChange, onDelete, onAddIssue, onChangeIssue, onDeleteIssue,
}: {
  idx: number;
  section: ContractSection;
  onChange: (patch: Partial<ContractSection>) => void;
  onDelete: () => void;
  onAddIssue: () => void;
  onChangeIssue: (j: number, patch: Partial<ContractIssue>) => void;
  onDeleteIssue: (j: number) => void;
}) {
  return (
    <div id={`sec-${idx}`} className={`rounded-xl border border-line border-l-4 bg-white p-4 shadow-sm ${RISK_BORDER[section.risk]}`}>
      <div className="flex items-center gap-2">
        <select
          value={section.risk}
          onChange={(e) => onChange({ risk: e.target.value as RiskLevel })}
          className="rounded-lg border border-line px-2 py-1.5 text-xs font-bold uppercase"
        >
          {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input
          value={section.heading}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="Section heading"
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm font-semibold"
        />
        <button onClick={onDelete} title="Delete section" className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={15} />
        </button>
      </div>

      <textarea
        value={section.summary}
        onChange={(e) => onChange({ summary: e.target.value })}
        rows={2}
        placeholder="Summary"
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
      />
      <textarea
        value={section.excerpt}
        onChange={(e) => onChange({ excerpt: e.target.value })}
        rows={2}
        placeholder="Contract excerpt (optional)"
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-xs italic"
      />

      <div className="mt-3 space-y-2">
        {section.issues.map((it, j) => (
          <div key={j} className="rounded-lg bg-canvas/50 p-3 ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2">
              <select
                value={it.severity}
                onChange={(e) => onChangeIssue(j, { severity: e.target.value as RiskLevel })}
                className="rounded-lg border border-line px-2 py-1 text-[10px] font-bold uppercase"
              >
                {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                value={it.issue}
                onChange={(e) => onChangeIssue(j, { issue: e.target.value })}
                placeholder="Issue"
                className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-sm"
              />
              <button onClick={() => onDeleteIssue(j)} title="Delete issue" className="rounded p-1 text-muted hover:bg-rose-50 hover:text-rose-600">
                <X size={14} />
              </button>
            </div>
            <textarea
              value={it.recommendation}
              onChange={(e) => onChangeIssue(j, { recommendation: e.target.value })}
              rows={2}
              placeholder="Recommended fix"
              className="mt-1.5 w-full rounded-lg border border-line px-2 py-1.5 text-xs"
            />
          </div>
        ))}
        <button onClick={onAddIssue} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-dark hover:underline">
          <Plus size={13} /> Add issue
        </button>
      </div>
    </div>
  );
}

/* ---------------- send to matter ---------------- */

function SendToMatterModal({ reviewId, onClose, onSent }: { reviewId: number; onClose: () => void; onSent: (r: ContractReview) => void }) {
  const toast = useToast();
  const [list, setList] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await matters.list(); setList(r.results); } catch {}
      setLoading(false);
    })();
  }, []);

  async function send() {
    if (!sel) return;
    setBusy(true);
    try {
      const r = await contractReviews.sendToMatter(reviewId, sel);
      onSent(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Send report to matter</h3>
        <p className="mt-0.5 text-sm text-muted">Adds the report as a draft document in the matter room.</p>
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

/* ---------------- printable HTML (Download PDF) ---------------- */

function reportHtml(title: string, result: ContractResult): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const sections = result.sections || [];
  const counts = { high: 0, medium: 0, low: 0 } as Record<RiskLevel, number>;
  sections.forEach((s) => { counts[s.risk] = (counts[s.risk] ?? 0) + 1; });

  const heat = sections
    .map((s) => `<span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${RISK_HEX[s.risk]};margin:2px;"></span>`)
    .join('');

  const sectionHtml = sections.map((s) => {
    const issues = (s.issues || []).map((it) => `
      <li style="margin:6px 0;">
        <span style="display:inline-block;font-size:9pt;font-weight:bold;text-transform:uppercase;color:#fff;background:${RISK_HEX[it.severity]};border-radius:8px;padding:1px 7px;">${esc(it.severity)}</span>
        <span style="font-weight:600;"> ${esc(it.issue)}</span>
        ${it.recommendation ? `<div style="font-size:10pt;color:#444;margin-top:2px;"><em>Fix:</em> ${esc(it.recommendation)}</div>` : ''}
      </li>`).join('');
    return `
      <div style="border-left:4px solid ${RISK_HEX[s.risk]};padding:8px 0 8px 12px;margin:16px 0;page-break-inside:avoid;">
        <h2 style="font-size:12.5pt;margin:0;">${esc(s.heading)}
          <span style="font-size:9pt;font-weight:bold;text-transform:uppercase;color:${RISK_HEX[s.risk]};"> · ${esc(s.risk)} risk</span>
        </h2>
        ${s.summary ? `<p style="margin:4px 0;">${esc(s.summary)}</p>` : ''}
        ${s.excerpt ? `<blockquote style="border-left:2px solid #ccc;margin:6px 0;padding-left:10px;color:#555;font-style:italic;">${esc(s.excerpt)}</blockquote>` : ''}
        ${issues ? `<ul style="margin:6px 0;padding-left:18px;">${issues}</ul>` : '<p style="color:#10b981;font-size:10pt;">No issues flagged.</p>'}
      </div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || result.title || 'Contract review')}</title>
    <style>
      @page { margin: 20mm 18mm; }
      body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.5; color:#111; }
      h1 { font-size: 17pt; margin: 0 0 4px; }
      .meta { color:#444; font-size:10pt; margin: 2px 0 10px; }
      .pill { display:inline-block;font-weight:bold;text-transform:uppercase;color:#fff;border-radius:10px;padding:2px 9px;font-size:10pt; }
    </style></head><body>
    <h1>${esc(title || result.title || 'Contract review')}</h1>
    <div class="meta">
      <span class="pill" style="background:${RISK_HEX[result.overall_risk] || '#999'}">${esc(result.overall_risk)} risk</span>
      &nbsp; ${counts.high} high · ${counts.medium} medium · ${counts.low} low
    </div>
    ${result.parties?.length ? `<div class="meta"><strong>Parties:</strong> ${esc(result.parties.join(' · '))}</div>` : ''}
    <div style="margin:6px 0 2px;font-size:9pt;font-weight:bold;text-transform:uppercase;color:#666;">Heat map</div>
    <div>${heat}</div>
    ${result.summary ? `<p style="margin-top:10px;">${esc(result.summary)}</p>` : ''}
    ${sectionHtml}
    <hr style="border:none;border-top:1px solid #ccc;margin:18px 0;">
    <p style="font-size:9pt;color:#777;">AI-generated analysis, reviewed by counsel — not a substitute for full legal review.</p>
    </body></html>`;
}

'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Eye, FileText, Loader2, Pencil, Plus, Save, Sparkles, Wand2, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  precedents as precedentsApi, workflowDocuments, ApiError,
  type Precedent, type PrecedentVariable,
} from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import Markdown from '@/components/Markdown';

/** Pull every `{{key}}` placeholder out of a precedent body, in order. */
function placeholderKeys(body: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Turn a snake_case key into a readable label ("case_number" → "Case number"). */
function humanize(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Keep the variable list in step with the body: every `{{key}}` gets a field,
 *  existing metadata (label/help/required) is preserved, orphans are dropped. */
function syncVariables(body: string, existing: PrecedentVariable[]): PrecedentVariable[] {
  const byKey = new Map(existing.map((v) => [v.key, v]));
  return placeholderKeys(body).map(
    (key) => byKey.get(key) ?? { key, label: humanize(key), required: true, type: 'text' as const },
  );
}

export default function TemplatesPrecedentsPage() {
  const toast = useToast();
  const [list, setList] = useState<Precedent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState<Precedent | null>(null);
  const [editing, setEditing] = useState<Precedent | null>(null);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await precedentsApi.list();
        setList(r.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  function onSaved(updated: Precedent) {
    setList((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditing(null);
    toast.success('Saved to the template — all new documents will use it.', { major: true });
  }

  function onCreated(created: Precedent) {
    setList((prev) => [created, ...prev]);
    setDrafting(false);
    toast.success(`“${created.name}” saved to your templates.`, { major: true });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/ai-workflows"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
      >
        <ArrowLeft size={12} /> Workflows
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Templates / Precedents</h1>
          <p className="mt-1 text-sm text-muted">
            Agreed formats for your common documents. Fill the placeholders to turn one into a document — or edit the
            format itself and save it back so every new document uses your version.
          </p>
        </div>
        <button onClick={() => setDrafting(true)} className="btn-primary shrink-0">
          <Plus size={15} /> New with AI
        </button>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <SkeletonCard className="h-44" />
          <SkeletonCard className="h-44" />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-light/30 text-brand-dark">
            <FileText size={20} />
          </span>
          <h2 className="mt-3 text-base font-bold">No precedents yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">Your firm&rsquo;s agreed formats will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {list.map((p) => (
            <li key={p.id} className="card flex flex-col">
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
                  <FileText size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{p.name}</h3>
                  <p className="text-[11px] uppercase tracking-wide text-muted">{p.category || p.matter_type || '—'}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink/80">{p.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(p.variables ?? []).slice(0, 8).map((v) => (
                  <span key={v.key} className="badge-muted text-[10px]">{v.label}</span>
                ))}
                {(p.variables?.length ?? 0) > 8 && (
                  <span className="badge-muted text-[10px]">+{(p.variables!.length - 8)} more</span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  onClick={() => setEditing(p)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand"
                >
                  <Pencil size={14} /> Edit template
                </button>
                <button
                  onClick={() => setFilling(p)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand"
                >
                  <Wand2 size={14} /> Fill &amp; create
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {filling && <FillModal precedent={filling} onClose={() => setFilling(null)} />}
      {editing && <EditTemplateModal precedentId={editing.id} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {drafting && <NewWithAIModal onClose={() => setDrafting(false)} onCreated={onCreated} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Fill placeholders → create a document                                       */
/* -------------------------------------------------------------------------- */

function FillModal({ precedent, onClose }: { precedent: Precedent; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  async function create() {
    const missing = (precedent.variables || []).filter((v) => v.required && !values[v.key]?.trim());
    if (missing.length) {
      toast.error(`Fill required: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    setCreating(true);
    try {
      const doc = await workflowDocuments.create({ precedent: precedent.id, field_values: values });
      router.push(`/ai-workflows/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create document.');
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !creating && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">{precedent.name}</h3>
            <p className="mt-0.5 text-xs text-muted">Fill the placeholders — you can edit everything afterwards.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
          {(precedent.variables || []).length === 0 ? (
            <p className="text-sm text-muted">This template has no placeholders — it&rsquo;ll be created as-is.</p>
          ) : (
            (precedent.variables || []).map((v) => (
              <div key={v.key}>
                <label className="text-xs font-semibold text-muted">
                  {v.label}{v.required && <span className="text-rose-500"> *</span>}
                </label>
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
                    type={v.type === 'date' ? 'date' : 'text'}
                    value={values[v.key] || ''}
                    onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    placeholder={v.help || ''}
                  />
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button onClick={onClose} disabled={creating} className="btn-outline text-sm">Cancel</button>
          <button onClick={create} disabled={creating} className="btn-primary">
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {creating ? 'Creating…' : 'Convert to document'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit the agreed format and save it back to the template                     */
/* -------------------------------------------------------------------------- */

function EditTemplateModal({
  precedentId, onClose, onSaved,
}: { precedentId: number; onClose: () => void; onSaved: (p: Precedent) => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [original, setOriginal] = useState<Precedent | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await precedentsApi.get(precedentId);
        setOriginal(p);
        setName(p.name);
        setDescription(p.description);
        setBody(p.body || '');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not load template.');
        onClose();
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precedentId]);

  const detectedKeys = useMemo(() => placeholderKeys(body), [body]);

  async function save() {
    if (!original) return;
    setSaving(true);
    try {
      const variables = syncVariables(body, original.variables || []);
      const updated = await precedentsApi.update(precedentId, {
        name: name.trim() || original.name,
        description: description.trim(),
        body,
        variables,
      });
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-lg font-bold">Edit template</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="px-5 py-8"><SkeletonCard className="h-64" /></div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
              <div>
                <label className="text-xs font-semibold text-muted">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted">Format (Markdown)</label>
                <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-xs font-semibold">
                  <button onClick={() => setTab('edit')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${tab === 'edit' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
                    <Pencil size={11} /> Edit
                  </button>
                  <button onClick={() => setTab('preview')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${tab === 'preview' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
                    <Eye size={11} /> Preview
                  </button>
                </div>
              </div>

              {tab === 'edit' ? (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                  rows={16}
                  className="w-full resize-y rounded-lg border border-line px-3 py-2 font-mono text-[13px] leading-relaxed"
                  placeholder="Type the agreed format. Use {{placeholders}} for the gaps to fill in."
                />
              ) : (
                <div className="rounded-lg border border-line bg-white px-6 py-6">
                  <Markdown className="font-serif">{body || '_Nothing to preview yet._'}</Markdown>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted">
                  Placeholders detected ({detectedKeys.length})
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {detectedKeys.length === 0 ? (
                    <span className="text-xs text-muted">None yet — wrap a gap in <code>{'{{double braces}}'}</code>.</span>
                  ) : (
                    detectedKeys.map((k) => <span key={k} className="badge-muted text-[10px]">{humanize(k)}</span>)
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
              <p className="text-xs text-muted">Saving updates the agreed format for every new document.</p>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={saving} className="btn-outline text-sm">Cancel</button>
                <button onClick={save} disabled={saving} className="btn-primary">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'Saving…' : 'Save to template'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Describe a template → AI drafts it → review/edit → save for reuse           */
/* -------------------------------------------------------------------------- */

function NewWithAIModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Precedent) => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<'describe' | 'review'>('describe');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  // Draft under review.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [matterType, setMatterType] = useState('');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);

  const detectedKeys = useMemo(() => placeholderKeys(body), [body]);
  const busy = generating || saving;

  async function generate() {
    if (!instructions.trim()) return;
    setGenerating(true);
    try {
      const draft = await precedentsApi.generate(instructions.trim());
      setName(draft.name);
      setDescription(draft.description);
      setCategory(draft.category);
      setMatterType(draft.matter_type);
      setBody(draft.body);
      setPhase('review');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not draft the template.');
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const created = await precedentsApi.create({
        name: name.trim() || 'Untitled template',
        description: description.trim(),
        category: category.trim(),
        matter_type: matterType.trim(),
        body,
        variables: syncVariables(body, []),
      });
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the template.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">New template with AI</h3>
            <p className="mt-0.5 text-xs text-muted">
              {phase === 'describe'
                ? 'Describe the legal document you need — the AI drafts a reusable format.'
                : 'Review and tweak the draft, then save it to your templates.'}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>

        {phase === 'describe' ? (
          <>
            <div className="flex-1 overflow-auto px-5 py-4">
              <label className="text-xs font-semibold text-muted">What do you need drafted?</label>
              <textarea
                autoFocus
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="e.g. A lease agreement for residential property in Harare, with parties, rent, deposit, duration, and standard termination clauses. Leave gaps for the case-specific details."
              />
              <p className="mt-2 text-xs text-muted">
                Be specific about the document type, parties, and the gaps that should be fillable.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
              <button onClick={onClose} disabled={busy} className="btn-outline text-sm">Cancel</button>
              <button onClick={generate} disabled={busy || !instructions.trim()} className="btn-primary">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generating ? 'Drafting…' : 'Draft template'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-muted">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted">Category</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="e.g. Agreements" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted">Format (Markdown)</label>
                <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-xs font-semibold">
                  <button onClick={() => setTab('edit')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${tab === 'edit' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
                    <Pencil size={11} /> Edit
                  </button>
                  <button onClick={() => setTab('preview')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${tab === 'preview' ? 'bg-brand-dark text-white' : 'text-muted'}`}>
                    <Eye size={11} /> Preview
                  </button>
                </div>
              </div>

              {tab === 'edit' ? (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                  rows={16}
                  className="w-full resize-y rounded-lg border border-line px-3 py-2 font-mono text-[13px] leading-relaxed"
                  placeholder="The drafted format will appear here. Use {{placeholders}} for the gaps to fill in."
                />
              ) : (
                <div className="rounded-lg border border-line bg-white px-6 py-6">
                  <Markdown className="font-serif">{body || '_Nothing to preview yet._'}</Markdown>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted">Placeholders detected ({detectedKeys.length})</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {detectedKeys.length === 0 ? (
                    <span className="text-xs text-muted">None — wrap a gap in <code>{'{{double braces}}'}</code>.</span>
                  ) : (
                    detectedKeys.map((k) => <span key={k} className="badge-muted text-[10px]">{humanize(k)}</span>)
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
              <button onClick={() => setPhase('describe')} disabled={busy} className="btn-outline text-sm">Back</button>
              <button onClick={save} disabled={busy || !body.trim()} className="btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save to templates'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

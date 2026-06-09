'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  llmProviders,
  ApiError,
  type LlmProviderConfig,
  type LlmProviderId,
  type LlmProviderSupport,
} from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

const ICON: Record<LlmProviderId, React.ReactNode> = {
  anthropic: <Sparkles size={16} />,
  openai: <Sparkles size={16} />,
  local: <Server size={16} />,
};

export default function ProvidersPage() {
  const toast = useToast();
  const [supported, setSupported] = useState<LlmProviderSupport[]>([]);
  const [configs, setConfigs] = useState<LlmProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LlmProviderConfig | null>(null);
  const [adding, setAdding] = useState<LlmProviderSupport | null>(null);

  async function reload() {
    const [sup, list] = await Promise.all([llmProviders.supported(), llmProviders.list()]);
    setSupported(sup);
    setConfigs(list.results);
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function remove(c: LlmProviderConfig) {
    if (!confirm(`Delete the ${c.provider_display} configuration?`)) return;
    try {
      await llmProviders.remove(c.id);
      await reload();
      toast.success('Provider removed.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/ai-workflows"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
      >
        <ArrowLeft size={12} /> Workflows
      </Link>
      <h1 className="mt-3 text-2xl font-bold">LLM Providers</h1>
      <p className="mt-1 text-sm text-muted">
        Plug in the providers you want to use per stage. Keys are only sent to the providers&rsquo; APIs — never to us.
      </p>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-brand-light/30 bg-brand-light/10 p-4 text-sm">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-dark" />
        <p className="text-brand-dark/90">
          Use no-training API tiers only. Privileged matter must never route through consumer endpoints.
        </p>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <SkeletonCard className="h-32" />
          <SkeletonCard className="h-32" />
        </div>
      ) : (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Your providers</h2>
          {configs.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
              No providers yet. Add one below to enable stage runs.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {configs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
                    {ICON[c.provider]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-semibold">
                      {c.label || c.provider_display}
                      {c.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <CheckCircle2 size={10} /> default
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {c.provider_display}
                      {c.default_model && ` · ${c.default_model}`}
                      {c.has_api_key && ' · key saved'}
                      {c.base_url && ` · ${c.base_url}`}
                    </p>
                  </div>
                  <button onClick={() => setEditing(c)} className="btn-light">Edit</button>
                  <button onClick={() => remove(c)} aria-label="Delete" className="rounded-md p-2 text-muted hover:bg-canvas hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Add a provider</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {supported.map((s) => (
              <button
                key={s.value}
                onClick={() => setAdding(s)}
                className="flex flex-col items-start gap-2 rounded-xl border border-line bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
                  {ICON[s.value]}
                </span>
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="text-[11px] text-muted">
                  {s.needs_api_key ? 'API key' : 'No key'}{s.needs_base_url ? ' · custom URL' : ''}
                </p>
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-dark">
                  <Plus size={11} /> Configure
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {(adding || editing) && (
        <ProviderModal
          support={adding}
          editing={editing}
          allSupport={supported}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={async () => { await reload(); setAdding(null); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ProviderModal({
  support,
  editing,
  allSupport,
  onClose,
  onSaved,
}: {
  support: LlmProviderSupport | null;
  editing: LlmProviderConfig | null;
  allSupport: LlmProviderSupport[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const cfgSupport = editing
    ? allSupport.find((s) => s.value === editing.provider) ?? support ?? allSupport[0]
    : (support as LlmProviderSupport);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(editing?.base_url ?? '');
  const [defaultModel, setDefaultModel] = useState(editing?.default_model ?? cfgSupport.default_model);
  const [isDefault, setIsDefault] = useState(editing?.is_default ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const payload: Parameters<typeof llmProviders.create>[0] = {
        provider: cfgSupport.value,
        label,
        base_url: baseUrl,
        default_model: defaultModel,
        is_default: isDefault,
      };
      if (apiKey) payload.api_key = apiKey;
      if (editing) {
        await llmProviders.update(editing.id, payload);
      } else {
        await llmProviders.create(payload);
      }
      toast.success(`Saved ${cfgSupport.label} configuration.`, { major: true });
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">{editing ? 'Edit' : 'Add'} {cfgSupport.label}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-5">
          <div>
            <label className="label">Label (optional)</label>
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Firm Anthropic key" />
          </div>
          {cfgSupport.needs_api_key && (
            <div>
              <label className="label">API key {editing?.has_api_key && <span className="text-muted">(leave blank to keep current)</span>}</label>
              <input
                className="field font-mono"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.has_api_key ? '••••••••' : 'sk-…'}
              />
            </div>
          )}
          {cfgSupport.needs_base_url && (
            <div>
              <label className="label">Base URL</label>
              <input className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
              <p className="mt-1 text-[11px] text-muted">Ollama, vLLM, or any OpenAI-compatible chat endpoint.</p>
            </div>
          )}
          <div>
            <label className="label">Default model</label>
            <input className="field" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder={cfgSupport.default_model} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#0f766e]" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Use as default for this provider
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-brand">Cancel</button>
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
          >
            <KeyRound size={14} /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

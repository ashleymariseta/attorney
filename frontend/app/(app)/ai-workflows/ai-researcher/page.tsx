'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  BookText,
  ExternalLink,
  History,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  coResearcher,
  ApiError,
  type CorpusCollectionItem,
  type CorpusKind,
  type ResearchQueryData,
} from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

const KIND_ORDER: CorpusKind[] = ['case', 'judgement', 'rules', 'constitution', 'statute'];
const KIND_LABEL: Record<CorpusKind, string> = {
  case: 'Cases',
  judgement: 'Judgements',
  rules: 'High Court Rules',
  constitution: 'Constitution',
  statute: 'Statutes',
};

export default function CoResearcherPage() {
  const toast = useToast();
  const [collections, setCollections] = useState<CorpusCollectionItem[]>([]);
  const [history, setHistory] = useState<ResearchQueryData[]>([]);
  const [loading, setLoading] = useState(true);

  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<CorpusKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<ResearchQueryData | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, h] = await Promise.all([coResearcher.collections(), coResearcher.history()]);
        setCollections(c.results);
        setHistory(h.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const kindsWithCorpus = useMemo(() => {
    const set = new Set(collections.map((c) => c.kind));
    return KIND_ORDER.filter((k) => set.has(k));
  }, [collections]);

  function toggleScope(k: CorpusKind) {
    setScope((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setCurrent(null);
    try {
      const res = await coResearcher.ask({ question: question.trim(), scope });
      setCurrent(res);
      setHistory((prev) => [res, ...prev]);
      setTimeout(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      if (!res.answer_text && !res.citations.length) {
        toast.info('No matching authorities — try widening the scope.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'AI-Researcher request failed.');
    } finally {
      setBusy(false);
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
      <div className="mt-3 flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-dark text-white">
          <BookText size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-bold">AI-Researcher</h1>
          <p className="mt-1 text-sm text-muted">
            Ask the grounded legal corpus. Every answer cites the chunks supplied to the model — anything not in the corpus is flagged as such.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-brand-light/30 bg-brand-light/10 p-4 text-sm">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-dark" />
        <p className="text-brand-dark/90">
          Answers are drawn from the supplied authorities below — never from the model&rsquo;s memory.
          Verify every citation before relying on it.
        </p>
      </div>

      <form onSubmit={ask} className="mt-6 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <label className="label">Your question</label>
        <textarea
          className="field"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What are the requirements for the mandament van spolie under Zimbabwean law?"
          required
        />

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Scope</p>
          {loading ? (
            <div className="flex gap-2">
              <SkeletonCard className="h-8 w-24" />
              <SkeletonCard className="h-8 w-24" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Chip active={scope.length === 0} onClick={() => setScope([])}>All sources</Chip>
              {kindsWithCorpus.map((k) => (
                <Chip key={k} active={scope.includes(k)} onClick={() => toggleScope(k)}>
                  {KIND_LABEL[k]}
                </Chip>
              ))}
              {kindsWithCorpus.length === 0 && (
                <p className="text-xs text-muted">No corpus seeded yet — run <code className="font-mono">manage.py seed_corpus</code>.</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-muted">
            Uses your default LLM provider. Configure one in{' '}
            <Link href="/ai-workflows/providers" className="font-semibold text-brand-dark hover:underline">Providers</Link>.
          </p>
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Researching…' : 'Ask'}
          </button>
        </div>
      </form>

      {current && (
        <div ref={answerRef} className="mt-8 space-y-4">
          <AnswerPanel q={current} />
          {current.citations.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Authorities supplied to the model</p>
              <ul className="space-y-2">
                {current.citations.map((c) => (
                  <li key={c.id} className="rounded-xl border border-line bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-brand-light/30 px-2 py-0.5 font-semibold text-brand-dark">[#{c.rank + 1}]</span>
                      <span className="rounded-full bg-canvas px-2 py-0.5 font-semibold uppercase tracking-wide text-muted">
                        {c.document.kind_display}
                      </span>
                      <span className="truncate font-semibold text-ink">{c.document.title}</span>
                      {c.document.year && <span className="text-muted">· {c.document.year}</span>}
                      {c.document.source_url && (
                        <a href={c.document.source_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">
                          <ExternalLink size={11} /> Source
                        </a>
                      )}
                    </div>
                    {c.document.citation && <p className="mt-1 text-xs text-muted">{c.document.citation}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink/85">{c.excerpt}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-10">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <History size={12} /> Recent
          </p>
          <ul className="space-y-2">
            {history.slice(0, 6).map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => {
                    setCurrent(h);
                    setQuestion(h.question);
                    setScope(h.scope ?? []);
                    setTimeout(() => answerRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                  }}
                  className="block w-full rounded-xl border border-line bg-white p-3 text-left transition hover:border-brand hover:shadow-sm"
                >
                  <p className="line-clamp-2 text-sm font-semibold text-ink">{h.question}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {new Date(h.created_at).toLocaleString()} · {h.citations.length} citation{h.citations.length === 1 ? '' : 's'} · {h.provider || '—'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AnswerPanel({ q }: { q: ResearchQueryData }) {
  return (
    <div className="rounded-2xl border border-brand-light/30 bg-gradient-to-br from-brand-light/10 via-white to-white p-5 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
        <Sparkles size={11} /> Answer
        {q.provider && <span className="text-muted">· {q.provider}{q.model && ` · ${q.model}`}</span>}
      </div>
      {q.error ? (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{q.error}</p>
      ) : (
        <AnswerWithPills text={q.answer_text || '—'} />
      )}
      {(q.tokens_in > 0 || q.tokens_out > 0) && (
        <p className="mt-3 text-[11px] text-muted">
          {q.tokens_in} in / {q.tokens_out} out tokens
        </p>
      )}
    </div>
  );
}

function AnswerWithPills({ text }: { text: string }) {
  // Render the [#n] markers the prompt asks the model to emit as inline pills.
  const parts = text.split(/(\[#\d+\])/g);
  return (
    <p className="mt-2 whitespace-pre-wrap text-sm text-ink/90">
      {parts.map((p, i) =>
        /^\[#\d+\]$/.test(p) ? (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-full bg-brand-dark/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-dark"
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'border-brand-dark bg-brand-dark text-white' : 'border-line text-muted hover:border-brand'
      }`}
    >
      {children}
    </button>
  );
}

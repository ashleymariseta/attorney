'use client';

import Link from 'next/link';
import {
  ArrowLeft, BookText, Loader2, Plus, Send, ShieldCheck, Sparkles, User as UserIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { coResearcher, ApiError, type CorpusKind } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Markdown from '@/components/Markdown';

const KIND_ORDER: CorpusKind[] = ['case', 'judgement', 'rules', 'constitution', 'statute'];
const KIND_LABEL: Record<CorpusKind, string> = {
  case: 'Cases',
  judgement: 'Judgements',
  rules: 'High Court Rules',
  constitution: 'Constitution',
  statute: 'Statutes',
};

const EXAMPLES = [
  'What are the grounds for divorce under Zimbabwean law?',
  'Explain the requirements for a spoliation order.',
  'What is the procedure for registering a customary marriage?',
];

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export default function CoResearcherPage() {
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [scope, setScope] = useState<CorpusKind[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function toggleScope(k: CorpusKind) {
    setScope((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }

  function newChat() {
    setMessages([]);
    setInput('');
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg: Msg = { id: ++idRef.current, role: 'user', content: question };
    const assistant: Msg = { id: ++idRef.current, role: 'assistant', content: '', streaming: true };
    setMessages((m) => [...m, userMsg, assistant]);
    setInput('');
    setBusy(true);

    const setAssistant = (fn: (prev: string) => string) =>
      setMessages((m) => m.map((x) => (x.id === assistant.id ? { ...x, content: fn(x.content) } : x)));

    try {
      await coResearcher.askStream(
        { question, scope, history },
        {
          onDelta: (t) => setAssistant((prev) => prev + t),
          onDone: (q) => {
            setMessages((m) =>
              m.map((x) => (x.id === assistant.id ? { ...x, content: q.answer_text || x.content, streaming: false } : x)),
            );
          },
          onError: (detail) => {
            toast.error(detail);
            setMessages((m) => m.filter((x) => x.id !== assistant.id && x.id !== userMsg.id));
            setInput(question);
          },
        },
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'AI-Researcher request failed.');
      setMessages((m) => m.map((x) => (x.id === assistant.id ? { ...x, streaming: false } : x)));
    } finally {
      setBusy(false);
      setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <Link href="/ai-workflows" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
          <ArrowLeft size={12} /> Workflows
        </Link>
        {!empty && (
          <button onClick={newChat} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
            <Plus size={13} /> New chat
          </button>
        )}
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-dark text-white">
            <BookText size={22} />
          </span>
          <h1 className="mt-4 text-2xl font-bold">AI-Researcher</h1>
          <p className="mt-1 max-w-md text-sm text-muted">
            Ask anything about Zimbabwean law. Set a scope to steer the answer toward specific sources.
          </p>
          <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => send(ex)} className="rounded-xl border border-line bg-white p-3 text-left text-xs text-ink/80 transition hover:border-brand hover:shadow-sm">
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-5 py-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Composer */}
      <div className="sticky bottom-0 mt-2 bg-canvas/80 pb-2 pt-2 backdrop-blur">
        <ScopeBar scope={scope} onToggle={toggleScope} onClear={() => setScope([])} />
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="mt-2 flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm focus-within:border-brand"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            rows={1}
            placeholder="Ask a legal question…"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-white transition hover:bg-brand disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
        <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-muted">
          <ShieldCheck size={11} /> AI can be wrong — verify citations against the primary source.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-dark px-4 py-2.5 text-sm text-white">
          {msg.content}
        </div>
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light/40 text-brand-dark">
          <UserIcon size={14} />
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-dark text-white">
        <Sparkles size={14} />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-line bg-white px-4 py-2.5 shadow-sm">
        {msg.content ? (
          <Markdown>{msg.content}</Markdown>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Loader2 size={13} className="animate-spin" /> Thinking…
          </span>
        )}
      </div>
    </div>
  );
}

function ScopeBar({ scope, onToggle, onClear }: { scope: CorpusKind[]; onToggle: (k: CorpusKind) => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Scope</span>
      <button
        onClick={onClear}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${scope.length === 0 ? 'bg-brand-dark text-white' : 'border border-line bg-white text-muted hover:border-brand'}`}
      >
        All sources
      </button>
      {KIND_ORDER.map((k) => {
        const on = scope.includes(k);
        return (
          <button
            key={k}
            onClick={() => onToggle(k)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${on ? 'bg-brand-dark text-white' : 'border border-line bg-white text-muted hover:border-brand'}`}
          >
            {KIND_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}

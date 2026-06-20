'use client';

import Link from 'next/link';
import {
  ArrowLeft, BookText, Loader2, MessageSquare, PanelRightClose, PanelRightOpen,
  Plus, Send, ShieldCheck, Sparkles, Trash2, User as UserIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  coResearcher, ApiError,
  type CorpusKind, type ResearchConversationSummary,
} from '@/lib/api';
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
  const [convos, setConvos] = useState<ResearchConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  async function loadConvos() {
    try {
      const r = await coResearcher.conversations();
      setConvos(r.results);
    } catch {}
  }
  useEffect(() => { loadConvos(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function toMsgs(list: { role: 'user' | 'assistant'; content: string }[]): Msg[] {
    return list.map((m) => ({ id: ++idRef.current, role: m.role, content: m.content }));
  }

  function newChat() {
    setMessages([]);
    setCurrentId(null);
    setInput('');
  }

  async function openConversation(id: number) {
    if (busy) return;
    try {
      const c = await coResearcher.conversation(id);
      setMessages(toMsgs(c.messages));
      setCurrentId(c.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open chat.');
    }
  }

  async function removeConversation(id: number) {
    const ok = await toast.confirm({ title: 'Delete this chat?', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await coResearcher.deleteConversation(id);
      setConvos((c) => c.filter((x) => x.id !== id));
      if (currentId === id) newChat();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const userMsg: Msg = { id: ++idRef.current, role: 'user', content: question };
    const assistant: Msg = { id: ++idRef.current, role: 'assistant', content: '', streaming: true };
    setMessages((m) => [...m, userMsg, assistant]);
    setInput('');
    setBusy(true);

    const setAssistant = (fn: (prev: string) => string) =>
      setMessages((m) => m.map((x) => (x.id === assistant.id ? { ...x, content: fn(x.content) } : x)));

    try {
      await coResearcher.askStream(
        { question, scope, conversation_id: currentId },
        {
          onDelta: (t) => setAssistant((prev) => prev + t),
          onDone: (conv) => {
            setCurrentId(conv.id);
            setMessages((m) => m.map((x) => (x.id === assistant.id ? { ...x, streaming: false } : x)));
            loadConvos();
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
    } finally {
      setBusy(false);
      setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl gap-4 px-3 py-6 sm:px-5">
      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between">
          <Link href="/ai-workflows" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline">
            <ArrowLeft size={12} /> Workflows
          </Link>
          <div className="flex items-center gap-2">
            {!empty && (
              <button onClick={newChat} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
                <Plus size={13} /> New chat
              </button>
            )}
            <button
              onClick={() => setSidebar((s) => !s)}
              title={sidebar ? 'Hide history' : 'Show history'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-semibold text-muted hover:border-brand"
            >
              {sidebar ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          </div>
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
            {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
            <div ref={endRef} />
          </div>
        )}

        {/* Composer */}
        <div className="sticky bottom-0 mt-2 bg-canvas/80 pb-2 pt-2 backdrop-blur">
          <ScopeBar scope={scope} onToggle={(k) => setScope((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))} onClear={() => setScope([])} />
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="mt-2 flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm focus-within:border-brand"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              placeholder="Ask a legal question…"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button type="submit" disabled={busy || !input.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-white transition hover:bg-brand disabled:opacity-40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
          <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-muted">
            <ShieldCheck size={11} /> AI can be wrong — verify citations against the primary source.
          </p>
        </div>
      </div>

      {/* History sidebar */}
      {sidebar && (
        <aside className="hidden w-64 shrink-0 flex-col md:flex">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Chats</span>
            <button onClick={newChat} className="text-muted hover:text-brand-dark" title="New chat"><Plus size={15} /></button>
          </div>
          <div className="mt-2 flex-1 space-y-1 overflow-auto">
            {convos.length === 0 ? (
              <p className="px-1 text-xs text-muted">No saved chats yet.</p>
            ) : (
              convos.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm transition ${currentId === c.id ? 'bg-brand-light/25 text-brand-dark' : 'hover:bg-white'}`}
                >
                  <MessageSquare size={13} className="shrink-0 text-muted" />
                  <button onClick={() => openConversation(c.id)} className="min-w-0 flex-1 truncate text-left">
                    {c.title || 'Untitled chat'}
                  </button>
                  <button onClick={() => removeConversation(c.id)} className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100 hover:text-rose-600" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-dark px-4 py-2.5 text-[13px] text-white">
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
          <Markdown size="sm">{msg.content}</Markdown>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
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

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, BookText, Check, Copy, Download, FileDown, FileText, FolderOpen, Loader2,
  MessageSquare, PanelRightClose, PanelRightOpen, Paperclip, Plus, Printer, Send, ShieldCheck,
  Sparkles, Trash2, User as UserIcon, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  coResearcher, workflowDocuments, ApiError,
  type CorpusKind, type ResearchConversationSummary,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import Markdown from '@/components/Markdown';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json';

interface Attachment {
  name: string;
  media_type: string;
  data: string; // base64 (no data: prefix)
}

function readAsBase64(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      resolve({ name: file.name, media_type: file.type || 'application/octet-stream', data: res.split(',')[1] ?? '' });
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The researcher wraps a drafted document with chat commentary (procedural
// notes, checklists, caveats, a closing question). For a clean PDF we keep only
// the document and drop that trailing advisory matter + decorative emoji.
const ADVISORY_HEADING =
  /\n\s*(?:#{1,6}\s*|\*\*\s*)?(ADDITIONAL PROCEDURAL NOTES|PROCEDURAL NOTES|VERIFICATION CHECKLIST|IMPORTANT CAVEATS?|PRACTITIONER'?S? NOTES?|CAVEATS?|DISCLAIMER|NOTES? TO (?:THE )?PRACTITIONER|GENERAL NOTES|EXPLANATION|COMMENTARY)\b/i;
const CLOSING_OFFER =
  /\n+\s*(?:Would you like me to|Let me know|Shall I|Do you want me to|Feel free to|I can also|If you'?d like|Please let me know)[\s\S]*$/i;

function documentFromAnswer(md: string): string {
  let text = (md || '').replace(/\r\n/g, '\n');
  const m = text.match(ADVISORY_HEADING);
  if (m && m.index !== undefined && m.index > text.length * 0.25) {
    text = text.slice(0, m.index);
  }
  text = text.replace(CLOSING_OFFER, '');
  text = text.replace(/[✅✔❌⚠️🔴🟢🟡]/g, '');
  return text.trim() || md;
}

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
  attachments?: string[]; // file names (display only)
}

export default function CoResearcherPage() {
  const toast = useToast();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [scope, setScope] = useState<CorpusKind[]>([]);
  const [myMatters, setMyMatters] = useState(false);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [convos, setConvos] = useState<ResearchConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (files.length + picked.length > MAX_FILES) {
      toast.error(`Up to ${MAX_FILES} files per message.`);
      return;
    }
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`“${f.name}” is too large (max 10 MB).`);
        continue;
      }
      try {
        const att = await readAsBase64(f);
        setFiles((cur) => [...cur, att]);
      } catch {
        toast.error(`Could not read “${f.name}”.`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function saveAsDoc(content: string) {
    try {
      const title = (content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || 'AI-Researcher answer').slice(0, 120);
      const doc = await workflowDocuments.create({ title, body: content });
      toast.success('Saved to documents — opening the editor.', { major: true });
      router.push(`/ai-workflows/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save document.');
    }
  }

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
    const attached = files;
    const question = text.trim() || (attached.length ? 'Please review the attached file(s).' : '');
    if (!question || busy) return;
    const userMsg: Msg = {
      id: ++idRef.current, role: 'user', content: question,
      attachments: attached.map((a) => a.name),
    };
    const assistant: Msg = { id: ++idRef.current, role: 'assistant', content: '', streaming: true };
    setMessages((m) => [...m, userMsg, assistant]);
    setInput('');
    setFiles([]);
    setBusy(true);

    const setAssistant = (fn: (prev: string) => string) =>
      setMessages((m) => m.map((x) => (x.id === assistant.id ? { ...x, content: fn(x.content) } : x)));

    try {
      await coResearcher.askStream(
        { question, scope, conversation_id: currentId, include_matters: myMatters, attachments: attached },
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
            setInput(text);
            setFiles(attached);
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
            {messages.map((m) => <MessageBubble key={m.id} msg={m} onSaveDoc={saveAsDoc} />)}
            <div ref={endRef} />
          </div>
        )}

        {/* Composer */}
        <div className="sticky bottom-0 mt-2 bg-canvas/80 pb-2 pt-2 backdrop-blur">
          <ScopeBar
            scope={scope}
            onToggle={(k) => setScope((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))}
            onClear={() => setScope([])}
            myMatters={myMatters}
            onToggleMatters={() => setMyMatters((v) => !v)}
          />

          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-ink">
                  <Paperclip size={11} className="text-muted" />
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button onClick={() => setFiles((c) => c.filter((_, idx) => idx !== i))} className="text-muted hover:text-rose-600"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="mt-2 flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm focus-within:border-brand"
          >
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onPickFiles(e.target.files)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Attach files (PDF, image, text)"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-canvas hover:text-brand-dark"
            >
              <Paperclip size={17} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              placeholder="Ask a legal question, or attach a document…"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button type="submit" disabled={busy || (!input.trim() && files.length === 0)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-dark text-white transition hover:bg-brand disabled:opacity-40">
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

function MessageBubble({ msg, onSaveDoc }: { msg: Msg; onSaveDoc: (content: string) => void }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] space-y-1.5">
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {msg.attachments.map((n, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-brand-light/40 px-2 py-0.5 text-[11px] text-brand-dark">
                  <Paperclip size={10} /> <span className="max-w-[160px] truncate">{n}</span>
                </span>
              ))}
            </div>
          )}
          <div className="rounded-2xl rounded-tr-sm bg-brand-dark px-4 py-2.5 text-[13px] text-white">
            {msg.content}
          </div>
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
          <>
            <Markdown size="sm" className="font-draft">{msg.content}</Markdown>
            {!msg.streaming && <AnswerToolbar content={msg.content} onSaveDoc={onSaveDoc} />}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Thinking…
          </span>
        )}
      </div>
    </div>
  );
}

function AnswerToolbar({ content, onSaveDoc }: { content: string; onSaveDoc: (content: string) => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const clean = documentFromAnswer(content);
      const title = (clean.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || 'AI-Researcher answer').slice(0, 120);
      await workflowDocuments.renderPdf(title, clean);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not generate the PDF.');
    } finally {
      setPdfBusy(false);
    }
  }
  const btn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition hover:bg-canvas hover:text-ink';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
      <button onClick={copy} className={btn}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}</button>
      <button onClick={downloadPdf} disabled={pdfBusy} className={btn}>
        {pdfBusy ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} PDF
      </button>
      <button onClick={() => downloadText('answer.md', content, 'text/markdown;charset=utf-8')} className={btn}><Download size={12} /> .md</button>
      <button onClick={() => downloadText('answer.txt', content, 'text/plain;charset=utf-8')} className={btn}><FileDown size={12} /> .txt</button>
      <button onClick={() => onSaveDoc(content)} className={btn}><FileText size={12} /> Save as document</button>
    </div>
  );
}

function ScopeBar({
  scope, onToggle, onClear, myMatters, onToggleMatters,
}: {
  scope: CorpusKind[];
  onToggle: (k: CorpusKind) => void;
  onClear: () => void;
  myMatters: boolean;
  onToggleMatters: () => void;
}) {
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
      <span className="mx-0.5 h-4 w-px bg-line" />
      <button
        onClick={onToggleMatters}
        title="Include your client matters as context"
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${myMatters ? 'bg-brand-dark text-white' : 'border border-line bg-white text-muted hover:border-brand'}`}
      >
        <FolderOpen size={11} /> My matters
      </button>
    </div>
  );
}

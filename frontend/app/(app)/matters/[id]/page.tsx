'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LucideIcon,
  Plus,
  FileUp,
  PenLine,
  CreditCard,
  Clock,
  Star,
  Info,
  Link2,
  X,
  Send,
  Image as ImageIcon,
} from 'lucide-react';
import {
  matters as mattersApi,
  messages as messagesApi,
  documents as documentsApi,
  payments as paymentsApi,
  timeEntries as timeApi,
  reviews as reviewsApi,
  ApiError,
  type Matter,
  type Message,
  type DocumentItem,
  type Payment,
  type TimeEntry,
  type Review,
} from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { StarRating, StarInput } from '@/components/Stars';
import ChatDoodles from '@/components/ChatDoodles';

type DrawerTab = 'media' | 'links' | 'drafts' | 'payments' | 'time' | 'reviews';

interface AttachAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export default function MatterRoomPage() {
  const params = useParams<{ id: string }>();
  const matterId = Number(params.id);
  const { me } = useApp();

  const [matter, setMatter] = useState<Matter | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [pays, setPays] = useState<Payment[]>([]);
  const [times, setTimes] = useState<TimeEntry[]>([]);
  const [revs, setRevs] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);

  const docInputRef = useRef<HTMLInputElement>(null);

  const isLawyer = me?.role === 'lawyer';
  const isClient = !!me?.role?.startsWith('client');
  const channelId = matter?.channel_id ?? null;

  const reloadMessages = useCallback(async (cid: number) => setMsgs((await messagesApi.listForChannel(cid)).results), []);
  const reloadDocs = useCallback(async () => setDocs((await documentsApi.listForMatter(matterId)).results), [matterId]);
  const reloadPays = useCallback(async () => setPays((await paymentsApi.listForMatter(matterId)).results), [matterId]);
  const reloadTimes = useCallback(async () => setTimes((await timeApi.forMatter(matterId)).results), [matterId]);
  const reloadReviews = useCallback(async () => setRevs((await reviewsApi.forMatter(matterId)).results), [matterId]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const m = await mattersApi.get(matterId);
      setMatter(m);
      await Promise.all([
        m.channel_id ? reloadMessages(m.channel_id) : Promise.resolve(),
        reloadDocs(),
        reloadPays(),
        reloadTimes(),
        reloadReviews(),
      ]);
      setLoading(false);
    })();
  }, [matterId, reloadMessages, reloadDocs, reloadPays, reloadTimes, reloadReviews]);

  async function quickUploadDoc(file: File) {
    try {
      await documentsApi.upload(matterId, file, file.name);
      await reloadDocs();
      setDrawer('media');
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Upload failed.');
    }
  }

  if (loading) return <p className="p-8 text-sm text-muted">Loading room…</p>;
  if (!matter) return <p className="p-8 text-sm text-muted">Matter not found.</p>;

  const otherParty = isClient
    ? matter.lawyers?.[0]?.full_name ?? 'Lawyer'
    : matter.client?.full_name ?? 'Client';

  const attachActions: AttachAction[] = [
    { key: 'document', label: 'Document', icon: FileUp, onClick: () => docInputRef.current?.click() },
    { key: 'draft', label: 'Draft', icon: PenLine, onClick: () => setDrawer('drafts') },
    { key: 'payment', label: isLawyer ? 'Request payment' : 'Make a payment', icon: CreditCard, onClick: () => setDrawer('payments') },
    ...(isLawyer ? [{ key: 'time', label: 'Log time', icon: Clock, onClick: () => setDrawer('time') } as AttachAction] : []),
    ...(isClient ? [{ key: 'review', label: 'Leave a review', icon: Star, onClick: () => setDrawer('reviews') } as AttachAction] : []),
  ];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Header — click to open info */}
      <header
        onClick={() => setDrawer('media')}
        className="flex cursor-pointer items-center justify-between border-b border-line bg-surface px-4 py-2.5 hover:bg-canvas"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-dark text-sm font-bold text-white">
            {matter.title[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight">{matter.title}</h1>
            <p className="truncate text-xs text-muted">with {otherParty} · tap for info</p>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {isLawyer && <TimerWidget matterId={matterId} onChange={reloadTimes} />}
          {matter.billing_model === 'retainer' ? (
            <span className="badge-teal hidden sm:inline-flex">Retainer</span>
          ) : (
            <span className="badge-muted hidden sm:inline-flex">Consultation</span>
          )}
          <button onClick={() => setDrawer('media')} className="btn-ghost px-2 py-1.5" aria-label="Matter info">
            <Info size={18} />
          </button>
        </div>
      </header>

      {channelId ? (
        <MessageThread msgs={msgs} meId={me?.id} channelId={channelId} onSent={() => reloadMessages(channelId)} attachActions={attachActions} />
      ) : (
        <p className="p-6 text-sm text-muted">No channel for this matter.</p>
      )}

      <input
        ref={docInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) quickUploadDoc(f);
          e.target.value = '';
        }}
      />

      {drawer && (
        <InfoDrawer
          matter={matter}
          otherParty={otherParty}
          tab={drawer}
          setTab={setDrawer}
          onClose={() => setDrawer(null)}
          isLawyer={isLawyer}
          isClient={isClient}
          matterId={matterId}
          msgs={msgs}
          docs={docs}
          pays={pays}
          times={times}
          revs={revs}
          reloadDocs={reloadDocs}
          reloadPays={reloadPays}
          reloadTimes={reloadTimes}
          reloadReviews={reloadReviews}
        />
      )}
    </div>
  );
}

/* ---------------- Messages (chat bubbles + doodle bg + composer) ---------------- */
function MessageThread({
  msgs,
  meId,
  channelId,
  onSent,
  attachActions,
}: {
  msgs: Message[];
  meId?: number;
  channelId: number;
  onSent: () => void;
  attachActions: AttachAction[];
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await messagesApi.send(channelId, text.trim());
      setText('');
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
        <ChatDoodles />
        <div className="absolute inset-0 overflow-y-auto">
          <div className="relative z-10 space-y-2 px-4 py-4 sm:px-8">
          {msgs.length === 0 && (
            <p className="mx-auto mt-8 w-fit rounded-full bg-white/80 px-4 py-1.5 text-center text-xs text-muted shadow-sm">
              This is the start of your matter room — no email needed.
            </p>
          )}
          {msgs.map((m, i) => {
            const mine = m.sender.id === meId;
            const prev = msgs[i - 1];
            const grouped = prev && prev.sender.id === m.sender.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`}>
                {!mine && (
                  <div className={`mr-2 h-7 w-7 shrink-0 ${grouped ? 'invisible' : ''}`}>
                    <div className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                      {(m.sender.full_name || m.sender.email).split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                  </div>
                )}
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    mine
                      ? 'rounded-br-md bg-brand-dark text-white'
                      : 'rounded-bl-md border border-line bg-white text-ink'
                  }`}
                >
                  {!mine && !grouped && (
                    <p className="mb-0.5 text-xs font-semibold text-brand">{m.sender.full_name}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/60' : 'text-muted'}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <form onSubmit={send} className="border-t border-line bg-surface p-3">
        <div className="flex items-end gap-2">
          <AttachMenu actions={attachActions} />
          <textarea
            className="field max-h-32 min-h-[44px] resize-none rounded-2xl"
            rows={1}
            placeholder="Message this matter room…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e);
            }}
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-dark text-white transition-colors hover:bg-brand disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </>
  );
}

function AttachMenu({ actions }: { actions: AttachAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => { setOpen(false); a.onClick(); }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-sm hover:bg-canvas"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-light/15 text-brand">
                <a.icon size={16} />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-canvas ${open ? 'rotate-45 bg-canvas' : ''}`}
        aria-label="Add attachment"
      >
        <Plus size={20} />
      </button>
    </div>
  );
}

/* ---------------- Info drawer (click the header) ---------------- */
function InfoDrawer({
  matter,
  otherParty,
  tab,
  setTab,
  onClose,
  isLawyer,
  isClient,
  matterId,
  msgs,
  docs,
  pays,
  times,
  revs,
  reloadDocs,
  reloadPays,
  reloadTimes,
  reloadReviews,
}: {
  matter: Matter;
  otherParty: string;
  tab: DrawerTab;
  setTab: (t: DrawerTab) => void;
  onClose: () => void;
  isLawyer: boolean;
  isClient: boolean;
  matterId: number;
  msgs: Message[];
  docs: DocumentItem[];
  pays: Payment[];
  times: TimeEntry[];
  revs: Review[];
  reloadDocs: () => void;
  reloadPays: () => void;
  reloadTimes: () => void;
  reloadReviews: () => void;
}) {
  const tabs: { key: DrawerTab; label: string; icon: LucideIcon }[] = [
    { key: 'media', label: 'Media', icon: ImageIcon },
    { key: 'links', label: 'Links', icon: Link2 },
    { key: 'drafts', label: 'Drafts', icon: PenLine },
    { key: 'payments', label: 'Payments', icon: CreditCard },
    ...(isLawyer ? [{ key: 'time' as DrawerTab, label: 'Time', icon: Clock }] : []),
    { key: 'reviews', label: 'Reviews', icon: Star },
  ];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-brand-darker/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface shadow-2xl">
        {/* group-info header */}
        <div className="border-b border-line p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-dark text-lg font-bold text-white">
                {matter.title[0]?.toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">{matter.title}</h2>
                <p className="text-sm text-muted">with {otherParty}</p>
              </div>
            </div>
            <button onClick={onClose} className="btn-ghost px-2 py-1"><X size={18} /></button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge-muted capitalize">{matter.status}</span>
            <span className="badge-muted capitalize">{matter.billing_model}</span>
            {matter.practice_area && <span className="badge-muted">{matter.practice_area}</span>}
          </div>
        </div>

        {/* tab bar */}
        <div className="flex overflow-x-auto border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 min-w-[64px] flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-semibold transition-colors ${
                tab === t.key ? 'border-b-2 border-brand text-brand' : 'text-muted hover:text-ink'
              }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {/* content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'media' && <DocsPanel matterId={matterId} items={docs.filter((d) => d.kind === 'document')} onChange={reloadDocs} />}
          {tab === 'links' && <LinksPanel msgs={msgs} />}
          {tab === 'drafts' && <DraftsPanel matterId={matterId} items={docs.filter((d) => d.kind === 'draft')} onChange={reloadDocs} />}
          {tab === 'payments' && <PaymentsPanel matterId={matterId} items={pays} onChange={reloadPays} />}
          {tab === 'time' && <TimePanel matterId={matterId} items={times} onChange={reloadTimes} />}
          {tab === 'reviews' && <ReviewsPanel matterId={matterId} items={revs} canReview={isClient} onChange={reloadReviews} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Links (URLs shared in chat) ---------------- */
function LinksPanel({ msgs }: { msgs: Message[] }) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const links: { url: string; by: string; at: string }[] = [];
  msgs.forEach((m) => {
    const found = m.content.match(urlRe);
    if (found) found.forEach((u) => links.push({ url: u, by: m.sender.full_name, at: m.created_at }));
  });
  if (links.length === 0) return <p className="text-sm text-muted">No links shared yet.</p>;
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-line p-3 hover:border-brand">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light/15 text-brand"><Link2 size={16} /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-brand">{l.url}</p>
            <p className="text-[11px] text-muted">{l.by} · {new Date(l.at).toLocaleDateString()}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

/* ---------------- Documents ---------------- */
function DocsPanel({ matterId, items, onChange }: { matterId: number; items: DocumentItem[]; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr('Choose a file.');
    setBusy(true);
    setErr('');
    try {
      await documentsApi.upload(matterId, file, title || file.name);
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={upload} className="space-y-2 rounded-lg border border-line p-3">
        <input className="field" placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input ref={fileRef} type="file" className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-brand-dark file:px-3 file:py-1.5 file:text-white" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button className="btn-primary w-full py-1.5 text-xs" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</button>
      </form>
      <DocList items={items} empty="No documents shared yet." />
    </div>
  );
}

function DraftsPanel({ matterId, items, onChange }: { matterId: number; items: DocumentItem[]; onChange: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await documentsApi.createDraft(matterId, title, body);
      setTitle('');
      setBody('');
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2 rounded-lg border border-line p-3">
        <input className="field" placeholder="Draft title (e.g. Engagement letter)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="field" rows={4} placeholder="Draft content…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn-primary w-full py-1.5 text-xs" disabled={busy}>{busy ? 'Saving…' : 'Add draft'}</button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No drafts yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <div key={d.id} className="rounded-lg border border-line p-3">
              <p className="text-sm font-semibold">{d.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink/70">{d.body || '(empty)'}</p>
              <p className="mt-2 text-[11px] text-muted">v{d.version} · {d.uploader_detail?.full_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocList({ items, empty }: { items: DocumentItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((d) => (
        <a key={d.id} href={d.file_url ?? '#'} target="_blank"
          className="flex items-center justify-between rounded-lg border border-line p-3 hover:border-brand">
          <div>
            <p className="text-sm font-semibold">{d.title}</p>
            <p className="text-[11px] text-muted">{d.uploader_detail?.full_name} · v{d.version}</p>
          </div>
          <span className="text-xs text-brand">Open</span>
        </a>
      ))}
    </div>
  );
}

/* ---------------- Payments ---------------- */
function PaymentsPanel({ matterId, items, onChange }: { matterId: number; items: Payment[]; onChange: () => void }) {
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('trust_deposit');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await paymentsApi.create({ matter: matterId, amount, currency: 'USD', provider: 'manual_pop', purpose });
      setAmount('');
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-xs font-semibold uppercase text-muted">Request / record a payment</p>
        <div className="flex gap-2">
          <input className="field" type="number" min="0.01" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <select className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="trust_deposit">Trust deposit</option>
            <option value="consultation">Consultation</option>
            <option value="invoice">Invoice</option>
            <option value="retainer">Retainer</option>
          </select>
        </div>
        <button className="btn-primary w-full py-1.5 text-xs" disabled={busy}>{busy ? 'Saving…' : 'Add payment'}</button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No payments on this matter.</p>
      ) : (
        <div className="space-y-2">
          {items.map((p) => <PaymentRow key={p.id} payment={p} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}

function PaymentRow({ payment, onChange }: { payment: Payment; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const verified = payment.status === 'verified';

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await paymentsApi.uploadProof(payment.id, file, '', '');
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{payment.amount} {payment.currency}</p>
        <span className={verified ? 'badge-teal' : 'badge-muted'}>{payment.status_display}</span>
      </div>
      <p className="text-[11px] uppercase text-muted">{payment.purpose}</p>
      {payment.proof_of_payment_url ? (
        <a href={payment.proof_of_payment_url} target="_blank" className="mt-2 inline-block text-xs text-brand underline">
          View proof of payment
        </a>
      ) : (
        <div className="mt-2 space-y-1">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="block w-full text-[11px] file:mr-2 file:rounded file:border-0 file:bg-brand-light/20 file:px-2 file:py-1 file:text-brand" />
          <button onClick={upload} disabled={busy} className="btn-light w-full py-1 text-xs">
            {busy ? 'Uploading…' : 'Upload proof of payment'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Billable timer ---------------- */
function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function TimerWidget({ matterId, onChange }: { matterId: number; onChange: () => void }) {
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    timeApi.running().then((r) => setRunning(r)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!running) return;
    const start = new Date(running.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  const onThisMatter = running?.matter === matterId;

  async function start() {
    setBusy(true);
    try {
      setRunning(await timeApi.start(matterId));
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Could not start timer.');
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!running) return;
    setBusy(true);
    try {
      await timeApi.stop(running.id);
      setRunning(null);
      setElapsed(0);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  if (running && onThisMatter) {
    return (
      <button onClick={stop} disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        {fmt(elapsed)} · Stop
      </button>
    );
  }
  if (running && !onThisMatter) {
    return <span className="badge-muted hidden text-[11px] sm:inline-flex">Timer on {running.matter_title}</span>;
  }
  return (
    <button onClick={start} disabled={busy} className="btn-outline px-3 py-1.5 text-xs">
      <Clock size={14} /> Start timer
    </button>
  );
}

/* ---------------- Time panel ---------------- */
function TimePanel({ matterId, items, onChange }: { matterId: number; items: TimeEntry[]; onChange: () => void }) {
  const total = items.reduce((s, e) => s + (e.amount ? Number(e.amount) : 0), 0);
  const minutes = items.reduce((s, e) => s + e.minutes, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div>
          <p className="text-xs uppercase text-muted">Billable total</p>
          <p className="text-lg font-bold">${total.toFixed(2)}</p>
        </div>
        <p className="text-sm text-muted">{minutes} min logged</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No time logged. Use the timer in the header.</p>
      ) : (
        items.map((e) => (
          <div key={e.id} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{e.minutes} min</span>
              <span className="font-semibold">${e.amount ?? '—'}</span>
            </div>
            <p className="text-xs text-muted">
              {e.description || 'Billable work'} · {e.client_detail?.full_name} · {new Date(e.started_at).toLocaleDateString()}
              {e.is_running && <span className="ml-1 text-brand">• running</span>}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- Reviews panel ---------------- */
function ReviewsPanel({ matterId, items, canReview, onChange }: { matterId: number; items: Review[]; canReview: boolean; onChange: () => void }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const alreadyReviewed = items.length > 0 && canReview;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await reviewsApi.create(matterId, rating, body);
      setBody('');
      onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not submit review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canReview && !alreadyReviewed && (
        <form onSubmit={submit} className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-xs font-semibold uppercase text-muted">Rate your lawyer</p>
          <StarInput value={rating} onChange={setRating} />
          <textarea className="field" rows={3} placeholder="Share your experience…" value={body} onChange={(e) => setBody(e.target.value)} />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button className="btn-primary w-full py-1.5 text-xs" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">No reviews yet.</p>
      ) : (
        items.map((r) => (
          <div key={r.id} className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between">
              <StarRating value={r.rating} size={14} />
              <span className="text-[11px] text-muted">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <p className="mt-1 text-sm">{r.body}</p>
            <p className="mt-1 text-[11px] text-muted">— {r.author_detail?.full_name}</p>
          </div>
        ))
      )}
    </div>
  );
}

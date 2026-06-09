'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type LucideIcon,
  Check,
  Clock,
  Eye,
  Landmark,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  ThumbsDown,
  ThumbsUp,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '@/components/AppShell';
import {
  payments as paymentsApi,
  transactions as txApi,
  ApiError,
  type Payment,
  type Transaction,
} from '@/lib/api';
import { DecoIcon } from '@/components/Banner';
import PayInvoiceModal from '@/components/PayInvoiceModal';
import { useToast } from '@/components/Toast';

const STATUS_STYLE: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  pending_review: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  pending: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  rejected: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  failed: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
};

function StatusPill({ status, label }: { status: string; label: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-line/60 text-muted ring-1 ring-inset ring-line';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label.replace(/_/g, ' ')}
    </span>
  );
}

export default function TransactionsPage() {
  const toast = useToast();
  const { me } = useApp();
  const [items, setItems] = useState<Transaction[]>([]);
  const [escrow, setEscrow] = useState('0');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<Payment | null>(null);
  const [commenting, setCommenting] = useState<Transaction | null>(null);
  const [rejecting, setRejecting] = useState<Transaction | null>(null);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const isAdmin = !!me && (me.role === 'admin' || (me as any).is_staff || (me as any).is_superuser);

  async function refresh() {
    const res = await txApi.list();
    setItems(res.results);
    setEscrow(res.total_escrow);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const totalPending = items
    .filter((i) => i.status.includes('pending'))
    .reduce((s, i) => s + Number(i.amount), 0);

  async function approve(paymentId: number) {
    const ok = await toast.confirm({
      title: 'Verify payment?',
      body: 'Funds will post to the matter trust ledger and the payer will be notified.',
      confirmLabel: 'Verify',
    });
    if (!ok) return;
    setBusyId(paymentId);
    try {
      await paymentsApi.review(paymentId, { status: 'verified' });
      await refresh();
      toast.success('Payment verified — funds posted to trust ledger.', { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not verify.');
    } finally {
      setBusyId(null);
    }
  }

  async function openPay(t: Transaction) {
    if (!t.payment_id) return;
    setBusyId(t.payment_id);
    try {
      const p = await paymentsApi.get(t.payment_id);
      setPaying(p);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not open payment.');
    } finally {
      setBusyId(null);
    }
  }

  const filteredItems = items.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      t.matter_title.toLowerCase().includes(q) ||
      t.label.toLowerCase().includes(q) ||
      t.status_display.toLowerCase().includes(q) ||
      t.amount.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
      <p className="text-sm text-muted">Every payment and trust-ledger movement across your matters.</p>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="In escrow (trust)" value={`$${escrow}`} icon={Landmark} />
        <Stat label="Pending review" value={`$${totalPending.toFixed(2)}`} icon={Clock} />
        <Stat label="Transactions" value={items.length} icon={Receipt} />
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
        <svg
          aria-hidden
          className="h-4 w-4 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search matter, type, status or amount…"
          className="w-full bg-transparent text-sm placeholder:text-muted focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="text-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-brand-dark text-left text-[10px] font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-4 py-3">Matter</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  {query ? `No matches for "${query}".` : 'No transactions yet.'}
                </td>
              </tr>
            )}
            {filteredItems.map((t) => {
              const isPayment = t.kind === 'payment';
              const isPending = /pending|awaiting/i.test(t.status);
              const isInvoice = t.purpose === 'invoice';
              const isMine = me?.id === t.payer_id;
              const canReview = !!t.can_review || isAdmin;
              const canApprove = canReview && isPayment && isPending && !!t.has_proof;
              const canReject = canReview && isPayment && isPending;
              const canPay = isPayment && isPending && isMine && !t.has_proof;
              return (
                <tr key={t.id} className="hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium">{t.matter_title}</td>
                  <td className="px-4 py-3">
                    <span className="text-muted">{t.kind === 'trust' ? 'Trust' : 'Payment'} · </span>
                    {t.label}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} label={t.status_display} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">${t.amount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <ActionsMenu
                        actions={[
                          {
                            key: 'details',
                            label: 'View details',
                            icon: Eye,
                            tone: 'ghost',
                            onClick: () => setDetailTx(t),
                          },
                          canPay
                            ? {
                                key: 'pay',
                                label: 'Pay',
                                icon: Wallet,
                                tone: 'brand',
                                onClick: () => openPay(t),
                              }
                            : null,
                          canApprove
                            ? {
                                key: 'approve',
                                label: 'Approve',
                                icon: ThumbsUp,
                                tone: 'emerald',
                                onClick: () => t.payment_id && approve(t.payment_id),
                              }
                            : null,
                          canReject
                            ? {
                                key: 'reject',
                                label: 'Reject',
                                icon: ThumbsDown,
                                tone: 'red',
                                onClick: () => setRejecting(t),
                              }
                            : null,
                          isPayment
                            ? {
                                key: 'comment',
                                label: 'Comment',
                                icon: MessageSquare,
                                tone: 'ghost',
                                onClick: () => setCommenting(t),
                              }
                            : null,
                        ].filter(Boolean) as MenuAction[]}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paying && (
        <PayInvoiceModal
          payment={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            refresh();
            toast.success('Payment submitted — awaiting verification.', { major: true });
          }}
        />
      )}
      {commenting && commenting.payment_id && (
        <CommentModal
          tx={commenting}
          onClose={() => setCommenting(null)}
          onDone={() => {
            setCommenting(null);
            refresh();
            toast.success('Comment added.');
          }}
        />
      )}
      {rejecting && rejecting.payment_id && (
        <RejectModal
          tx={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            refresh();
            toast.success('Payment rejected — payer can re-upload.');
          }}
        />
      )}
      {detailTx && <TransactionDetailModal tx={detailTx} onClose={() => setDetailTx(null)} />}
    </div>
  );
}

type MenuActionTone = 'brand' | 'emerald' | 'red' | 'ghost';

interface MenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: MenuActionTone;
  onClick: () => void;
}

const TONE_TEXT: Record<MenuActionTone, string> = {
  brand: 'text-brand-dark',
  emerald: 'text-emerald-700',
  red: 'text-red-700',
  ghost: 'text-ink',
};

function ActionsMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuHeight = Math.max(40, actions.length * 36 + 16);
    const spaceBelow = window.innerHeight - r.bottom;
    const goUp = spaceBelow < menuHeight + 8;
    setPos({
      top: goUp ? r.top - menuHeight - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Actions"
        className={`grid h-7 w-7 place-items-center rounded-md border transition ${
          open
            ? 'border-brand bg-brand-light/15 text-brand-dark'
            : 'border-line bg-white text-ink hover:border-brand hover:text-brand'
        }`}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-[120] w-44 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-xl"
          >
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition hover:bg-canvas ${TONE_TEXT[a.tone]}`}
              >
                <a.icon size={13} />
                {a.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function CommentModal({
  tx,
  onClose,
  onDone,
}: {
  tx: Transaction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !tx.payment_id) return;
    setBusy(true);
    try {
      await paymentsApi.comment(tx.payment_id, body.trim());
      onDone();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Could not save comment.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell title="Add comment" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        On <span className="font-semibold text-ink">{tx.matter_title}</span> · {tx.label} · ${tx.amount} {tx.currency}
      </p>
      {tx.note && (
        <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-xs">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Earlier notes</p>
          <pre className="whitespace-pre-wrap font-sans text-ink/80">{tx.note}</pre>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <textarea
          className="field"
          rows={4}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note for the matter…"
        />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button
          disabled={busy || !body.trim()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Post comment'}
          {!busy && <Check size={16} />}
        </button>
      </form>
    </ModalShell>
  );
}

function RejectModal({
  tx,
  onClose,
  onDone,
}: {
  tx: Transaction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tx.payment_id) return;
    setBusy(true);
    try {
      await paymentsApi.review(tx.payment_id, { status: 'rejected', review_note: note.trim() });
      onDone();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Could not reject.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell title="Reject payment" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        Rejecting will let the payer re-upload proof. On{' '}
        <span className="font-semibold text-ink">{tx.matter_title}</span> · ${tx.amount} {tx.currency}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="label">Reason (optional)</label>
        <textarea
          className="field"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. POP doesn't match the reference."
        />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? 'Rejecting…' : 'Confirm rejection'}
          {!busy && <ThumbsDown size={16} />}
        </button>
      </form>
    </ModalShell>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-2 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

function TransactionDetailModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  return (
    <ModalShell title="Transaction details" onClose={onClose}>
      <div className="space-y-0">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold text-ink">${tx.amount}</p>
            <p className="text-xs text-muted">{tx.currency}</p>
          </div>
          <StatusPill status={tx.status} label={tx.status_display} />
        </div>
        <DetailRow label="Matter">{tx.matter_title}</DetailRow>
        <DetailRow label="Kind">{tx.kind === 'trust' ? 'Trust ledger' : 'Payment'}</DetailRow>
        <DetailRow label="Label">{tx.label}</DetailRow>
        {tx.purpose && (
          <DetailRow label="Purpose">{tx.purpose.replace(/_/g, ' ')}</DetailRow>
        )}
        <DetailRow label="Created">{new Date(tx.created_at).toLocaleString()}</DetailRow>
        {tx.kind === 'payment' && (
          <DetailRow label="Proof of payment">
            {tx.has_proof ? 'Uploaded' : <span className="text-muted">Not yet uploaded</span>}
          </DetailRow>
        )}
        {tx.payment_id && (
          <DetailRow label="Reference">INV-{String(tx.payment_id).padStart(5, '0')}</DetailRow>
        )}
        {tx.note && (
          <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink/80">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Notes</p>
            <pre className="whitespace-pre-wrap font-sans">{tx.note}</pre>
          </div>
        )}
        {tx.review_note && (
          <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-xs text-ink/80">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Reviewer note</p>
            <pre className="whitespace-pre-wrap font-sans">{tx.review_note}</pre>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: LucideIcon }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card sm:p-5">
      {icon && <DecoIcon icon={icon} className="hidden sm:block" />}
      <div className="relative z-10">
        <p className="min-h-[2.4em] text-[10px] uppercase leading-tight tracking-wide text-muted sm:min-h-0 sm:text-xs">
          {label}
        </p>
        <p className="mt-0.5 text-base font-bold sm:mt-1 sm:text-2xl">{value}</p>
      </div>
    </div>
  );
}

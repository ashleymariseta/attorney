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
  CalendarDays,
  CalendarClock,
  Check,
  Eye,
  FileText,
  Flag,
  Receipt,
  ThumbsDown,
  ThumbsUp,
  Image as ImageIcon,
} from 'lucide-react';
import {
  matters as mattersApi,
  messages as messagesApi,
  documents as documentsApi,
  payments as paymentsApi,
  consultations as consultationsApi,
  timeEntries as timeApi,
  reviews as reviewsApi,
  ApiError,
  type Consultation,
  type Matter,
  type Message,
  type MiniUser,
  type DocumentItem,
  type Payment,
  type TimeEntry,
  type Review,
} from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { StarRating, StarInput } from '@/components/Stars';
import ChatDoodles from '@/components/ChatDoodles';
import PayInvoiceModal from '@/components/PayInvoiceModal';
import { useToast } from '@/components/Toast';
import { setRunning as setRunningStore, useRunningTimer } from '@/lib/timerStore';
import { DraftRow, RejectPaymentModal, RescheduleModal } from '@/components/MatterModals';
import FileViewerModal from '@/components/FileViewerModal';
import InvoiceViewerModal from '@/components/InvoiceViewerModal';
import { LogTimeModal } from '@/components/TimeTracker';
import { fireNotification, requestPermissionOnce } from '@/lib/browserNotify';
import { useChannelSocket } from '@/lib/channelSocket';
import { MessageCircle, Smile } from 'lucide-react';

type DrawerTab = 'media' | 'links' | 'drafts' | 'payments' | 'time' | 'reviews';

interface AttachAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

type TimelineItem =
  | { kind: 'message'; at: string; m: Message }
  | { kind: 'document'; at: string; d: DocumentItem }
  | { kind: 'payment'; at: string; p: Payment }
  | { kind: 'consultation'; at: string; c: Consultation };

function buildTimeline(
  msgs: Message[],
  docs: DocumentItem[],
  pays: Payment[],
  consults: Consultation[]
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...msgs.map<TimelineItem>((m) => ({ kind: 'message', at: m.created_at, m })),
    ...docs.map<TimelineItem>((d) => ({ kind: 'document', at: d.created_at, d })),
    ...pays.map<TimelineItem>((p) => ({ kind: 'payment', at: p.created_at, p })),
    ...consults.map<TimelineItem>((c) => ({
      kind: 'consultation',
      at: c.created_at ?? c.scheduled_time ?? new Date().toISOString(),
      c,
    })),
  ];
  items.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  return items;
}

function statusTone(status: string): string {
  if (/verified|confirmed|completed|active|paid/i.test(status))
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200';
  if (/pending|awaiting|review/i.test(status))
    return 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200';
  if (/rejected|failed|cancelled|declined/i.test(status))
    return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200';
  return 'bg-line/60 text-muted ring-1 ring-inset ring-line';
}

function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(
        status
      )}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label.replace(/_/g, ' ')}
    </span>
  );
}

/* ---------------- Inline timeline widgets ---------------- */
function avatarInitials(u?: MiniUser | null) {
  const src = u?.full_name || u?.email || '';
  return src.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function TimelineCard({
  icon: Icon,
  iconTone,
  title,
  subtitle,
  status,
  statusLabel,
  children,
  action,
  time,
  mine,
  by,
  grouped,
  onClick,
}: {
  icon: LucideIcon;
  iconTone?: string;
  title: string;
  subtitle?: React.ReactNode;
  status?: string;
  statusLabel?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  time: string;
  mine: boolean;
  by?: MiniUser | null;
  grouped?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`}>
      {!mine && (
        <div className={`mr-2 h-7 w-7 shrink-0 ${grouped ? 'invisible' : ''}`}>
          <div className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
            {avatarInitials(by)}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        className="w-[320px] max-w-full overflow-hidden rounded-t-2xl border border-line bg-white text-left shadow-sm transition hover:border-brand"
      >
        <div className="h-4 bg-brand" />
        <div className="px-3 py-2.5">
          {!mine && !grouped && by?.full_name && (
            <p className="mb-1 text-xs font-semibold text-brand">{by.full_name}</p>
          )}
          <div className="flex items-start gap-3">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${
                iconTone ?? 'bg-brand-light/15 text-brand-dark'
              }`}
            >
              <Icon size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{title}</p>
              {subtitle && <p className="mt-0.5 truncate text-[11px] text-muted">{subtitle}</p>}
              {children}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2">
            <div className="flex items-center gap-2">
              {status && statusLabel && <StatusPill status={status} label={statusLabel} />}
              <p className="text-[10px] text-muted">
                {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
          </div>
        </div>
      </button>
    </div>
  );
}

function DocumentCard({
  d,
  mine,
  grouped,
  onClick,
}: {
  d: DocumentItem;
  mine: boolean;
  grouped?: boolean;
  onClick?: () => void;
}) {
  const isDraft = d.kind === 'draft';
  return (
    <TimelineCard
      icon={isDraft ? PenLine : FileText}
      title={d.title}
      subtitle={
        <>
          {isDraft ? 'Draft' : 'Document'} · v{d.version}
        </>
      }
      time={d.created_at}
      mine={mine}
      by={d.uploader_detail}
      grouped={grouped}
      onClick={onClick}
      action={
        d.file_url ? (
          <a
            href={d.file_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-dark hover:border-brand hover:text-brand"
          >
            Open
          </a>
        ) : null
      }
    />
  );
}

function PaymentCard({
  p,
  mine,
  by,
  grouped,
  onClick,
  onPay,
  onApprove,
  onReject,
  canReview,
}: {
  p: Payment;
  mine: boolean;
  by?: MiniUser | null;
  grouped?: boolean;
  onClick?: () => void;
  onPay?: (p: Payment) => void;
  onApprove?: (p: Payment) => void;
  onReject?: (p: Payment) => void;
  canReview?: boolean;
}) {
  const isPending = /pending|awaiting|review/i.test(p.status);
  const hasProof = !!p.proof_of_payment_url;
  const [viewingProof, setViewingProof] = useState(false);
  return (
    <>
    <TimelineCard
      icon={Receipt}
      iconTone="bg-emerald-50 text-emerald-700"
      title="Payment Request"
      subtitle={
        <>
          ${Number(p.amount).toFixed(2)} {p.currency} ·{' '}
          <span className="capitalize">{p.purpose?.replace(/_/g, ' ') || 'Payment'}</span>
        </>
      }
      status={p.status}
      statusLabel={p.status_display || p.status}
      time={p.created_at}
      mine={mine}
      by={by}
      grouped={grouped}
      onClick={onClick}
      action={
        <span className="flex items-center gap-1">
          {hasProof && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewingProof(true);
              }}
              aria-label="View proof of payment"
              title="View proof of payment"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[10px] font-semibold text-brand-dark hover:border-brand hover:text-brand"
            >
              <Eye size={11} /> POP
            </button>
          )}
          {mine && onPay && !hasProof && isPending && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPay(p);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-brand-dark px-2 py-1 text-[10px] font-semibold text-white hover:bg-brand"
            >
              Pay
            </button>
          )}
          {canReview && onApprove && isPending && hasProof && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApprove(p);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500"
              title="Approve"
            >
              <ThumbsUp size={11} />
            </button>
          )}
          {canReview && onReject && isPending && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReject(p);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100"
              title="Reject"
            >
              <ThumbsDown size={11} />
            </button>
          )}
        </span>
      }
    />
    {viewingProof && p.proof_of_payment_url && (
      <FileViewerModal
        url={p.proof_of_payment_url}
        title={`Proof of payment · ${p.purpose?.replace(/_/g, ' ') || 'Payment'}`}
        onClose={() => setViewingProof(false)}
      />
    )}
    </>
  );
}

function DetailModal({
  item,
  onClose,
  meId,
  matterClientId,
  onPay,
}: {
  item: TimelineItem;
  onClose: () => void;
  meId?: number;
  matterClientId?: number;
  onPay?: (p: Payment) => void;
}) {
  const HeaderIcon: LucideIcon =
    item.kind === 'payment'
      ? Receipt
      : item.kind === 'document'
      ? item.d.kind === 'draft'
        ? PenLine
        : FileText
      : item.kind === 'consultation'
      ? CalendarDays
      : Send;
  const headerTitle =
    item.kind === 'payment'
      ? 'Payment Request'
      : item.kind === 'document'
      ? item.d.kind === 'draft'
        ? 'Draft'
        : 'Document'
      : item.kind === 'consultation'
      ? 'Consultation'
      : 'Message';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
              <HeaderIcon size={18} />
            </span>
            <h3 className="text-base font-bold">{headerTitle}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          {item.kind === 'payment' && (
            <PaymentDetail
              p={item.p}
              canPay={!!onPay && matterClientId != null && matterClientId === meId && !item.p.proof_of_payment_url}
              onPay={() => {
                if (item.kind === 'payment' && onPay) {
                  onClose();
                  onPay(item.p);
                }
              }}
            />
          )}
          {item.kind === 'document' && <DocumentDetail d={item.d} />}
          {item.kind === 'consultation' && <ConsultationDetail c={item.c} />}
          {item.kind === 'message' && (
            <p className="whitespace-pre-wrap break-words text-ink">{item.m.content}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-2 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

function PaymentDetail({
  p,
  canPay,
  onPay,
}: {
  p: Payment;
  canPay: boolean;
  onPay: () => void;
}) {
  const [viewingProof, setViewingProof] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState(false);
  return (
    <div className="space-y-0">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold text-ink">${Number(p.amount).toFixed(2)}</p>
          <p className="text-xs text-muted">{p.currency}</p>
        </div>
        <StatusPill status={p.status} label={p.status_display || p.status} />
      </div>
      <Row label="Purpose">{p.purpose?.replace(/_/g, ' ') || '—'}</Row>
      <Row label="Provider">{p.provider?.replace(/_/g, ' ') || '—'}</Row>
      {p.reference && <Row label="Reference">{p.reference}</Row>}
      <Row label="Created">{new Date(p.created_at).toLocaleString()}</Row>
      <Row label="Proof of payment">
        {p.proof_of_payment_url ? (
          <button
            type="button"
            onClick={() => setViewingProof(true)}
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            <Eye size={12} /> View file
          </button>
        ) : (
          <span className="text-muted">Not yet uploaded</span>
        )}
      </Row>
      <button
        type="button"
        onClick={() => setViewingInvoice(true)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
      >
        <Eye size={14} /> View invoice
      </button>
      {canPay && (
        <button
          onClick={onPay}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
        >
          <Receipt size={16} /> Pay this invoice
        </button>
      )}
      {viewingProof && p.proof_of_payment_url && (
        <FileViewerModal
          url={p.proof_of_payment_url}
          title={`Proof of payment · ${p.purpose?.replace(/_/g, ' ') || 'Payment'}`}
          onClose={() => setViewingProof(false)}
        />
      )}
      {viewingInvoice && (
        <InvoiceViewerModal paymentId={p.id} onClose={() => setViewingInvoice(false)} />
      )}
    </div>
  );
}

function DocumentDetail({ d }: { d: DocumentItem }) {
  return (
    <div className="space-y-0">
      <p className="mb-3 text-base font-semibold text-ink">{d.title}</p>
      <Row label="Kind">{d.kind === 'draft' ? 'Draft' : 'Document'}</Row>
      <Row label="Version">v{d.version}</Row>
      <Row label="Uploader">{d.uploader_detail?.full_name || '—'}</Row>
      <Row label="Created">{new Date(d.created_at).toLocaleString()}</Row>
      {d.file_url && (
        <Row label="File">
          <a href={d.file_url} target="_blank" rel="noreferrer" className="text-brand underline">
            Open
          </a>
        </Row>
      )}
      {d.body && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink/80">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Body</p>
          <p className="whitespace-pre-wrap break-words">{d.body}</p>
        </div>
      )}
    </div>
  );
}

function ConsultationDetail({ c }: { c: Consultation }) {
  return (
    <div className="space-y-0">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">
            {new Date(c.scheduled_time).toLocaleString([], {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-xs text-muted">{c.duration_minutes} min · {c.mode_display}</p>
        </div>
        <StatusPill status={c.status} label={c.status_display || c.status} />
      </div>
      {c.lawyer_detail && <Row label="Lawyer">{c.lawyer_detail.full_name}</Row>}
      {c.client_detail && <Row label="Client">{c.client_detail.full_name}</Row>}
      {c.practice_areas?.length > 0 && <Row label="Areas">{c.practice_areas.join(', ')}</Row>}
      {c.price && <Row label="Price">${Number(c.price).toFixed(2)}</Row>}
      <Row label="Payment">{c.payment_method?.replace(/_/g, ' ') || '—'}</Row>
      {c.confirmed_at && <Row label="Confirmed">{new Date(c.confirmed_at).toLocaleString()}</Row>}
      {c.notes && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink/80">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Notes</p>
          <p className="whitespace-pre-wrap break-words">{c.notes}</p>
        </div>
      )}
    </div>
  );
}

function ConsultationCard({
  c,
  mine,
  grouped,
  onClick,
  onConfirm,
  onReschedule,
  isLawyer,
}: {
  c: Consultation;
  mine: boolean;
  grouped?: boolean;
  onClick?: () => void;
  onConfirm?: (c: Consultation) => void;
  onReschedule?: (c: Consultation) => void;
  isLawyer?: boolean;
}) {
  const when = new Date(c.scheduled_time);
  const isPending = /pending|awaiting/i.test(c.status);
  const canConfirm = isLawyer && isPending && c.status !== 'awaiting_payment';
  const canReschedule = !/cancelled|completed/i.test(c.status);
  return (
    <TimelineCard
      icon={CalendarDays}
      iconTone="bg-sky-50 text-sky-700"
      title="Consultation booked"
      subtitle={
        <>
          {when.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          {c.duration_minutes} min · {c.mode_display}
          {c.price && ` · $${Number(c.price).toFixed(2)}`}
        </>
      }
      status={c.status}
      statusLabel={c.status_display || c.status}
      time={c.scheduled_time}
      mine={mine}
      by={c.client_detail}
      grouped={grouped}
      onClick={onClick}
      action={
        <span className="flex items-center gap-1">
          {canConfirm && onConfirm && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConfirm(c);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500"
              title="Confirm"
            >
              <Check size={11} /> Confirm
            </button>
          )}
          {canReschedule && onReschedule && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReschedule(c);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[10px] font-semibold text-brand-dark hover:border-brand hover:text-brand"
              title="Reschedule"
            >
              <CalendarClock size={11} /> Reschedule
            </button>
          )}
        </span>
      }
    />
  );
}

export default function MatterRoomPage() {
  const params = useParams<{ id: string }>();
  const matterId = Number(params.id);
  const { me, consultations: allConsults, reloadConsultations } = useApp();

  const [matter, setMatter] = useState<Matter | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [pays, setPays] = useState<Payment[]>([]);
  const [times, setTimes] = useState<TimeEntry[]>([]);
  const [revs, setRevs] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [msgPage, setMsgPage] = useState(1);
  const [msgHasMore, setMsgHasMore] = useState(false);
  const [msgLoadingMore, setMsgLoadingMore] = useState(false);

  const docInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const isLawyer = me?.role === 'lawyer';
  const isClient = !!me?.role?.startsWith('client');
  const channelId = matter?.channel_id ?? null;

  const reloadMessages = useCallback(async (cid: number) => {
    // First page (newest 25), reverse to chronological for display.
    const r = await messagesApi.listForChannelPage(cid, 1);
    setMsgs([...r.results].reverse());
    setMsgPage(1);
    setMsgHasMore(!!r.next);
  }, []);
  const loadOlderMessages = useCallback(async () => {
    if (!channelId || !msgHasMore || msgLoadingMore) return;
    setMsgLoadingMore(true);
    try {
      const next = msgPage + 1;
      const r = await messagesApi.listForChannelPage(channelId, next);
      setMsgs((cur) => [...[...r.results].reverse(), ...cur]);
      setMsgPage(next);
      setMsgHasMore(!!r.next);
    } finally {
      setMsgLoadingMore(false);
    }
  }, [channelId, msgPage, msgHasMore, msgLoadingMore]);
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
        reloadConsultations(),
      ]);
      setLoading(false);
    })();
  }, [matterId, reloadMessages, reloadDocs, reloadPays, reloadTimes, reloadReviews, reloadConsultations]);

  async function quickUploadDoc(file: File) {
    try {
      await documentsApi.upload(matterId, file, file.name);
      await reloadDocs();
      setDrawer('media');
      toast.success(`${file.name} added to the matter.`, { title: 'Document uploaded' });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    }
  }

  const [milestoneOpen, setMilestoneOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-line/70" />
          <div className="space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-line/70" />
            <div className="h-2 w-24 animate-pulse rounded bg-line/70" />
          </div>
        </div>
        <div className="flex-1 space-y-3 bg-canvas/40 p-6">
          <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-line/70" />
          <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-line/70" />
          <div className="h-20 w-3/4 animate-pulse rounded-2xl bg-line/70" />
        </div>
      </div>
    );
  }
  if (!matter) return <p className="p-8 text-sm text-muted">Matter not found.</p>;

  const otherParty = isClient
    ? matter.lawyers?.[0]?.full_name ?? 'Lawyer'
    : matter.client?.full_name ?? 'Client';

  const attachActions: AttachAction[] = [
    { key: 'document', label: 'Document', icon: FileUp, onClick: () => docInputRef.current?.click() },
    ...(isLawyer
      ? [{ key: 'milestone', label: 'Milestone', icon: Flag, onClick: () => setMilestoneOpen(true) } as AttachAction]
      : []),
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
        <MessageThread
          timeline={buildTimeline(
            msgs,
            docs,
            pays,
            allConsults.filter((c) => c.matter === matterId)
          )}
          meId={me?.id}
          matterClientId={matter.client?.id}
          channelId={channelId}
          matterId={matterId}
          isLawyer={isLawyer}
          isAdmin={!!me && (me.role === 'admin' || (me as any).is_staff || (me as any).is_superuser)}
          onSent={() => reloadMessages(channelId)}
          onPaymentChange={() => reloadPays()}
          onConsultationChange={() => reloadConsultations()}
          onDocumentChange={() => reloadDocs()}
          attachActions={attachActions}
          hasOlderMessages={msgHasMore}
          loadingOlder={msgLoadingMore}
          onLoadOlder={loadOlderMessages}
        />
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
      {milestoneOpen && channelId && (
        <MilestoneModal
          channelId={channelId}
          onClose={() => setMilestoneOpen(false)}
          onPosted={async () => {
            setMilestoneOpen(false);
            await reloadMessages(channelId);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Timeline (msgs + payments + docs + consults) ---------------- */
function MessageThread({
  timeline,
  meId,
  matterClientId,
  channelId,
  matterId,
  isLawyer,
  isAdmin,
  onSent,
  onPaymentChange,
  onConsultationChange,
  onDocumentChange,
  attachActions,
  hasOlderMessages,
  loadingOlder,
  onLoadOlder,
}: {
  timeline: TimelineItem[];
  meId?: number;
  matterClientId?: number;
  channelId: number;
  matterId: number;
  isLawyer: boolean;
  isAdmin: boolean;
  onSent: () => void;
  onPaymentChange: () => void;
  onConsultationChange: () => void;
  onDocumentChange: () => void;
  attachActions: AttachAction[];
  hasOlderMessages?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<TimelineItem | null>(null);
  const [paying, setPaying] = useState<Payment | null>(null);
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [rescheduling, setRescheduling] = useState<Consultation | null>(null);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Ask once per browser; ignored after first decision.
  useEffect(() => {
    void requestPermissionOnce();
  }, []);

  // Live updates — any chat event triggers a message reload; new messages from
  // someone else also fire a desktop notification when the tab is hidden.
  const wsStatus = useChannelSocket(channelId, (event) => {
    if (event.kind === 'message.created' || event.kind === 'message.reaction') {
      onSent();
    }
    if (event.kind === 'document.created' || event.kind === 'document.updated') {
      onDocumentChange();
    }
    if (event.kind === 'payment.created' || event.kind === 'payment.updated') {
      onPaymentChange();
    }
    if (event.kind === 'message.created' && event.message?.sender?.id !== meId) {
      const senderName = event.message?.sender?.full_name || 'Someone';
      const preview = (event.message?.content || '').slice(0, 120);
      fireNotification(`New message from ${senderName}`, {
        body: preview,
        tag: `matter-${matterId}`,
        onClick: () => {
          /* the page is already loaded; focusing the window is enough */
        },
      });
    }
    if (event.kind === 'document.created' && event.document?.uploader_detail?.id !== meId) {
      const uploader = event.document?.uploader_detail?.full_name || 'Someone';
      fireNotification(`${uploader} uploaded a document`, {
        body: event.document?.title || '',
        tag: `matter-${matterId}-doc`,
      });
    }
  });

  async function toggleReaction(messageId: number, emoji: string) {
    try {
      await messagesApi.react(messageId, emoji);
      onSent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not react.');
    }
  }

  async function approvePayment(p: Payment) {
    const ok = await toast.confirm({
      title: 'Verify payment?',
      body: `$${Number(p.amount).toFixed(2)} ${p.currency} will post to the trust ledger.`,
      confirmLabel: 'Verify',
    });
    if (!ok) return;
    try {
      await paymentsApi.review(p.id, { status: 'verified' });
      onPaymentChange();
      toast.success('Payment verified — funds posted to trust ledger.', { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not verify.');
    }
  }

  async function confirmConsultation(c: Consultation) {
    try {
      await consultationsApi.confirm(c.id);
      onConsultationChange();
      toast.success('Consultation confirmed — both parties notified.', { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not confirm.');
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length]);

  // Optimistically appended pending messages — keyed by negative ids so they
  // never collide with real server ids. WS broadcast removes them once the
  // server-side row arrives.
  const [pending, setPending] = useState<Message[]>([]);
  // Reconcile: drop pending entries whose content now exists in the timeline.
  useEffect(() => {
    if (pending.length === 0) return;
    setPending((cur) =>
      cur.filter(
        (p) =>
          !timeline.some(
            (item) =>
              item.kind === 'message' &&
              item.m.sender.id === p.sender.id &&
              item.m.content === p.content
          )
      )
    );
    // We deliberately depend on timeline length to keep this cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const localId = -Date.now();
    const optimistic: Message = {
      id: localId,
      channel: channelId,
      sender: { id: meId ?? 0, email: '', first_name: '', last_name: '', full_name: 'You', role: '' },
      content: body,
      created_at: new Date().toISOString(),
    } as Message;
    setPending((cur) => [...cur, optimistic]);
    setText('');
    try {
      await messagesApi.send(channelId, body);
      onSent();
    } catch {
      // Restore the input on failure so the user doesn't lose their message.
      setPending((cur) => cur.filter((p) => p.id !== localId));
      setText(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
        <ChatDoodles />
        {wsStatus !== 'connected' && (
          <div className="absolute inset-x-0 top-2 z-20 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              {wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting — new messages may be delayed'}
            </span>
          </div>
        )}
        <div className="absolute inset-0 overflow-y-auto">
          <div className="relative z-10 space-y-2 px-4 py-4 sm:px-8">
          {hasOlderMessages && (
            <div className="mx-auto w-fit">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={loadingOlder}
                className="rounded-full border border-line bg-white/80 px-4 py-1 text-xs font-semibold text-brand-dark shadow-sm hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
              </button>
            </div>
          )}
          {timeline.length === 0 && (
            <p className="mx-auto mt-8 w-fit rounded-full bg-white/80 px-4 py-1.5 text-center text-xs text-muted shadow-sm">
              This is the start of your matter room — no email needed.
            </p>
          )}
          {timeline.map((item, i) => {
            const prev = timeline[i - 1];

            if (item.kind === 'document') {
              const uploaderId = item.d.uploader_detail?.id;
              const mine = uploaderId != null && uploaderId === meId;
              const grouped =
                prev?.kind === 'document' && prev.d.uploader_detail?.id === uploaderId;
              return (
                <DocumentCard
                  key={`d-${item.d.id}`}
                  d={item.d}
                  mine={mine}
                  grouped={grouped}
                  onClick={() => setSelected(item)}
                />
              );
            }
            if (item.kind === 'payment') {
              const mine = matterClientId != null && matterClientId === meId;
              const grouped = prev?.kind === 'payment';
              return (
                <PaymentCard
                  key={`p-${item.p.id}`}
                  p={item.p}
                  mine={mine}
                  by={undefined}
                  grouped={grouped}
                  onClick={() => setSelected(item)}
                  onPay={(pay) => setPaying(pay)}
                  onApprove={(pay) => approvePayment(pay)}
                  onReject={(pay) => setRejecting(pay)}
                  canReview={isLawyer || isAdmin}
                />
              );
            }
            if (item.kind === 'consultation') {
              const clientId = item.c.client_detail?.id;
              const mine = clientId != null && clientId === meId;
              const grouped =
                prev?.kind === 'consultation' && prev.c.client_detail?.id === clientId;
              return (
                <ConsultationCard
                  key={`c-${item.c.id}`}
                  c={item.c}
                  mine={mine}
                  grouped={grouped}
                  onClick={() => setSelected(item)}
                  onConfirm={confirmConsultation}
                  onReschedule={(cc) => setRescheduling(cc)}
                  isLawyer={isLawyer}
                />
              );
            }

            const m = item.m;
            if (m.kind === 'milestone') {
              return (
                <MilestoneDivider
                  key={`m-${m.id}`}
                  label={m.content}
                  by={m.sender.full_name}
                  time={m.created_at}
                />
              );
            }
            const mine = m.sender.id === meId;
            const grouped = prev && prev.kind === 'message' && prev.m.sender.id === m.sender.id;
            return (
              <MessageBubble
                key={`m-${m.id}`}
                m={m}
                mine={mine}
                grouped={grouped}
                meId={meId}
                onReact={(emoji) => toggleReaction(m.id, emoji)}
                onOpenThread={() => setThreadParent(m)}
              />
            );
          })}
          {pending.map((p) => (
            <div key={p.id} className="mt-2 flex justify-end opacity-60">
              <div className="max-w-[78%] rounded-2xl rounded-br-md bg-brand-dark px-3 py-2 text-sm text-white shadow-sm">
                <p className="whitespace-pre-wrap break-words">{p.content}</p>
                <p className="mt-0.5 text-right text-[10px] text-white/60">Sending…</p>
              </div>
            </div>
          ))}
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

      {selected && (
        <DetailModal
          item={selected}
          meId={meId}
          matterClientId={matterClientId}
          onClose={() => setSelected(null)}
          onPay={(pay) => setPaying(pay)}
        />
      )}
      {paying && (
        <PayInvoiceModal
          payment={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            onPaymentChange();
            setPaying(null);
            toast.success('Payment submitted — awaiting verification.', { major: true });
          }}
        />
      )}
      {rejecting && (
        <RejectPaymentModal
          payment={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            onPaymentChange();
            setRejecting(null);
            toast.success('Payment rejected — payer can re-upload.');
          }}
        />
      )}
      {rescheduling && (
        <RescheduleModal
          consultation={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            onConsultationChange();
            setRescheduling(null);
            toast.success('Consultation rescheduled — the other party will re-confirm.', { major: true });
          }}
        />
      )}
      {threadParent && (
        <ThreadModal
          parent={threadParent}
          channelId={channelId}
          meId={meId}
          onClose={() => setThreadParent(null)}
          onChange={() => onSent()}
        />
      )}
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
          {tab === 'time' && <TimePanel matter={matter} isLawyer={isLawyer} items={times} onChange={reloadTimes} />}
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
          {items.map((d) => <DraftRow key={d.id} d={d} onChange={onChange} />)}
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
  const [viewingProof, setViewingProof] = useState(false);
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
        <button
          type="button"
          onClick={() => setViewingProof(true)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
        >
          <Eye size={12} /> View proof of payment
        </button>
      ) : (
        <div className="mt-2 space-y-1">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="block w-full text-[11px] file:mr-2 file:rounded file:border-0 file:bg-brand-light/20 file:px-2 file:py-1 file:text-brand" />
          <button onClick={upload} disabled={busy} className="btn-light w-full py-1 text-xs">
            {busy ? 'Uploading…' : 'Upload proof of payment'}
          </button>
        </div>
      )}
      {viewingProof && payment.proof_of_payment_url && (
        <FileViewerModal
          url={payment.proof_of_payment_url}
          title={`Proof of payment · ${payment.purpose?.replace(/_/g, ' ') || 'Payment'}`}
          onClose={() => setViewingProof(false)}
        />
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
  const toast = useToast();
  const running = useRunningTimer();
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

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
      const r = await timeApi.start(matterId);
      setRunningStore(r);
      toast.success('Timer started.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start timer.');
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!running) return;
    setBusy(true);
    try {
      const stopped = await timeApi.stop(running.id);
      setRunningStore(null);
      setElapsed(0);
      onChange();
      toast.success(`Logged ${stopped.minutes}m · $${stopped.amount ?? '0.00'}.`, { title: 'Timer stopped' });
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
function TimePanel({
  matter,
  isLawyer,
  items,
  onChange,
}: {
  matter: Matter;
  isLawyer: boolean;
  items: TimeEntry[];
  onChange: () => void;
}) {
  const toast = useToast();
  const total = items.reduce((s, e) => s + (e.amount ? Number(e.amount) : 0), 0);
  const minutes = items.reduce((s, e) => s + e.minutes, 0);
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(payload: { matter: number; minutes: number; description: string; started_at?: string }) {
    setBusy(true);
    try {
      await timeApi.log({ ...payload, is_billable: true });
      onChange();
      setLogging(false);
      toast.success(`Logged ${payload.minutes} min on ${matter.title}.`, { major: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not log time.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div>
          <p className="text-xs uppercase text-muted">Billable total</p>
          <p className="text-lg font-bold">${total.toFixed(2)}</p>
        </div>
        <p className="text-sm text-muted">{minutes} min logged</p>
      </div>

      {isLawyer && (
        <button
          type="button"
          onClick={() => setLogging(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-white px-3 py-2 text-xs font-semibold text-brand-dark transition hover:border-brand hover:bg-brand-light/15"
        >
          <Plus size={13} /> Log time on this matter
        </button>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {isLawyer ? 'No time logged yet — use the timer in the header or the button above.' : 'No time logged yet.'}
        </p>
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

      {logging && (
        <LogTimeModal
          matters={[matter]}
          busy={busy}
          onClose={() => setLogging(false)}
          onSubmit={submit}
        />
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

const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

function MessageBubble({
  m,
  mine,
  grouped,
  meId,
  onReact,
  onOpenThread,
}: {
  m: Message;
  mine: boolean;
  grouped?: boolean;
  meId?: number;
  onReact: (emoji: string) => void;
  onOpenThread: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`}>
      {!mine && (
        <div className={`mr-2 h-7 w-7 shrink-0 ${grouped ? 'invisible' : ''}`}>
          <div className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
            {(m.sender.full_name || m.sender.email).split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
          </div>
        </div>
      )}
      <div className={`relative max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`relative rounded-2xl px-3 py-2 text-sm shadow-sm ${
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

          {/* Hover toolbar */}
          <div
            className={`pointer-events-none absolute -top-3 ${
              mine ? 'left-1' : 'right-1'
            } flex items-center gap-0.5 rounded-full border border-line bg-white px-1 py-0.5 opacity-0 shadow-sm transition group-hover:pointer-events-auto group-hover:opacity-100`}
          >
            <button
              type="button"
              onClick={() => setShowPicker((s) => !s)}
              aria-label="React"
              className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-canvas hover:text-ink"
            >
              <Smile size={12} />
            </button>
            <button
              type="button"
              onClick={onOpenThread}
              aria-label="Reply in thread"
              className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-canvas hover:text-ink"
            >
              <MessageCircle size={12} />
            </button>
          </div>
          {showPicker && (
            <div
              className={`absolute z-20 mt-1 ${mine ? 'left-1' : 'right-1'} top-full flex items-center gap-1 rounded-full border border-line bg-white px-1.5 py-1 shadow-lg`}
              onMouseLeave={() => setShowPicker(false)}
            >
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(e);
                    setShowPicker(false);
                  }}
                  className="grid h-7 w-7 place-items-center rounded-full text-sm hover:bg-canvas"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reaction pills */}
        {(m.reactions ?? []).length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
            {m.reactions!.map((r) => {
              const isMine = meId != null && r.user_ids.includes(meId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(r.emoji)}
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                    isMine
                      ? 'border-brand bg-brand-light/15 text-brand-dark'
                      : 'border-line bg-white text-muted hover:border-brand'
                  }`}
                  title={`${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}`}
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Thread reply indicator */}
        {!!m.reply_count && m.reply_count > 0 && (
          <button
            type="button"
            onClick={onOpenThread}
            className={`mt-1 inline-flex items-center gap-1 rounded-full bg-brand-light/15 px-2 py-0.5 text-[11px] font-semibold text-brand-dark hover:bg-brand-light/30 ${mine ? '' : ''}`}
          >
            <MessageCircle size={11} /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
    </div>
  );
}

function ThreadModal({
  parent,
  channelId,
  meId,
  onClose,
  onChange,
}: {
  parent: Message;
  channelId: number;
  meId?: number;
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function refresh() {
    try {
      const r = await messagesApi.replies(parent.id);
      setReplies(r);
    } catch {}
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [parent.id]);

  // Live updates inside the thread.
  useChannelSocket(channelId, (event) => {
    if (event.kind === 'message.created' || event.kind === 'message.reaction') refresh();
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await messagesApi.send(channelId, text.trim(), parent.id);
      setText('');
      await refresh();
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-brand-darker/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
              <MessageCircle size={18} />
            </span>
            <h3 className="text-base font-bold">Thread</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-canvas/40 px-4 py-4">
          <div className="rounded-2xl border border-line bg-white p-3">
            <p className="mb-0.5 text-xs font-semibold text-brand">{parent.sender.full_name}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{parent.content}</p>
            <p className="mt-1 text-[10px] text-muted">
              {new Date(parent.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
            </p>
          </div>
          <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
            <span className="h-px flex-1 bg-line" />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            <span className="h-px flex-1 bg-line" />
          </div>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <div className="space-y-2">
              {replies.map((r) => {
                const mine = r.sender.id === meId;
                return (
                  <div key={r.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      mine ? 'rounded-br-md bg-brand-dark text-white' : 'rounded-bl-md border border-line bg-white text-ink'
                    }`}>
                      {!mine && (
                        <p className="mb-0.5 text-xs font-semibold text-brand">{r.sender.full_name}</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{r.content}</p>
                      <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/60' : 'text-muted'}`}>
                        {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </p>
                    </div>
                  </div>
                );
              })}
              {replies.length === 0 && <p className="text-center text-xs text-muted">No replies yet. Be the first.</p>}
            </div>
          )}
        </div>
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-surface p-3">
          <textarea
            className="field max-h-32 min-h-[44px] resize-none rounded-2xl"
            rows={1}
            placeholder="Reply in thread…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send reply"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-dark text-white transition-colors hover:bg-brand disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Milestone divider (inline in timeline) ---------------- */

function MilestoneDivider({ label, by, time }: { label: string; by: string; time: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <div className="flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/80 shadow-sm">
          <Flag size={11} className="text-brand-dark" />
          {label}
        </span>
        <p className="mt-1 text-[10px] text-muted">
          {by} · {new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
        </p>
      </div>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/* ---------------- Milestone modal ---------------- */

const MILESTONE_PRESETS: { label: string }[] = [
  { label: 'Court application filed' },
  { label: 'Awaiting trial' },
  { label: 'Awaiting ruling' },
  { label: 'Ruling delivered' },
  { label: 'Settlement reached' },
  { label: 'Matter closed' },
];

function MilestoneModal({
  channelId,
  onClose,
  onPosted,
}: {
  channelId: number;
  onClose: () => void;
  onPosted: () => void;
}) {
  const toast = useToast();
  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  const label = preset ?? custom.trim();
  const canPost = label.length > 0 && !busy;

  async function submit() {
    if (!canPost) return;
    setBusy(true);
    try {
      await messagesApi.send(channelId, label, undefined, 'milestone');
      toast.success(`Milestone posted: ${label}.`, { major: true });
      onPosted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not post milestone.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-brand-dark to-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25">
              <Flag size={16} />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight">Post a milestone</h3>
              <p className="text-[11px] text-white/80">Mark the matter&rsquo;s current status in the timeline.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Pick a preset</p>
            <div className="flex flex-wrap gap-2">
              {MILESTONE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setPreset(p.label);
                    setCustom('');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    preset === p.label
                      ? 'border-brand-dark bg-brand-dark text-white'
                      : 'border-line text-muted hover:border-brand hover:text-brand'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">…or write your own</p>
            <input
              className="field text-sm"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setPreset(null);
              }}
              placeholder="e.g. Discovery response served"
              maxLength={160}
            />
          </div>

          <div className="rounded-xl border border-dashed border-line bg-canvas px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Preview</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink/80">
                <Flag size={11} className="text-brand-dark" />
                {label || '—'}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand hover:text-brand"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canPost}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Posting…' : 'Post milestone'}
              {!busy && <Check size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

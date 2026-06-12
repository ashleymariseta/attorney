'use client';

import { CalendarClock, Check, Clock, MessageSquare, ThumbsDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  consultations as consultationsApi,
  documents as documentsApi,
  payments as paymentsApi,
  ApiError,
  type Consultation,
  type DocumentItem,
  type Payment,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useEscape } from '@/lib/useEscape';
import { useAppOptional } from '@/components/AppShell';
import DateField from '@/components/DateField';

export function RejectPaymentModal({
  payment,
  onClose,
  onDone,
}: {
  payment: Payment;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscape(onClose);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await paymentsApi.review(payment.id, { status: 'rejected', review_note: note.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">Reject payment</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-5">
          <p className="text-xs text-muted">
            ${Number(payment.amount).toFixed(2)} {payment.currency}. The payer will be notified and can re-upload.
          </p>
          <label className="label">Reason (optional)</label>
          <textarea
            className="field"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. POP reference doesn't match the bank statement."
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
      </div>
    </div>
  );
}

export function RescheduleModal({
  consultation,
  onClose,
  onDone,
}: {
  consultation: Consultation;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscape(onClose);
  const { me } = useAppOptional();
  const isLawyer = me?.role === 'lawyer';
  const notePlaceholder = isLawyer
    ? 'e.g. Conflict with a court appearance — proposing this new slot.'
    : 'e.g. Something came up at work — can we move it to this time?';
  const [when, setWhen] = useState(consultation.scheduled_time);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const currentDate = new Date(consultation.scheduled_time);
  const newDate = when ? new Date(when) : null;
  const changed = newDate ? newDate.getTime() !== currentDate.getTime() : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!when) {
      setError('Pick a new date and time.');
      return;
    }
    setBusy(true);
    try {
      await consultationsApi.reschedule(consultation.id, new Date(when).toISOString(), note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reschedule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line bg-gradient-to-br from-brand-dark to-brand px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25">
              <CalendarClock size={16} />
            </span>
            <div>
              <h3 className="text-sm font-bold leading-tight">Reschedule consultation</h3>
              <p className="text-[11px] text-white/80">
                {consultation.matter_title} · {consultation.duration_minutes} min · {consultation.mode_display}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 p-4 text-xs">
          {/* Old / new visual */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-canvas p-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Currently</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ink">
                <Clock size={11} className="text-muted" />
                {currentDate.toLocaleString([], {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </p>
            </div>
            <div className={`rounded-lg border p-2.5 ${changed ? 'border-brand bg-brand-light/15' : 'border-dashed border-line bg-canvas'}`}>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-dark">New time</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ink">
                <Clock size={11} className="text-brand-dark" />
                {newDate
                  ? newDate.toLocaleString([], {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '—'}
              </p>
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1 text-[10px]">
              <CalendarClock size={11} /> Pick the new date &amp; time
            </label>
            <DateField mode="datetime" value={when} onChange={setWhen} minuteStep={15} />
            <p className="mt-1 text-[10px] text-muted">The other party will need to re-confirm the new slot.</p>
          </div>

          <div>
            <label className="label flex items-center gap-1 text-[10px]">
              <MessageSquare size={11} /> Note for the other party
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <textarea
              className="field text-xs"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder}
            />
            <p className="mt-0.5 text-right text-[9px] text-muted">{note.length}/500</p>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
            >
              Cancel
            </button>
            <button
              disabled={busy || !changed}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-dark px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Reschedule'}
              {!busy && <Check size={13} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DraftRow({ d, onChange }: { d: DocumentItem; onChange: () => void }) {
  const toast = useToast();
  const [signing, setSigning] = useState(false);
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{d.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-ink/70">{d.body || '(empty)'}</p>
          <p className="mt-2 text-[11px] text-muted">v{d.version} · {d.uploader_detail?.full_name}</p>
        </div>
        {d.signed_at ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Signed
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSigning(true)}
            className="shrink-0 rounded-md bg-brand-dark px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand"
          >
            Sign
          </button>
        )}
      </div>
      {d.signature_data && (
        <div className="mt-2 inline-block rounded border border-line bg-white p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.signature_data} alt="signature" className="h-12 max-w-[240px]" />
        </div>
      )}
      {signing && (
        <SignatureModal
          docId={d.id}
          onClose={() => setSigning(false)}
          onSigned={() => {
            setSigning(false);
            onChange();
            toast.success(`You signed "${d.title}".`, { major: true });
          }}
        />
      )}
    </div>
  );
}

function SignatureModal({
  docId,
  onClose,
  onSigned,
}: {
  docId: number;
  onClose: () => void;
  onSigned: () => void;
}) {
  useEscape(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#082826';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  }

  function clear() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  async function submit() {
    if (!hasInk) return;
    setBusy(true);
    try {
      const dataUrl = canvasRef.current!.toDataURL('image/png');
      await documentsApi.sign(docId, dataUrl);
      onSigned();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">Sign this draft</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-xs text-muted">Draw your signature in the box below. This will be recorded against the matter.</p>
          <div className="rounded-lg border border-dashed border-line bg-white">
            <canvas
              ref={canvasRef}
              width={520}
              height={180}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const ctx = canvasRef.current!.getContext('2d')!;
                const p = pointFromEvent(e);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                setDrawing(true);
              }}
              onPointerMove={(e) => {
                if (!drawing) return;
                const ctx = canvasRef.current!.getContext('2d')!;
                const p = pointFromEvent(e);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                setHasInk(true);
              }}
              onPointerUp={() => setDrawing(false)}
              onPointerLeave={() => setDrawing(false)}
              className="block h-44 w-full touch-none rounded-lg"
            />
          </div>
          <div className="flex items-center justify-between">
            <button type="button" onClick={clear} className="text-xs font-semibold text-muted hover:text-ink">
              Clear
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-brand">
                Cancel
              </button>
              <button onClick={submit} disabled={busy || !hasInk} className="rounded-lg bg-brand-dark px-3 py-2 text-sm font-semibold text-white hover:bg-brand disabled:opacity-50">
                {busy ? 'Saving…' : 'Save signature'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

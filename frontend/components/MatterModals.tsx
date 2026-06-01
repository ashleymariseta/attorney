'use client';

import { CalendarClock, Check, ThumbsDown, X } from 'lucide-react';
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

export function RejectPaymentModal({
  payment,
  onClose,
  onDone,
}: {
  payment: Payment;
  onClose: () => void;
  onDone: () => void;
}) {
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
  const initial = (() => {
    const d = new Date(consultation.scheduled_time);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [when, setWhen] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!when) return;
    setBusy(true);
    try {
      await consultationsApi.reschedule(consultation.id, new Date(when).toISOString());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reschedule.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
              <CalendarClock size={18} />
            </span>
            <h3 className="text-base font-bold">Reschedule consultation</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 p-5">
          <p className="text-xs text-muted">
            Currently {new Date(consultation.scheduled_time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}.
            Pick a new time — the other party will need to re-confirm.
          </p>
          <label className="label">New time</label>
          <input type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} required />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Reschedule'}
            {!busy && <Check size={16} />}
          </button>
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

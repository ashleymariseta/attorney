'use client';

import {
  Banknote,
  Calendar,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Landmark,
  MapPin,
  Phone,
  Receipt,
  ShieldCheck,
  Smartphone,
  Tag,
  Video,
  Wallet,
  WalletCards,
  WalletMinimal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { matters, payments, ApiError, type Lawyer } from '@/lib/api';
import { useAppOptional } from '@/components/AppShell';
import { useToast } from '@/components/Toast';
import { useEscape } from '@/lib/useEscape';

const DURATIONS = [15, 30, 45, 60, 90, 120];

const METHODS: Array<{ value: string; label: string; icon: LucideIcon; sub: string }> = [
  { value: 'video', label: 'Video call', icon: Video, sub: 'Meet on screen' },
  { value: 'phone', label: 'Phone call', icon: Phone, sub: 'Just a call' },
  { value: 'in_person', label: 'In person', icon: MapPin, sub: 'At their office' },
];

const PAY_METHODS: Array<{ value: string; label: string; icon: LucideIcon; sub: string }> = [
  { value: 'ecocash', label: 'EcoCash', icon: Smartphone, sub: 'Mobile money' },
  { value: 'onemoney', label: 'OneMoney', icon: Wallet, sub: 'Mobile money' },
  { value: 'bank', label: 'Bank', icon: Landmark, sub: 'EFT transfer' },
  { value: 'innbucks', label: 'InnBucks', icon: WalletCards, sub: 'Mobile wallet' },
  { value: 'omari', label: "O'mari", icon: WalletMinimal, sub: 'Mobile wallet' },
  { value: 'cash', label: 'Cash', icon: Banknote, sub: 'Pay in person' },
];

const CASHLESS_METHODS = new Set(['ecocash', 'onemoney', 'bank', 'innbucks', 'omari']);

type FormStage = 0 | 1 | 2;
type Step = 'form' | 'pop' | 'done';
const STAGE_LABELS = ['Matter', 'Schedule', 'Payment'] as const;

export default function BookModal({ lawyer, onClose }: { lawyer: Lawyer; onClose: () => void }) {
  const router = useRouter();
  const { reloadMatters, reloadConsultations } = useAppOptional();
  const toast = useToast();
  const onRetainer = lawyer.on_retainer;
  const rate = lawyer.hourly_rate ? Number(lawyer.hourly_rate) : 0;

  useEscape(onClose);
  const [step, setStep] = useState<Step>('form');
  const [stage, setStage] = useState<FormStage>(0);

  const [title, setTitle] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [method, setMethod] = useState('video');
  const [payMethod, setPayMethod] = useState('ecocash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [matterId, setMatterId] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<number | null>(null);

  const availableAreas = lawyer.profile?.practice_areas ?? [];
  const price = useMemo(() => (rate * duration) / 60, [rate, duration]);
  const totalStages = onRetainer ? 1 : 3;

  function toggleArea(a: string) {
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  function canAdvance(): boolean {
    if (stage === 0) return title.trim().length > 0;
    if (stage === 1) return true;
    return true;
  }

  function next() {
    if (!canAdvance()) {
      setError(stage === 0 ? 'Give your matter a short title to continue.' : '');
      return;
    }
    setError('');
    setStage((s) => (Math.min(s + 1, 2) as FormStage));
  }

  function back() {
    setError('');
    setStage((s) => (Math.max(s - 1, 0) as FormStage));
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const backendPayMethod = CASHLESS_METHODS.has(payMethod) ? 'online' : 'cash';
      const noteWithProvider = CASHLESS_METHODS.has(payMethod)
        ? `${PAY_METHODS.find((p) => p.value === payMethod)?.label} — ${description}`.trim()
        : description;
      const m = await matters.create({
        title,
        lawyer: lawyer.id,
        description: noteWithProvider,
        practice_areas: areas,
        duration_minutes: duration,
        consult_method: method,
        payment_method: backendPayMethod,
        scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
      });
      await Promise.all([reloadMatters(), reloadConsultations()]);
      setMatterId(m.id);

      if (onRetainer) {
        toast.success(`Workspace opened with ${lawyer.full_name}.`, { major: true });
        router.push(`/matters/${m.id}`);
        return;
      }
      if (backendPayMethod === 'online' && m.payment_id) {
        setPaymentId(m.payment_id);
        setStep('pop');
        toast.info('Booking saved. Upload your proof of payment to finalize.');
      } else {
        setStep('done');
        toast.success('Booking submitted — awaiting lawyer confirmation.', { major: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the engagement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
              {onRetainer ? <ShieldCheck size={20} /> : <CalendarPlus size={20} />}
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">
                {onRetainer ? 'Open a workspace' : 'Book a consultation'}
              </h2>
              <p className="text-xs text-muted">
                with {lawyer.full_name}
                {!onRetainer && lawyer.hourly_rate && ` · $${lawyer.hourly_rate}/hr`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper */}
        {step === 'form' && !onRetainer && (
          <div className="border-b border-line bg-canvas px-5 py-3">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>
                Step {stage + 1} <span className="text-muted/60">of {totalStages}</span>
              </span>
              <span className="text-brand-dark">{STAGE_LABELS[stage]}</span>
            </div>
            <Stepper current={stage} total={totalStages} />
          </div>
        )}

        {/* FORM */}
        {step === 'form' && (
          <div className="max-h-[70vh] overflow-y-auto p-5">
            {onRetainer && (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-light/30 bg-brand-light/10 px-3 py-3 text-sm">
                <GraduationCap size={18} className="mt-0.5 text-brand-dark" />
                <div className="text-brand-dark">
                  <p className="font-semibold">On your legal team</p>
                  <p className="text-xs text-brand-dark/80">No consultation or payment needed — we&rsquo;ll open the room.</p>
                </div>
              </div>
            )}

            {/* Stage 0 — Matter details */}
            {(onRetainer || stage === 0) && (
              <div className="space-y-4">
                <Field icon={FileText} label="What do you need help with?">
                  <input
                    className="field"
                    required
                    value={title}
                    placeholder="e.g. Review my commercial lease"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>

                {availableAreas.length > 0 && (
                  <Field icon={Tag} label="Practice area(s)" hint="Optional — pick any that apply.">
                    <div className="flex flex-wrap gap-2">
                      {availableAreas.map((a) => {
                        const on = areas.includes(a);
                        return (
                          <button
                            type="button"
                            key={a}
                            onClick={() => toggleArea(a)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                              on
                                ? 'border-brand bg-brand text-white shadow-sm'
                                : 'border-line text-muted hover:border-brand hover:text-brand'
                            }`}
                          >
                            {on && <Check size={12} />}
                            {a}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}

                <Field icon={FileText} label="Details" hint="Optional. The lawyer will see this before the consult.">
                  <textarea
                    className="field"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A short summary helps your lawyer prepare."
                  />
                </Field>
              </div>
            )}

            {/* Stage 1 — Schedule */}
            {!onRetainer && stage === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={Calendar} label="Preferred time">
                    <input
                      className="field"
                      type="datetime-local"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                  </Field>
                  <Field icon={Clock} label="Duration">
                    <select className="field" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {d} min
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div>
                  <label className="label">How would you like to consult?</label>
                  <div className="grid grid-cols-3 gap-2">
                    {METHODS.map((m) => (
                      <OptionTile
                        key={m.value}
                        active={method === m.value}
                        onClick={() => setMethod(m.value)}
                        icon={m.icon}
                        label={m.label}
                        sub={m.sub}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Stage 2 — Payment */}
            {!onRetainer && stage === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="label">Payment method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAY_METHODS.map((p) => (
                      <OptionTile
                        key={p.value}
                        active={payMethod === p.value}
                        onClick={() => setPayMethod(p.value)}
                        icon={p.icon}
                        label={p.label}
                        sub={p.sub}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-canvas p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Summary</p>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <SummaryRow icon={FileText} label="Matter">{title || '—'}</SummaryRow>
                    <SummaryRow icon={Calendar} label="When">
                      {scheduledTime
                        ? new Date(scheduledTime).toLocaleString([], {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Flexible'}
                    </SummaryRow>
                    <SummaryRow icon={Clock} label="Duration">{duration} min</SummaryRow>
                    <SummaryRow icon={METHODS.find((m) => m.value === method)!.icon} label="Mode">
                      {METHODS.find((m) => m.value === method)!.label}
                    </SummaryRow>
                  </dl>
                  <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-3">
                    <span className="text-xs text-muted">{duration} min × ${lawyer.hourly_rate ?? 0}/hr</span>
                    <span className="text-xl font-bold text-ink">${price.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            {/* Actions */}
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={stage === 0 || onRetainer ? onClose : back}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
              >
                {stage === 0 || onRetainer ? null : <ChevronLeft size={16} />}
                {stage === 0 || onRetainer ? 'Cancel' : 'Back'}
              </button>

              {onRetainer || stage === 2 ? (
                <button
                  onClick={submit}
                  disabled={busy || !title.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Starting…' : onRetainer ? 'Open workspace' : 'Confirm booking'}
                  {!busy && <Check size={16} />}
                </button>
              ) : (
                <button
                  onClick={next}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'pop' && paymentId && matterId && (
          <PopStep paymentId={paymentId} amount={price} onDone={() => setStep('done')} />
        )}

        {step === 'done' && (
          <div className="space-y-4 p-7 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200">
              <Check size={26} strokeWidth={2.5} />
            </div>
            <h3 className="text-lg font-bold">Booking submitted</h3>
            <p className="mx-auto max-w-sm text-sm text-muted">
              {payMethod === 'cash'
                ? 'You chose to pay cash in person. '
                : 'Your proof of payment is in review. '}
              We&rsquo;ve notified {lawyer.full_name}. You&rsquo;ll see the status update once they confirm.
            </p>
            <button
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
              onClick={() => matterId && router.push(`/matters/${matterId}`)}
            >
              Go to matter room
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i <= current ? 'bg-brand-dark' : 'bg-line'
          }`}
        />
      ))}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon size={13} className="text-muted" />
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function OptionTile({
  active,
  onClick,
  icon: Icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
        active
          ? 'border-brand bg-brand/5 ring-1 ring-brand'
          : 'border-line bg-white hover:border-brand/40'
      }`}
    >
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
          active ? 'bg-brand text-white' : 'bg-canvas text-muted'
        }`}
      >
        <Icon size={16} />
      </span>
      <span className={`text-xs font-semibold ${active ? 'text-brand-dark' : 'text-ink'}`}>{label}</span>
      <span className="text-[10px] text-muted">{sub}</span>
      {active && (
        <span className="absolute right-2 top-2 text-brand">
          <Check size={14} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs text-muted">
        <Icon size={13} /> {label}
      </span>
      <span className="truncate text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

function PopStep({ paymentId, amount, onDone }: { paymentId: number; amount: number; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState('');
  const [fileName, setFileName] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose your proof of payment file.');
    setBusy(true);
    setError('');
    try {
      await payments.uploadProof(paymentId, file, reference, '');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="space-y-4 p-5">
      <div className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
          <Receipt size={20} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Amount due</p>
          <p className="text-xl font-bold text-ink">${amount.toFixed(2)}</p>
        </div>
      </div>

      <p className="text-sm text-muted">
        Upload your proof of payment to submit this booking.
      </p>

      <Field icon={Receipt} label="Proof of payment">
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm text-muted transition hover:border-brand hover:text-brand">
          <span className="truncate">{fileName || 'Choose a PDF or image…'}</span>
          <span className="rounded-md bg-brand-dark px-3 py-1 text-xs font-semibold text-white">Browse</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          />
        </label>
      </Field>

      <Field icon={Tag} label="Bank reference" hint="Optional, helps with reconciliation.">
        <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Submit proof of payment'}
        {!busy && <Check size={16} />}
      </button>
    </form>
  );
}

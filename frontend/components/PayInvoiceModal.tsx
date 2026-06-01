'use client';

import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Receipt,
  Smartphone,
  Tag,
  Wallet,
  WalletCards,
  WalletMinimal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  matters as mattersApi,
  payments as paymentsApi,
  paymentAccounts as accountsApi,
  type Matter,
  type Payment,
  type PaymentAccount,
} from '@/lib/api';

const PAY_METHODS: Array<{ value: string; label: string; icon: LucideIcon; sub: string }> = [
  { value: 'ecocash', label: 'EcoCash', icon: Smartphone, sub: 'Mobile money' },
  { value: 'onemoney', label: 'OneMoney', icon: Wallet, sub: 'Mobile money' },
  { value: 'bank', label: 'Bank', icon: Landmark, sub: 'EFT transfer' },
  { value: 'innbucks', label: 'InnBucks', icon: WalletCards, sub: 'Mobile wallet' },
  { value: 'omari', label: "O'mari", icon: WalletMinimal, sub: 'Mobile wallet' },
  { value: 'cash', label: 'Cash', icon: Banknote, sub: 'Pay in person' },
];

type Stage = 'method' | 'pop' | 'done';

export default function PayInvoiceModal({
  payment,
  onClose,
  onPaid,
}: {
  payment: Payment;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [stage, setStage] = useState<Stage>('method');
  const [method, setMethod] = useState('ecocash');
  const [reference, setReference] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const isCash = method === 'cash';
  const methodLabel = PAY_METHODS.find((m) => m.value === method)?.label ?? '';

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [matter, setMatter] = useState<Matter | null>(null);
  useEffect(() => {
    accountsApi.forMatter(payment.matter).then((r) => setAccounts(r.results)).catch(() => {});
    mattersApi.get(payment.matter).then(setMatter).catch(() => {});
  }, [payment.matter]);
  const matchingAccounts = accounts.filter((a) => a.account_type === method);
  const payeeLabel = matter?.lawyers?.[0]?.full_name ?? matter?.lawyers?.[0]?.email ?? 'your lawyer';

  function continueFromMethod() {
    setError('');
    if (isCash) {
      setStage('done');
      onPaid();
      return;
    }
    setStage('pop');
  }

  async function submitPop(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose your proof of payment file.');
    setBusy(true);
    setError('');
    try {
      await paymentsApi.uploadProof(payment.id, file, reference, `Paid via ${methodLabel}`);
      setStage('done');
      onPaid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
              <Receipt size={18} />
            </span>
            <h3 className="text-base font-bold">Pay Invoice</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-line bg-canvas px-5 py-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Amount due</p>
              <p className="text-2xl font-bold text-ink">${Number(payment.amount).toFixed(2)}</p>
            </div>
            <p className="text-xs text-muted">
              {payment.currency} · <span className="capitalize">{payment.purpose?.replace(/_/g, ' ') || 'payment'}</span>
            </p>
          </div>
        </div>

        {stage === 'method' && (
          <div className="border-b border-line bg-canvas/40 px-5 py-2">
            <Stepper current={0} total={2} />
          </div>
        )}
        {stage === 'pop' && (
          <div className="border-b border-line bg-canvas/40 px-5 py-2">
            <Stepper current={1} total={2} />
          </div>
        )}

        <div className="p-5">
          {stage === 'method' && (
            <div className="space-y-4">
              <div>
                <label className="label">Payment method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAY_METHODS.map((p) => (
                    <OptionTile
                      key={p.value}
                      active={method === p.value}
                      onClick={() => setMethod(p.value)}
                      icon={p.icon}
                      label={p.label}
                      sub={p.sub}
                    />
                  ))}
                </div>
              </div>

              {matchingAccounts.length > 0 ? (
                <div className="rounded-xl border border-brand-light/30 bg-brand-light/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
                    Pay {payeeLabel} {isCash ? 'in person' : `via ${methodLabel}`}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {matchingAccounts.map((a) => (
                      <li key={a.id} className="rounded-lg border border-line bg-white p-2.5 text-xs">
                        <p className="font-semibold text-ink">
                          {a.identifier}
                          {a.account_name && <span className="ml-1 font-normal text-muted">({a.account_name})</span>}
                        </p>
                        {(a.bank_name || a.branch || a.swift_code) && (
                          <p className="text-[11px] text-muted">
                            {[a.bank_name, a.branch, a.swift_code].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {a.notes && <p className="mt-1 text-[11px] text-muted">{a.notes}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : accounts.length > 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {payeeLabel} doesn&apos;t have {methodLabel} details listed. Pick another method.
                </p>
              ) : null}

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
                >
                  Cancel
                </button>
                <button
                  onClick={continueFromMethod}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
                >
                  {isCash ? 'Confirm cash' : 'Continue'}
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {stage === 'pop' && (
            <form onSubmit={submitPop} className="space-y-4">
              <p className="text-xs text-muted">
                Paying via <span className="font-semibold text-ink">{methodLabel}</span> — upload your proof of payment.
              </p>
              <Field icon={Receipt} label="Proof of payment">
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-line bg-white px-3 py-3 text-sm text-muted hover:border-brand hover:text-brand">
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
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStage('method')}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <button
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
                >
                  {busy ? 'Uploading…' : 'Submit payment'}
                  {!busy && <Check size={16} />}
                </button>
              </div>
            </form>
          )}

          {stage === 'done' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200">
                <Check size={26} strokeWidth={2.5} />
              </div>
              <h3 className="text-lg font-bold">Payment submitted</h3>
              <p className="mx-auto max-w-sm text-sm text-muted">
                {isCash
                  ? 'Pay your lawyer in person — they will confirm receipt.'
                  : 'Your proof of payment is in review.'}
              </p>
              <button
                onClick={onClose}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i <= current ? 'bg-brand-dark' : 'bg-line'}`}
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
        active ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white hover:border-brand/40'
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

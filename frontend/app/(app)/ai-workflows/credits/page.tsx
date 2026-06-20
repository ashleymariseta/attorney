'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Coins, FileUp, Loader2, Sparkles, Upload } from 'lucide-react';
import {
  aiCredits,
  ApiError,
  type AiCreditAccount,
  type AiCreditOrder,
  type AiCreditPlan,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { SkeletonCard } from '@/components/Skeleton';

const METHODS = ['ecocash', 'innbucks', 'bank', 'cash', 'other'];

function fmt(n: number) {
  return n.toLocaleString();
}

export default function AiCreditsPage() {
  const toast = useToast();
  const [account, setAccount] = useState<AiCreditAccount | null>(null);
  const [plans, setPlans] = useState<AiCreditPlan[]>([]);
  const [orders, setOrders] = useState<AiCreditOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<AiCreditPlan | null>(null);

  async function reload() {
    const [acc, pl, ord] = await Promise.all([
      aiCredits.account(),
      aiCredits.plans(),
      aiCredits.orders(),
    ]);
    setAccount(acc);
    setPlans(pl.results);
    setOrders(ord.results);
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not load AI credits.');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold">AI Credits</h1>
        <p className="mt-1 text-sm text-muted">
          AI Workflows and AI-Researcher draw from your credit balance. Buy a pack, upload your
          proof of payment, and we&rsquo;ll unlock the credits once it&rsquo;s verified.
        </p>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <SkeletonCard className="h-28" />
          <SkeletonCard className="h-28" />
        </div>
      ) : (
        <>
          {/* Balance */}
          <div className="mt-6 rounded-2xl border border-line bg-gradient-to-br from-brand-dark to-brand p-5 text-white shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80">
                <Coins size={14} /> Credit balance
              </div>
              {account?.is_free_tier ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Free tier
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  <Check size={11} /> Paid plan
                </span>
              )}
            </div>
            <div className="mt-1 text-3xl font-bold">{fmt(account?.balance ?? 0)}<span className="ml-1 text-base font-medium text-white/80">credits</span></div>
            <p className="mt-1 text-xs text-white/80">
              {account?.owner_label} · {fmt(account?.lifetime_granted ?? 0)} granted · {fmt(account?.lifetime_spent ?? 0)} spent
            </p>
            {account?.is_free_tier && (
              <p className="mt-2 text-xs text-white/90">
                You&rsquo;re on the <strong>free tier</strong>
                {(account?.free_tier_credits ?? 0) > 0 ? ` (${fmt(account.free_tier_credits)} free credits)` : ''}.
                Buy a pack below to top up.
              </p>
            )}
          </div>

          {/* Plans */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Credit packs</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <div key={p.id} className="flex flex-col rounded-xl border border-line bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-dark">{p.name}</p>
                <div className="mt-1 text-2xl font-bold">
                  {p.currency} {Number(p.price).toFixed(2)}
                </div>
                <p className="mt-0.5 text-xs text-muted">{p.period_display}</p>
                <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles size={14} className="text-brand-dark" /> {fmt(p.token_credits)} credits
                </p>
                {p.description && <p className="mt-1 text-xs text-muted">{p.description}</p>}
                <button onClick={() => setBuying(p)} className="btn-primary mt-4 w-full justify-center">
                  <FileUp size={14} /> Buy
                </button>
              </div>
            ))}
            {plans.length === 0 && (
              <p className="text-sm text-muted">No credit packs are available right now.</p>
            )}
          </div>

          {/* Orders */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Your purchases</h2>
          {orders.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No purchases yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Pack</th>
                    <th className="px-4 py-2 font-medium text-right">Credits</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-4 py-2 text-muted">{new Date(o.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2">{o.plan_name || '—'}</td>
                      <td className="px-4 py-2 text-right">{fmt(o.token_credits)}</td>
                      <td className="px-4 py-2 text-right">{o.currency} {Number(o.amount).toFixed(2)}</td>
                      <td className="px-4 py-2">
                        <StatusPill status={o.status} label={o.status_display} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent ledger */}
          {account && account.transactions.length > 0 && (
            <>
              <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Recent activity</h2>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
                {account.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-muted">
                      {new Date(t.created_at).toLocaleDateString()} · {t.kind_display}
                      {t.note ? ` · ${t.note}` : ''}
                    </span>
                    <span className={t.amount >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                      {t.amount >= 0 ? '+' : ''}{fmt(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {buying && (
        <BuyModal
          plan={buying}
          onClose={() => setBuying(null)}
          onDone={async () => {
            setBuying(null);
            try {
              await reload();
            } catch {}
            toast.success('Proof of payment submitted — credits unlock once an admin verifies it.', { major: true });
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status, label }: { status: AiCreditOrder['status']; label: string }) {
  const cls =
    status === 'verified'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'rejected' || status === 'cancelled'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-amber-50 text-amber-700';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status === 'verified' && <Check size={11} />}{label}</span>;
}

function BuyModal({ plan, onClose, onDone }: { plan: AiCreditPlan; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) {
      toast.error('Attach your proof of payment first.');
      return;
    }
    setBusy(true);
    try {
      await aiCredits.createOrder({ plan: plan.id, file, reference, method, note });
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not submit your order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Buy {plan.name}</h3>
        <p className="mt-1 text-sm text-muted">
          {plan.currency} {Number(plan.price).toFixed(2)} · {fmt(plan.token_credits)} credits. Pay via your usual
          method, then upload the proof below.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted">Proof of payment</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-brand"
            >
              <Upload size={15} /> {file ? file.name : 'Choose a PDF or image…'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm capitalize"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m} className="capitalize">{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted">Reference</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Txn ref"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            {busy ? 'Submitting…' : 'Submit proof'}
          </button>
        </div>
      </div>
    </div>
  );
}

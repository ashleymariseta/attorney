'use client';

import { useEffect, useState } from 'react';
import { type LucideIcon, Landmark, Clock, Receipt } from 'lucide-react';
import { transactions as txApi, type Transaction } from '@/lib/api';
import { DecoIcon } from '@/components/Banner';

const STATUS_STYLE: Record<string, string> = {
  verified: 'badge-teal',
  completed: 'badge-teal',
  pending_review: 'bg-amber-100 text-amber-800 badge',
  pending: 'bg-amber-100 text-amber-800 badge',
  rejected: 'bg-red-100 text-red-700 badge',
  failed: 'bg-red-100 text-red-700 badge',
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [escrow, setEscrow] = useState('0');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await txApi.list();
      setItems(res.results);
      setEscrow(res.total_escrow);
      setLoading(false);
    })();
  }, []);

  const totalPending = items
    .filter((i) => i.status.includes('pending'))
    .reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Transactions</h1>
      <p className="text-sm text-muted">Every payment and trust-ledger movement across your matters.</p>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="In escrow (trust)" value={`$${escrow}`} icon={Landmark} />
        <Stat label="Pending review" value={`$${totalPending.toFixed(2)}`} icon={Clock} />
        <Stat label="Transactions" value={items.length} icon={Receipt} />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Matter</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="hidden px-4 py-3 sm:table-cell">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No transactions yet.</td></tr>
            )}
            {items.map((t) => (
              <tr key={t.id} className="hover:bg-canvas/60">
                <td className="px-4 py-3 font-medium">{t.matter_title}</td>
                <td className="px-4 py-3">
                  <span className="text-muted">{t.kind === 'trust' ? 'Trust' : 'Payment'} · </span>
                  {t.label}
                </td>
                <td className="px-4 py-3">
                  <span className={STATUS_STYLE[t.status] ?? 'badge-muted'}>{t.status_display}</span>
                </td>
                <td className="px-4 py-3 text-right font-semibold">${t.amount}</td>
                <td className="hidden px-4 py-3 text-muted sm:table-cell">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: LucideIcon }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card sm:p-5">
      {icon && <DecoIcon icon={icon} className="hidden sm:block" />}
      <div className="relative z-10">
        <p className="text-[10px] uppercase tracking-wide text-muted sm:text-xs">{label}</p>
        <p className="mt-0.5 text-base font-bold sm:mt-1 sm:text-2xl">{value}</p>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  KeyRound,
  Server,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { llmUsage, type LlmUsageRow, type LlmUsageSummary } from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';

function format(n: number): string {
  return n.toLocaleString();
}

function pct(used: number, quota: number): number {
  if (!quota) return 0;
  return Math.min(100, Math.round((used / quota) * 100));
}

export default function LlmUsagePage() {
  const { me } = useApp();
  const isAdmin = !!(me?.is_staff || me?.role === 'admin');
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = isAdmin ? await llmUsage.list() : await llmUsage.me();
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load usage.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    if (!term) return data.results;
    return data.results.filter((r) =>
      [r.full_name, r.email, r.role].join(' ').toLowerCase().includes(term)
    );
  }, [data, query]);

  const totals = useMemo(() => {
    if (!data) return { pool: 0, byok: 0, users: 0, overQuota: 0 };
    let pool = 0;
    let byok = 0;
    let overQuota = 0;
    for (const r of data.results) {
      pool += r.pool_tokens;
      byok += r.byok_tokens;
      if (r.pool_tokens >= r.monthly_quota && r.monthly_quota > 0) overQuota += 1;
    }
    return { pool, byok, users: data.results.length, overQuota };
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">LLM usage</h1>
          <p className="text-sm text-muted">
            {isAdmin
              ? 'Per-tenant attribution across the platform pool key and any BYOK configurations.'
              : 'Your own current-month spend on the platform pool and any keys you’ve added.'}
          </p>
        </div>
        <p className="text-xs text-muted">
          {data
            ? `Since ${new Date(data.month_start).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
            : ''}
        </p>
      </div>

      {/* Pool config strip */}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <PoolStatusCard label="Anthropic pool" configured={data.pool_configured.anthropic} icon={Sparkles} />
          <PoolStatusCard label="OpenAI pool" configured={data.pool_configured.openai} icon={Sparkles} />
          <PoolStatusCard label="Local pool" configured={data.pool_configured.local} icon={Server} />
          <Stat
            label="Defaults"
            value={`${format(data.defaults.monthly_quota)} tk`}
            sub={`${data.defaults.rate_limit_per_minute}/min`}
            icon={ShieldCheck}
          />
        </div>
      )}

      {/* Summary tiles (admin only) */}
      {isAdmin && data && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <Stat label="Active users" value={totals.users} icon={KeyRound} />
          <Stat label="Pool tokens" value={format(totals.pool)} icon={Banknote} />
          <Stat label="BYOK tokens" value={format(totals.byok)} icon={Wallet} />
          <Stat
            label="Over quota"
            value={totals.overQuota}
            sub="users"
            tone={totals.overQuota > 0 ? 'amber' : undefined}
            icon={AlertTriangle}
          />
        </div>
      )}

      {/* Search */}
      {isAdmin && (
        <div className="mt-6 max-w-sm">
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lawyer by name, email, role…"
          />
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        {loading ? (
          <div className="p-4">
            <SkeletonCard className="h-16" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-red-700">{error}</p>
        ) : !data || filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">
            No LLM activity this month yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-canvas text-[10px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3">Pool usage</th>
                  <th className="px-4 py-3 text-right">BYOK tokens</th>
                  <th className="px-4 py-3 text-right">Rate / min</th>
                  <th className="px-4 py-3 text-left">Last call</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Row key={r.user_id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ r }: { r: LlmUsageRow }) {
  const pctUsed = pct(r.pool_tokens, r.monthly_quota);
  const overUsed = pctUsed >= 100;
  return (
    <tr className="border-t border-line align-middle">
      <td className="px-4 py-3">
        <p className="font-semibold text-ink">{r.full_name}</p>
        <p className="text-[11px] text-muted">{r.email}</p>
      </td>
      <td className="px-4 py-3 text-xs capitalize text-muted">{r.role || '—'}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full ${overUsed ? 'bg-red-500' : pctUsed >= 80 ? 'bg-amber-500' : 'bg-brand-dark'}`}
              style={{ width: `${pctUsed}%` }}
            />
          </div>
          <span className={`font-semibold ${overUsed ? 'text-red-700' : 'text-ink'}`}>
            {format(r.pool_tokens)}
            <span className="text-muted"> / {format(r.monthly_quota)}</span>
          </span>
        </div>
        {r.pool_disabled && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
            <XCircle size={10} /> pool disabled
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-ink">{format(r.byok_tokens)}</td>
      <td className="px-4 py-3 text-right text-xs text-muted">{r.rate_limit_per_minute}/min</td>
      <td className="px-4 py-3 text-xs text-muted">
        {r.last_used ? new Date(r.last_used).toLocaleString() : '—'}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof KeyRound;
  tone?: 'amber';
}) {
  const valueColor = tone === 'amber' ? 'text-amber-700' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={11} /> {label}
      </div>
      <p className={`mt-1 text-lg font-bold sm:text-xl ${valueColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

function PoolStatusCard({
  label,
  configured,
  icon: Icon,
}: {
  label: string;
  configured: boolean;
  icon: typeof Sparkles;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={11} /> {label}
      </div>
      <p
        className={`mt-1 inline-flex items-center gap-1 text-sm font-bold ${
          configured ? 'text-emerald-700' : 'text-muted'
        }`}
      >
        {configured ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        {configured ? 'Active' : 'Not set'}
      </p>
    </div>
  );
}

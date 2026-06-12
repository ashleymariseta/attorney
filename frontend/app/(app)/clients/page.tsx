'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowUpRight,
  Banknote,
  Briefcase,
  CalendarClock,
  Clock,
  Crown,
  Eye,
  Mail,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  matters as mattersApi,
  lawyerClients as lawyerClientsApi,
  type LawyerClient,
  type LawyerClientDetail,
} from '@/lib/api';
import { SkeletonCard } from '@/components/Skeleton';
import FileViewerModal from '@/components/FileViewerModal';
import { useEscape } from '@/lib/useEscape';

type SortKey = 'name' | 'matters' | 'outstanding' | 'invoiced' | 'last_activity';

function money(value?: string | number | null) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '$0';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<LawyerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await mattersApi.lawyerClients();
        setClients(res.results);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = term
      ? clients.filter((c) =>
          [c.full_name, c.email, c.phone_number || '', c.whatsapp_number || '']
            .join(' ')
            .toLowerCase()
            .includes(term)
        )
      : [...clients];
    list.sort((a, b) => {
      switch (sort) {
        case 'matters':
          return (b.matters_count ?? 0) - (a.matters_count ?? 0);
        case 'outstanding':
          return Number(b.outstanding_total || 0) - Number(a.outstanding_total || 0);
        case 'invoiced':
          return Number(b.invoiced_total || 0) - Number(a.invoiced_total || 0);
        case 'last_activity':
          return (
            new Date(b.last_consultation_at || 0).getTime() -
            new Date(a.last_consultation_at || 0).getTime()
          );
        default:
          return a.full_name.localeCompare(b.full_name);
      }
    });
    return list;
  }, [clients, query, sort]);

  const stats = useMemo(() => {
    const retainerCount = clients.filter((c) => c.relationship === 'retainer').length;
    const totalOutstanding = clients.reduce((s, c) => s + Number(c.outstanding_total || 0), 0);
    const totalInvoiced = clients.reduce((s, c) => s + Number(c.invoiced_total || 0), 0);
    return {
      total: clients.length,
      retainer: retainerCount,
      outstanding: totalOutstanding,
      invoiced: totalInvoiced,
    };
  }, [clients]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted">
            Your book of business — every client you&rsquo;ve worked with, their contact details and outstanding balance.
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
        <Stat label="Clients" value={stats.total} icon={Users} />
        <Stat label="On retainer" value={stats.retainer} sub="active" icon={ShieldCheck} />
        <Stat label="Outstanding" value={money(stats.outstanding)} icon={Wallet} tone="amber" />
        <Stat label="Invoiced (lifetime)" value={money(stats.invoiced)} icon={Banknote} />
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field pl-9"
            placeholder="Search by name, email, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="field max-w-[200px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="name">Sort · Name</option>
          <option value="matters">Sort · Most matters</option>
          <option value="outstanding">Sort · Outstanding (desc)</option>
          <option value="invoiced">Sort · Invoiced (desc)</option>
          <option value="last_activity">Sort · Last activity</option>
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        {loading ? (
          <div className="p-4">
            <SkeletonCard className="h-16" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-ink">No clients yet</p>
            <p className="mt-1 text-xs text-muted">
              Clients appear here once you create a matter for them or accept a retainer.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-canvas text-[10px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-right">Matters</th>
                  <th className="px-4 py-3 text-right">Invoiced</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-left">Last activity</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t border-line align-middle hover:bg-canvas/60"
                    onClick={() => setSelectedId(c.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-light/30 text-xs font-bold text-brand-dark">
                          {c.avatar_url ? (
                            <Image src={c.avatar_url} alt={c.full_name} width={36} height={36} className="h-9 w-9 object-cover" />
                          ) : (
                            (c.first_name?.[0] || '?') + (c.last_name?.[0] || '')
                          )}
                        </span>
                        <div>
                          <p className="flex items-center gap-1.5 font-semibold text-ink">
                            {c.full_name}
                            {c.relationship === 'retainer' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-brand-dark/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-dark">
                                <Crown size={9} /> Retainer
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.phone_number || '—'}
                      {c.whatsapp_number && c.whatsapp_number !== c.phone_number && (
                        <>
                          <br /> <span className="text-emerald-600">WhatsApp: {c.whatsapp_number}</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold">{c.matters_count ?? 0}</p>
                      <p className="text-[10px] text-muted">{c.active_matters_count ?? 0} active</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{money(c.invoiced_total)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${Number(c.outstanding_total || 0) > 0 ? 'text-amber-700' : 'text-muted'}`}>
                      {money(c.outstanding_total)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.last_consultation_at
                        ? new Date(c.last_consultation_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(c.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
                        title="View detail"
                      >
                        <Eye size={11} /> Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId != null && (
        <ClientDetailDrawer clientId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
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
  icon: typeof Users;
  tone?: 'amber';
}) {
  const accent = tone === 'amber' ? 'text-amber-700' : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={11} /> {label}
      </div>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${accent}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

/* ---------------------- Detail drawer ---------------------- */

type Tab = 'overview' | 'matters' | 'invoices' | 'consultations';

function ClientDetailDrawer({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [data, setData] = useState<LawyerClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [viewingProof, setViewingProof] = useState<{ url: string; title: string } | null>(null);
  useEscape(onClose);

  useEffect(() => {
    (async () => {
      try {
        const d = await lawyerClientsApi.detail(clientId);
        setData(d);
      } catch {}
      setLoading(false);
    })();
  }, [clientId]);

  const summary = data?.summary;
  const c = data?.client;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line bg-gradient-to-br from-brand-dark to-brand px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 ring-1 ring-inset ring-white/25">
              {c?.avatar_url ? (
                <Image src={c.avatar_url} alt={c.full_name} width={48} height={48} className="h-12 w-12 object-cover" />
              ) : (
                <span className="text-sm font-bold text-white">
                  {(c?.first_name?.[0] || '?') + (c?.last_name?.[0] || '')}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold leading-tight">{c?.full_name ?? 'Loading…'}</h2>
              <p className="truncate text-xs text-white/80">{c?.email ?? ''}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading || !data ? (
            <div className="p-5">
              <SkeletonCard className="h-40" />
            </div>
          ) : (
            <>
              {/* Stat strip */}
              <div className="grid grid-cols-2 gap-2 border-b border-line bg-canvas/50 p-4 sm:grid-cols-4">
                <DrawerStat
                  label="Matters"
                  value={`${summary?.matters_count ?? 0}`}
                  sub={`${summary?.active_matters_count ?? 0} active`}
                />
                <DrawerStat label="Invoiced" value={money(summary?.invoiced_total)} />
                <DrawerStat
                  label="Outstanding"
                  value={money(summary?.outstanding_total)}
                  tone={Number(summary?.outstanding_total || 0) > 0 ? 'amber' : 'default'}
                />
                <DrawerStat label="Paid" value={money(summary?.paid_total)} />
              </div>

              {/* Contact card */}
              <div className="border-b border-line bg-white p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Contact</p>
                <div className="grid gap-1.5 text-sm">
                  <ContactLine
                    icon={Mail}
                    label="Email"
                    value={c?.email}
                    href={c?.email ? `mailto:${c.email}` : undefined}
                  />
                  <ContactLine
                    icon={Phone}
                    label="Phone"
                    value={c?.phone_number}
                    href={c?.phone_number ? `tel:${c.phone_number}` : undefined}
                  />
                  {c?.whatsapp_number && (
                    <ContactLine
                      icon={MessageCircle}
                      label="WhatsApp"
                      value={c.whatsapp_number}
                      href={`https://wa.me/${c.whatsapp_number.replace(/[^0-9]/g, '')}`}
                    />
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="border-b border-line bg-white px-4">
                <div className="flex gap-1 overflow-x-auto">
                  {(['overview', 'matters', 'invoices', 'consultations'] as Tab[]).map((t) => {
                    const counts: Record<Tab, number> = {
                      overview: 0,
                      matters: data.matters.length,
                      invoices: data.payments.length,
                      consultations: data.consultations.length,
                    };
                    return (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold capitalize transition ${
                          tab === t ? 'border-brand-dark text-brand-dark' : 'border-transparent text-muted hover:text-ink'
                        }`}
                      >
                        {t}
                        {t !== 'overview' && (
                          <span className={`rounded-full px-1.5 text-[10px] font-bold ${
                            tab === t ? 'bg-brand-dark text-white' : 'bg-canvas text-muted'
                          }`}>{counts[t]}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab body */}
              <div className="space-y-3 p-4">
                {tab === 'overview' && <OverviewTab data={data} onSwitch={setTab} />}
                {tab === 'matters' && <MattersTab data={data} />}
                {tab === 'invoices' && (
                  <InvoicesTab data={data} onView={(p) => p.proof_of_payment_url && setViewingProof({ url: p.proof_of_payment_url, title: `Proof of payment · ${p.matter_title}` })} />
                )}
                {tab === 'consultations' && <ConsultationsTab data={data} />}
              </div>
            </>
          )}
        </div>
      </div>

      {viewingProof && (
        <FileViewerModal url={viewingProof.url} title={viewingProof.title} onClose={() => setViewingProof(null)} />
      )}
    </div>
  );
}

function DrawerStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'amber' | 'default';
}) {
  const accent = tone === 'amber' ? 'text-amber-700' : 'text-ink';
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${accent}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

function ContactLine({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value?: string;
  href?: string;
}) {
  if (!value) return null;
  const Inner = (
    <span className="inline-flex items-center gap-2 truncate">
      <Icon size={13} className="text-muted" /> <span className="truncate">{value}</span>
    </span>
  );
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      {href ? (
        <a href={href} className="truncate font-semibold text-brand-dark hover:underline" target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {Inner}
        </a>
      ) : (
        <span className="truncate text-ink">{Inner}</span>
      )}
    </div>
  );
}

function OverviewTab({ data, onSwitch }: { data: LawyerClientDetail; onSwitch: (t: Tab) => void }) {
  const latestMatter = data.matters[0];
  const nextConsult = data.consultations.find(
    (c) => new Date(c.scheduled_time).getTime() >= Date.now() && c.status !== 'cancelled'
  );
  const pendingInvoices = data.payments.filter((p) => p.status !== 'verified' && p.status !== 'rejected');
  return (
    <>
      {latestMatter ? (
        <Section icon={Briefcase} title="Latest matter">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{latestMatter.title}</p>
              <p className="text-xs text-muted">{new Date(latestMatter.created_at).toLocaleDateString()} · {latestMatter.status}</p>
            </div>
            <Link
              href={`/matters/${latestMatter.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
            >
              Open <ArrowUpRight size={12} />
            </Link>
          </div>
        </Section>
      ) : (
        <Section icon={Briefcase} title="No matters yet">
          <p className="text-xs text-muted">Open a matter from this client&rsquo;s contact card to get started.</p>
        </Section>
      )}

      {nextConsult && (
        <Section icon={CalendarClock} title="Next consultation">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{nextConsult.matter_title}</p>
              <p className="text-xs text-muted">
                {new Date(nextConsult.scheduled_time).toLocaleString([], {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}{' '}
                · {nextConsult.mode_display}
              </p>
            </div>
            <span className="badge-teal capitalize">{nextConsult.status_display}</span>
          </div>
        </Section>
      )}

      {pendingInvoices.length > 0 && (
        <Section icon={Wallet} title={`${pendingInvoices.length} outstanding invoice${pendingInvoices.length === 1 ? '' : 's'}`}>
          <button
            onClick={() => onSwitch('invoices')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-dark hover:underline"
          >
            Review them <ArrowUpRight size={12} />
          </button>
        </Section>
      )}
    </>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Briefcase;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <Icon size={11} /> {title}
      </p>
      {children}
    </div>
  );
}

function MattersTab({ data }: { data: LawyerClientDetail }) {
  if (data.matters.length === 0) {
    return <p className="text-xs text-muted">No matters yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {data.matters.map((m) => (
        <li key={m.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/matters/${m.id}`} className="block truncate font-semibold text-ink hover:text-brand-dark">
                {m.title}
              </Link>
              <p className="mt-0.5 text-[11px] text-muted">
                {new Date(m.created_at).toLocaleDateString()} · {m.practice_area || 'general'} · {m.billing_model}
              </p>
            </div>
            <span className="badge-muted capitalize">{m.status}</span>
          </div>
          {m.description && <p className="mt-2 line-clamp-2 text-xs text-ink/80">{m.description}</p>}
        </li>
      ))}
    </ul>
  );
}

function InvoicesTab({
  data,
  onView,
}: {
  data: LawyerClientDetail;
  onView: (p: LawyerClientDetail['payments'][number]) => void;
}) {
  if (data.payments.length === 0) {
    return <p className="text-xs text-muted">No invoices yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {data.payments.map((p) => {
        const tone =
          p.status === 'verified'
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : p.status === 'rejected'
            ? 'bg-red-50 text-red-700 ring-red-200'
            : 'bg-amber-50 text-amber-800 ring-amber-200';
        return (
          <li key={p.id} className="rounded-xl border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">${Number(p.amount).toFixed(2)} {p.currency}</p>
                <p className="text-[11px] text-muted">
                  INV-{String(p.id).padStart(5, '0')} · {p.matter_title}
                </p>
                <p className="mt-0.5 text-[11px] capitalize text-muted">
                  {p.purpose?.replace(/_/g, ' ')} · {new Date(p.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${tone}`}>
                  {p.status_display}
                </span>
                {p.proof_of_payment_url && (
                  <button
                    onClick={() => onView(p)}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-[10px] font-semibold text-ink hover:border-brand"
                  >
                    <Eye size={10} /> POP
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ConsultationsTab({ data }: { data: LawyerClientDetail }) {
  if (data.consultations.length === 0) {
    return <p className="text-xs text-muted">No consultations yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {data.consultations.map((c) => (
        <li key={c.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{c.matter_title}</p>
              <p className="text-[11px] text-muted">
                <Clock size={10} className="-mt-0.5 mr-1 inline" />
                {new Date(c.scheduled_time).toLocaleString([], {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}{' '}
                · {c.duration_minutes} min · {c.mode_display}
              </p>
            </div>
            <span className="badge-muted capitalize">{c.status_display}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

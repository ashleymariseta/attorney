'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/components/AppShell';
import { DecoIcon } from '@/components/Banner';
import TimeTracker from '@/components/TimeTracker';
import { useToast } from '@/components/Toast';
import InvoiceViewerModal from '@/components/InvoiceViewerModal';
import {
  payments as paymentsApi,
  timeEntries as timeApi,
  ApiError,
  type Matter,
  type Payment,
  type TimeEntry,
} from '@/lib/api';

type Range = 'all' | '7d' | '30d';
type InvoiceStatus = 'all' | 'paid' | 'pending' | 'rejected';
type Tab = 'by_matter' | 'invoices';

const PAGE_SIZE = 10;

export default function BillablesPage() {
  const router = useRouter();
  const toast = useToast();
  const { me, matters } = useApp();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [invoices, setInvoices] = useState<Payment[]>([]);
  const [range, setRange] = useState<Range>('30d');
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>('all');
  const [matterFilter, setMatterFilter] = useState<number | 'all'>('all');
  const [tab, setTab] = useState<Tab>('by_matter');
  const [byMatterPage, setByMatterPage] = useState(1);
  const [invoicesPage, setInvoicesPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [downloading, setDownloading] = useState<number | null>(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState<number | null>(null);

  useEffect(() => {
    if (me && me.role !== 'lawyer') router.replace('/dashboard');
  }, [me, router]);

  async function refresh() {
    try {
      setEntries((await timeApi.all()).results);
    } catch {}
    try {
      setInvoices((await paymentsApi.list({ purpose: 'invoice' })).results);
    } catch {}
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setByMatterPage(1);
  }, [range, matterFilter]);

  useEffect(() => {
    setInvoicesPage(1);
  }, [range, matterFilter, invoiceStatus]);

  const matterTitleById = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of matters) map.set(m.id, m.title);
    return map;
  }, [matters]);

  const cutoff = useMemo(
    () => (range === 'all' ? 0 : Date.now() - (range === '7d' ? 7 : 30) * 864e5),
    [range]
  );

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (range !== 'all' && +new Date(e.started_at) < cutoff) return false;
      if (matterFilter !== 'all' && e.matter !== matterFilter) return false;
      return true;
    });
  }, [entries, range, matterFilter, cutoff]);

  const grouped = useMemo(() => {
    const map = new Map<
      number,
      {
        matter_id: number;
        matter_title: string;
        entries: TimeEntry[];
        minutes: number;
        amount: number;
        // The slice that hasn't been rolled into an invoice yet — drives
        // the "Generate invoice" button so a fresh invoice never double-bills.
        uninvoiced_minutes: number;
        uninvoiced_amount: number;
      }
    >();
    for (const e of filteredEntries) {
      const g = map.get(e.matter) ?? {
        matter_id: e.matter,
        matter_title: e.matter_title,
        entries: [],
        minutes: 0,
        amount: 0,
        uninvoiced_minutes: 0,
        uninvoiced_amount: 0,
      };
      g.entries.push(e);
      g.minutes += e.minutes || 0;
      g.amount += e.amount ? Number(e.amount) : 0;
      if (e.invoice == null) {
        g.uninvoiced_minutes += e.minutes || 0;
        g.uninvoiced_amount += e.amount ? Number(e.amount) : 0;
      }
      map.set(e.matter, g);
    }
    return Array.from(map.values()).sort((a, b) => b.uninvoiced_amount - a.uninvoiced_amount);
  }, [filteredEntries]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (range !== 'all' && +new Date(inv.created_at) < cutoff) return false;
      if (matterFilter !== 'all' && inv.matter !== matterFilter) return false;
      if (invoiceStatus !== 'all') {
        const s = inv.status;
        if (invoiceStatus === 'paid' && s !== 'verified') return false;
        if (invoiceStatus === 'pending' && !/pending|awaiting|review/i.test(s)) return false;
        if (invoiceStatus === 'rejected' && !/rejected|failed/i.test(s)) return false;
      }
      return true;
    });
  }, [invoices, range, matterFilter, invoiceStatus, cutoff]);

  const paidTotal = invoices
    .filter((p) => p.status === 'verified')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const grandMinutes = grouped.reduce((s, g) => s + g.minutes, 0);
  const grandAmount = grouped.reduce((s, g) => s + g.amount, 0);

  async function generateInvoice(matterId: number, amount: number) {
    if (amount <= 0) return toast.warn('No un-invoiced billable time to bill yet.');
    const ok = await toast.confirm({
      title: `Generate $${amount.toFixed(2)} invoice?`,
      body: 'Only un-invoiced billable time on this matter will be included. The client will see this in the matter room and transactions list.',
      confirmLabel: 'Create invoice',
    });
    if (!ok) return;
    try {
      await paymentsApi.generateInvoice(matterId);
      await refresh();
      toast.success('Invoice raised — client notified in matter room.', { major: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not create invoice.');
    }
  }

  async function downloadPdf(paymentId: number) {
    setDownloading(paymentId);
    try {
      await paymentsApi.downloadInvoicePdf(paymentId);
      toast.success('Invoice PDF downloaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not download invoice.');
    } finally {
      setDownloading(null);
    }
  }

  function toggle(matterId: number) {
    setExpanded((cur) => ({ ...cur, [matterId]: !cur[matterId] }));
  }

  const pagedGroups = grouped.slice((byMatterPage - 1) * PAGE_SIZE, byMatterPage * PAGE_SIZE);
  const groupPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const pagedInvoices = filteredInvoices.slice(
    (invoicesPage - 1) * PAGE_SIZE,
    invoicesPage * PAGE_SIZE
  );
  const invoicePages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <Clock size={20} className="text-brand-dark" />
        <h1 className="text-2xl font-bold">Billables</h1>
      </div>
      <p className="text-sm text-muted">Track time, log timesheets, and generate invoices.</p>

      <div className="mt-6">
        <TimeTracker matters={matters} onChange={refresh} />
      </div>

      {/* STAT CARDS */}
      <div className="mt-8 grid grid-cols-3 gap-3">
        <StatCard
          icon={Clock}
          label="Logged"
          value={`${Math.round((grandMinutes / 60) * 10) / 10}h`}
          sub={`${grandMinutes} min`}
        />
        <StatCard
          icon={FileText}
          label="Billable"
          value={`$${grandAmount.toFixed(2)}`}
          sub={`${grouped.length} matter${grouped.length === 1 ? '' : 's'}`}
        />
        <StatCard
          icon={CheckCircle2}
          tone="emerald"
          label="Paid"
          value={`$${paidTotal.toFixed(2)}`}
          sub={`${invoices.filter((p) => p.status === 'verified').length} invoice${
            invoices.filter((p) => p.status === 'verified').length === 1 ? '' : 's'
          }`}
        />
      </div>

      {/* FILTER PANE */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-card">
        <FilterGroup label="Range">
          {(['7d', '30d', 'all'] as Range[]).map((r) => (
            <ChipButton key={r} active={range === r} onClick={() => setRange(r)}>
              {r === 'all' ? 'All' : r === '7d' ? 'Last 7d' : 'Last 30d'}
            </ChipButton>
          ))}
        </FilterGroup>

        <div className="hidden h-6 w-px bg-line sm:block" />

        <FilterGroup label="Matter">
          <MatterPicker value={matterFilter} onChange={setMatterFilter} matters={matters} />
        </FilterGroup>

        {tab === 'invoices' && (
          <>
            <div className="hidden h-6 w-px bg-line sm:block" />
            <FilterGroup label="Status">
              {(['all', 'paid', 'pending', 'rejected'] as InvoiceStatus[]).map((s) => (
                <ChipButton key={s} active={invoiceStatus === s} onClick={() => setInvoiceStatus(s)}>
                  {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
                </ChipButton>
              ))}
            </FilterGroup>
          </>
        )}
      </div>

      {/* TABS */}
      <div className="mt-6 flex items-center gap-1 border-b border-line">
        <TabButton active={tab === 'by_matter'} onClick={() => setTab('by_matter')}>
          By matter
        </TabButton>
        <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')}>
          Invoices
          <span
            className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              tab === 'invoices' ? 'bg-brand-dark text-white' : 'bg-line text-muted'
            }`}
          >
            {filteredInvoices.length}
          </span>
        </TabButton>
      </div>

      {/* BY MATTER */}
      {tab === 'by_matter' && (
        <div className="mt-4">
          {pagedGroups.length === 0 ? (
            <EmptyState icon={Clock} title="No time in this range" subtitle="Start a timer or log a timesheet entry above." />
          ) : (
            <div className="space-y-3">
              {pagedGroups.map((g) => {
                const open = !!expanded[g.matter_id];
                return (
                  <div key={g.matter_id} className="overflow-hidden rounded-xl border border-line bg-surface">
                    <button
                      onClick={() => toggle(g.matter_id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-canvas"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="truncate text-sm font-semibold text-ink">{g.matter_title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                        <span>{g.entries.length} entries</span>
                        <span>{Math.round((g.minutes / 60) * 10) / 10}h</span>
                        <div className="text-right">
                          <span className="block text-base font-bold text-ink">${g.uninvoiced_amount.toFixed(2)}</span>
                          {g.uninvoiced_amount !== g.amount && (
                            <span className="block text-[10px] uppercase tracking-wide text-muted">to invoice (of ${g.amount.toFixed(2)})</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {open && (
                      <div className="border-t border-line/70 bg-canvas/40 px-4 py-3">
                        <div className="space-y-1.5">
                          {g.entries.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-3 text-xs">
                              <span className="truncate text-ink">
                                {e.description || 'Billable work'}
                                {e.is_running && <span className="ml-1 text-brand">• running</span>}
                                {e.invoice != null && (
                                  <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                    invoiced
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-muted">
                                {new Date(e.started_at).toLocaleDateString()} · {e.minutes}m · ${e.amount ?? '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-3">
                          <Link href={`/matters/${g.matter_id}`} className="text-[11px] font-semibold text-brand hover:underline">
                            Open matter →
                          </Link>
                          <button
                            onClick={() => generateInvoice(g.matter_id, g.uninvoiced_amount)}
                            disabled={g.uninvoiced_amount <= 0}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Receipt size={14} />
                            {g.uninvoiced_amount > 0
                              ? `Generate invoice ($${g.uninvoiced_amount.toFixed(2)})`
                              : 'All time invoiced'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {grouped.length > PAGE_SIZE && (
            <Pagination page={byMatterPage} pages={groupPages} onChange={setByMatterPage} />
          )}
        </div>
      )}

      {/* INVOICES */}
      {tab === 'invoices' && (
        <div className="mt-4">
          {pagedInvoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices match your filters"
              subtitle="Generate one from the By matter tab."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="hidden grid-cols-[1fr_140px_120px_120px_140px] gap-2 border-b border-line bg-canvas px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted sm:grid">
                <span>Matter</span>
                <span className="text-right">Amount</span>
                <span>Status</span>
                <span>Date</span>
                <span className="text-right">Actions</span>
              </div>
              <ul className="divide-y divide-line">
                {pagedInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="grid grid-cols-1 gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_140px_120px_120px_140px] sm:items-center"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/matters/${inv.matter}`}
                        className="truncate font-semibold text-ink hover:text-brand"
                      >
                        {matterTitleById.get(inv.matter) ?? `Matter #${inv.matter}`}
                      </Link>
                      <p className="text-[11px] text-muted">INV-{String(inv.id).padStart(5, '0')}</p>
                    </div>
                    <div className="text-base font-bold text-ink sm:text-right">
                      ${Number(inv.amount).toFixed(2)}
                      <span className="ml-1 text-[10px] font-medium text-muted">{inv.currency}</span>
                    </div>
                    <div>
                      <InvoiceStatusPill status={inv.status} label={inv.status_display || inv.status} />
                    </div>
                    <p className="text-xs text-muted">
                      {new Date(inv.created_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setViewingInvoiceId(inv.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-dark hover:border-brand hover:text-brand"
                      >
                        <Eye size={12} /> View
                      </button>
                      <button
                        onClick={() => downloadPdf(inv.id)}
                        disabled={downloading === inv.id}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-dark hover:border-brand hover:text-brand disabled:opacity-50"
                      >
                        <Download size={12} /> {downloading === inv.id ? '…' : 'PDF'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {filteredInvoices.length > PAGE_SIZE && (
            <Pagination page={invoicesPage} pages={invoicePages} onChange={setInvoicesPage} />
          )}
        </div>
      )}

      {viewingInvoiceId != null && (
        <InvoiceViewerModal paymentId={viewingInvoiceId} onClose={() => setViewingInvoiceId(null)} />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: 'emerald';
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card sm:p-5">
      <DecoIcon icon={Icon} className={tone === 'emerald' ? 'text-emerald-50' : ''} />
      <div className="relative z-10">
        <p className="min-h-[2.4em] text-[10px] uppercase leading-tight tracking-wide text-muted sm:min-h-0 sm:text-xs">
          {label}
        </p>
        <p className="mt-0.5 text-lg font-bold text-ink sm:mt-1 sm:text-2xl">{value}</p>
        {sub && <p className="text-[10px] text-muted sm:text-xs">{sub}</p>}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
        active
          ? 'border-brand bg-brand-light/10 text-brand-dark'
          : 'border-line bg-white text-muted hover:border-brand'
      }`}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px inline-flex items-center border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'border-brand-dark text-brand-dark' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted">
      <span>
        Page <span className="font-semibold text-ink">{page}</span> of {pages}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand disabled:opacity-40"
        >
          <ChevronLeft size={12} /> Prev
        </button>
        <button
          onClick={() => onChange(Math.min(pages, page + 1))}
          disabled={page === pages}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand disabled:opacity-40"
        >
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: any;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light/10 text-brand">
        <Icon size={26} strokeWidth={1.5} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
    </div>
  );
}

function MatterPicker({
  value,
  onChange,
  matters,
}: {
  value: number | 'all';
  onChange: (v: number | 'all') => void;
  matters: Matter[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value === 'all' ? null : matters.find((m) => m.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter((m) => m.title.toLowerCase().includes(q));
  }, [matters, query]);

  const options: Array<{ id: number | 'all'; label: string }> = useMemo(
    () => [{ id: 'all' as const, label: 'All matters' }, ...filtered.map((m) => ({ id: m.id, label: m.title }))],
    [filtered]
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function select(id: number | 'all') {
    onChange(id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[highlight]) select(options[highlight].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : selected?.title ?? '';

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-1.5 rounded-lg border bg-white px-2 transition ${
          open ? 'border-brand ring-2 ring-brand-light/40' : 'border-line'
        }`}
      >
        <Search size={12} className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={selected ? selected.title : 'All matters'}
          className="w-44 bg-transparent py-1.5 text-xs font-semibold text-ink placeholder:font-medium placeholder:text-muted focus:outline-none"
        />
        {value !== 'all' && !open && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              select('all');
            }}
            aria-label="Clear matter filter"
            className="text-muted hover:text-ink"
          >
            <X size={12} />
          </button>
        )}
        <ChevronDown size={12} className="text-muted" />
      </div>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No matches.</p>
          ) : (
            options.map((o, i) => {
              const isSelected = o.id === value;
              const isHighlighted = i === highlight;
              return (
                <button
                  key={String(o.id)}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(o.id)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition ${
                    isHighlighted ? 'bg-brand-light/10' : ''
                  } ${isSelected ? 'font-semibold text-brand-dark' : 'text-ink'}`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check size={12} className="text-brand" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceStatusPill({ status, label }: { status: string; label: string }) {
  let tone = 'bg-line/60 text-muted ring-1 ring-inset ring-line';
  if (/verified|paid/i.test(status)) tone = 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200';
  else if (/pending|awaiting|review/i.test(status)) tone = 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200';
  else if (/rejected|failed/i.test(status)) tone = 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label.replace(/_/g, ' ')}
    </span>
  );
}

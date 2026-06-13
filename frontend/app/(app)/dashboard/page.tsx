'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  type LucideIcon,
  Briefcase,
  CalendarClock,
  CalendarX2,
  Clock,
  FolderOpen,
  GraduationCap,
  Scale,
  Star as StarIcon,
  Wallet,
} from 'lucide-react';
import { useApp } from '@/components/AppShell';
import {
  consultations as consultationsApi,
  timeEntries as timeApi,
  reviews as reviewsApi,
  type TimeEntry,
  type Consultation,
} from '@/lib/api';
import { StarRating } from '@/components/Stars';
import { Banner, DecoIcon } from '@/components/Banner';
import TimeTracker from '@/components/TimeTracker';
import { useToast } from '@/components/Toast';
import { RescheduleModal } from '@/components/MatterModals';

export default function DashboardPage() {
  const { me } = useApp();
  if (me?.role === 'lawyer') return <LawyerDashboard />;
  return <ClientDashboard />;
}

function Stat({
  label,
  value,
  sub,
  icon,
  dark = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  dark?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl p-3 shadow-card sm:p-5 ${
        dark ? 'bg-brand-dark text-white' : 'border border-line bg-surface'
      }`}
    >
      {icon && <DecoIcon icon={icon} className={dark ? 'opacity-30' : ''} />}
      <div className="relative z-10">
        <p className={`min-h-[2.4em] text-[10px] uppercase leading-tight tracking-wide sm:min-h-0 sm:text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>
          {label}
        </p>
        <p className={`mt-0.5 text-lg font-bold capitalize sm:mt-1 sm:text-2xl ${dark ? 'text-white' : ''}`}>{value}</p>
        {sub && <p className={`text-[10px] sm:text-xs ${dark ? 'text-white/60' : 'text-muted'}`}>{sub}</p>}
      </div>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light/10 text-brand">
        <Icon size={26} strokeWidth={1.5} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-[14rem] text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const MATTER_STATUS_STYLES: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  awaiting_client: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  closed: 'bg-line text-muted ring-1 ring-inset ring-line',
};

function MatterStatusBadge({ status }: { status: string }) {
  const cls = MATTER_STATUS_STYLES[status] ?? MATTER_STATUS_STYLES.closed;
  const label = status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

function upcoming(consults: Consultation[]) {
  const now = Date.now();
  return consults
    .filter((c) => new Date(c.scheduled_time).getTime() > now && !['cancelled', 'completed'].includes(c.status))
    .sort((a, b) => +new Date(a.scheduled_time) - +new Date(b.scheduled_time));
}

/* ---------------- Client ---------------- */
function ClientDashboard() {
  const toast = useToast();
  const { me, matters, retainers, consultations, reloadConsultations } = useApp();
  const next = upcoming(consultations).slice(0, 4);
  const [rescheduling, setRescheduling] = useState<Consultation | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Welcome back, {me?.first_name} 👋</h1>
      <p className="text-sm text-muted">Your legal workspace at a glance.</p>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="Open matters" value={matters.length} icon={FolderOpen} />
        <Stat label="Legal team" value={retainers.length} sub="on retainer" icon={GraduationCap} />
        <Stat label="Upcoming consults" value={next.length} icon={CalendarClock} />
      </div>

      <div className="mt-8">
        <Banner
          title="Need legal help?"
          subtitle="Browse verified lawyers and book a consultation in minutes."
          icon={Scale}
          action={
            <Link href="/lawyers" className="whitespace-nowrap rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-dark hover:bg-brand-light">
              Find a Lawyer →
            </Link>
          }
        />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Upcoming bookings</h2>
          {next.length === 0 ? (
            <Empty
              icon={CalendarX2}
              title="No upcoming bookings"
              description="When you book a consultation it will appear here."
              action={
                <Link href="/lawyers" className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand">
                  Find a lawyer
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {next.map((c) => (
                <UpcomingRow
                  key={c.id}
                  c={c}
                  who={c.lawyer_detail?.full_name}
                  onReschedule={() => setRescheduling(c)}
                />
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Recent matters</h2>
          {matters.slice(0, 5).map((m) => (
            <Link
              key={m.id}
              href={`/matters/${m.id}`}
              className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-brand"
            >
              <span className="truncate text-xs font-medium text-ink"># {m.title}</span>
              <MatterStatusBadge status={m.status} />
            </Link>
          ))}
          {matters.length === 0 && (
            <Empty icon={FolderOpen} title="No matters yet" description="Open one with a lawyer to start the timeline." />
          )}
        </div>
      </div>

      {rescheduling && (
        <RescheduleModal
          consultation={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={async () => {
            setRescheduling(null);
            await reloadConsultations();
            toast.success('Consultation rescheduled — your lawyer will re-confirm.', { major: true });
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Lawyer ---------------- */
function LawyerDashboard() {
  const toast = useToast();
  const { me, matters, consultations, reloadConsultations } = useApp();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [rating, setRating] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [rescheduling, setRescheduling] = useState<Consultation | null>(null);

  async function refreshEntries() {
    try {
      setEntries((await timeApi.all()).results);
    } catch {}
  }

  useEffect(() => {
    refreshEntries();
    if (me?.id) reviewsApi.forLawyer(me.id).then((r) => {
      const count = r.results.length;
      const avg = count ? r.results.reduce((s, x) => s + x.rating, 0) / count : null;
      setRating({ avg, count });
    }).catch(() => {});
  }, [me?.id]);

  const pending = consultations.filter((c) => c.status === 'pending');
  const weekStart = Date.now() - 7 * 864e5;
  const billableWeek = entries
    .filter((e) => e.is_billable && e.amount && +new Date(e.started_at) > weekStart)
    .reduce((s, e) => s + Number(e.amount), 0);

  async function confirm(id: number) {
    try {
      await consultationsApi.confirm(id);
      await reloadConsultations();
      toast.success('Consultation confirmed — both parties notified.', { major: true });
    } catch (e) {
      toast.error('Could not confirm the booking.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Welcome, {me?.first_name} ⚖️</h1>
      <p className="text-sm text-muted">Your practice at a glance.</p>

      <div className="mt-6 grid grid-cols-4 gap-2 sm:gap-4">
        <Stat label="Active matters" value={matters.length} icon={Briefcase} />
        <Stat label="To confirm" value={pending.length} sub="bookings" icon={CalendarClock} />
        <Stat label="Billable (7d)" value={`$${billableWeek.toFixed(0)}`} icon={Wallet} />
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card sm:p-5">
          <DecoIcon icon={StarIcon} />
          <div className="relative z-10">
            <p className="min-h-[2.4em] text-[10px] uppercase leading-tight tracking-wide text-muted sm:min-h-0 sm:text-xs">Rating</p>
            <div className="mt-0.5 flex flex-col items-start gap-0.5 sm:mt-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="text-lg font-bold sm:text-2xl">{rating.avg ? rating.avg.toFixed(1) : '—'}</span>
              <StarRating value={rating.avg} size={10} />
            </div>
            <p className="mt-0.5 text-[10px] text-muted sm:text-xs">{rating.count} reviews</p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <TimeTracker matters={matters} onChange={refreshEntries} />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Bookings needing confirmation</h2>
        {pending.length === 0 ? (
          <Empty icon={CalendarX2} title="No bookings to confirm" description="When clients book a consultation it will land here." />
        ) : (
          <div className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
                    <CalendarClock size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.matter_title}</p>
                    <p className="truncate text-xs text-muted">
                      {c.client_detail?.full_name} · {new Date(c.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {c.mode_display}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-brand"
                    onClick={() => setRescheduling(c)}
                  >
                    Reschedule
                  </button>
                  <button className="btn-primary py-1.5 text-xs" onClick={() => confirm(c.id)}>Confirm</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {rescheduling && (
        <RescheduleModal
          consultation={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={async () => {
            setRescheduling(null);
            await reloadConsultations();
            toast.success('Consultation rescheduled — the client will re-confirm.', { major: true });
          }}
        />
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Clock size={14} /> Recent time entries
          </h2>
          <Link href="/billables" className="text-xs font-semibold text-brand hover:underline">
            See all
          </Link>
        </div>
        {entries.length === 0 ? (
          <Empty
            icon={Clock}
            title="No time logged yet"
            description="Start a timer or log a timesheet entry."
            action={
              <Link
                href="/billables"
                className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand"
              >
                Open billables
              </Link>
            }
          />
        ) : (
          <div className="space-y-2 font-aldrich">
            {entries.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2 text-sm tracking-wide">
                <span className="font-medium">{e.matter_title} <span className="text-muted">· {e.client_detail?.full_name}</span></span>
                <span className="text-muted">{e.minutes}m · ${e.amount ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UpcomingRow({
  c,
  who,
  onReschedule,
}: {
  c: Consultation;
  who?: string;
  onReschedule?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:border-brand">
      <Link href={`/matters/${c.matter}`} className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.matter_title}</p>
        <p className="truncate text-xs text-muted">
          {who} · {new Date(c.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        <span className="badge-teal capitalize">{c.status_display}</span>
        {onReschedule && c.status !== 'cancelled' && c.status !== 'completed' && (
          <button
            type="button"
            onClick={onReschedule}
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-brand"
          >
            Reschedule
          </button>
        )}
      </div>
    </div>
  );
}

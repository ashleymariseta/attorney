'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  type LucideIcon,
  Briefcase,
  CalendarClock,
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

export default function DashboardPage() {
  const { me } = useApp();
  if (me?.role === 'lawyer') return <LawyerDashboard />;
  return <ClientDashboard />;
}

function Stat({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: LucideIcon }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-card sm:p-5">
      {icon && <DecoIcon icon={icon} className="hidden sm:block" />}
      <div className="relative z-10">
        <p className="text-[10px] uppercase tracking-wide text-muted sm:text-xs">{label}</p>
        <p className="mt-0.5 text-lg font-bold capitalize sm:mt-1 sm:text-2xl">{value}</p>
        {sub && <p className="text-[10px] text-muted sm:text-xs">{sub}</p>}
      </div>
    </div>
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
  const { me, matters, retainers, consultations } = useApp();
  const next = upcoming(consultations).slice(0, 4);

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
            <p className="text-sm text-muted">No upcoming consultations.</p>
          ) : (
            <div className="space-y-2">
              {next.map((c) => <UpcomingRow key={c.id} c={c} who={c.lawyer_detail?.full_name} />)}
            </div>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Recent matters</h2>
          {matters.slice(0, 5).map((m) => (
            <Link key={m.id} href={`/matters/${m.id}`} className="mb-2 flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-brand">
              <span className="font-medium"># {m.title}</span>
              <span className="badge-muted capitalize">{m.status}</span>
            </Link>
          ))}
          {matters.length === 0 && <p className="text-sm text-muted">No matters yet.</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Lawyer ---------------- */
function LawyerDashboard() {
  const { me, matters, consultations, reloadConsultations } = useApp();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [rating, setRating] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });

  useEffect(() => {
    timeApi.all().then((r) => setEntries(r.results)).catch(() => {});
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
    await consultationsApi.confirm(id);
    await reloadConsultations();
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
          <DecoIcon icon={StarIcon} className="hidden sm:block" />
          <div className="relative z-10">
            <p className="text-[10px] uppercase tracking-wide text-muted sm:text-xs">Rating</p>
            <div className="mt-0.5 flex items-center gap-1 sm:mt-1 sm:gap-2">
              <span className="text-lg font-bold sm:text-2xl">{rating.avg ? rating.avg.toFixed(1) : '—'}</span>
              <StarRating value={rating.avg} size={12} />
            </div>
            <p className="text-[10px] text-muted sm:text-xs">{rating.count} reviews</p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Bookings needing confirmation</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. 🎉</p>
        ) : (
          <div className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
                <div>
                  <p className="font-medium">{c.matter_title}</p>
                  <p className="text-xs text-muted">
                    {c.client_detail?.full_name} · {new Date(c.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {c.mode_display}
                  </p>
                </div>
                <button className="btn-primary py-1.5 text-xs" onClick={() => confirm(c.id)}>Confirm</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Recent time entries</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No billable time logged yet. Start a timer in a matter room.</p>
        ) : (
          <div className="space-y-2">
            {entries.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2 text-sm">
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

function UpcomingRow({ c, who }: { c: any; who?: string }) {
  return (
    <Link href={`/matters/${c.matter}`} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-brand">
      <div>
        <p className="font-medium">{c.matter_title}</p>
        <p className="text-xs text-muted">
          {who} · {new Date(c.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <span className="badge-teal capitalize">{c.status_display}</span>
    </Link>
  );
}

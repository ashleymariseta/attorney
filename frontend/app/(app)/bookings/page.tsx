'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { consultations as consultationsApi, type Consultation } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { RescheduleModal } from '@/components/MatterModals';
import { useToast } from '@/components/Toast';

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_PX = 56;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const STATUS_STYLE: Record<string, string> = {
  awaiting_payment: 'bg-amber-50 border-amber-400 text-amber-800',
  pending: 'bg-amber-100 border-amber-500 text-amber-900',
  confirmed: 'bg-brand text-white border-brand-dark',
  completed: 'bg-slate-200 border-slate-400 text-slate-700',
  cancelled: 'bg-line text-muted border-line line-through',
};

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function BookingsPage() {
  const { consultations, me, reloadConsultations } = useApp();
  const toast = useToast();
  const isLawyer = me?.role === 'lawyer';
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selected, setSelected] = useState<Consultation | null>(null);
  const [rescheduling, setRescheduling] = useState<Consultation | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date();

  const weekLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(
    weekStart,
    6
  ).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  async function act(id: number, action: 'confirm' | 'cancel' | 'complete') {
    const fn = consultationsApi[action];
    const updated = await fn(id);
    await reloadConsultations();
    setSelected(updated);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
        <div>
          <h1 className="text-xl font-bold">Bookings</h1>
          <p className="text-xs text-muted">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-outline px-3 py-1" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
          <button className="btn-outline px-3 py-1 text-xs" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
          <button className="btn-outline px-3 py-1" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[760px]">
          {/* day headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,1fr)] border-b border-line bg-brand-dark text-white">
            <div />
            {days.map((d) => {
              const isToday = sameDay(d, today);
              return (
                <div key={d.toISOString()} className="border-l border-white/10 px-2 py-2 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-white/60">
                    {d.toLocaleDateString([], { weekday: 'short' })}
                  </p>
                  <p
                    className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${
                      isToday ? 'bg-white text-brand-dark' : 'text-white'
                    }`}
                  >
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          {/* grid body */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {/* time gutter */}
            <div>
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_PX }} className="relative">
                  <span className="absolute -top-2 right-1 text-[10px] text-muted">
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {days.map((d) => {
              const dayConsults = consultations.filter((c) => sameDay(new Date(c.scheduled_time), d));
              return (
                <div key={d.toISOString()} className="relative border-l border-line">
                  {HOURS.map((h) => (
                    <div key={h} style={{ height: HOUR_PX }} className="border-b border-line/60" />
                  ))}
                  {dayConsults.map((c) => {
                    const dt = new Date(c.scheduled_time);
                    const top = (dt.getHours() - START_HOUR + dt.getMinutes() / 60) * HOUR_PX;
                    const height = Math.max(28, (c.duration_minutes / 60) * HOUR_PX - 2);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelected(c)}
                        style={{ top, height }}
                        className={`absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] shadow-sm ${STATUS_STYLE[c.status] ?? 'bg-surface border-line'}`}
                      >
                        <p className="font-semibold leading-tight">{c.matter_title}</p>
                        <p className="opacity-80">
                          {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} · {c.mode_display}
                        </p>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <BookingDetail
          c={selected}
          isLawyer={isLawyer}
          onClose={() => setSelected(null)}
          onAction={act}
          onReschedule={() => {
            setRescheduling(selected);
            setSelected(null);
          }}
        />
      )}

      {rescheduling && (
        <RescheduleModal
          consultation={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={async () => {
            setRescheduling(null);
            await reloadConsultations();
            toast.success('Consultation rescheduled — the other party will re-confirm.', { major: true });
          }}
        />
      )}
    </div>
  );
}

function BookingDetail({
  c,
  isLawyer,
  onClose,
  onAction,
  onReschedule,
}: {
  c: Consultation;
  isLawyer: boolean;
  onClose: () => void;
  onAction: (id: number, action: 'confirm' | 'cancel' | 'complete') => Promise<void>;
  onReschedule: () => void;
}) {
  const dt = new Date(c.scheduled_time);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-line p-5">
          <div>
            <h2 className="text-lg font-bold">{c.matter_title}</h2>
            <p className="text-sm text-muted">
              {dt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-xl leading-none">×</button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <Row k="Status"><span className="badge-teal capitalize">{c.status_display}</span></Row>
          <Row k="With">{isLawyer ? c.client_detail?.full_name : c.lawyer_detail?.full_name}</Row>
          <Row k="Method">{c.mode_display}</Row>
          <Row k="Duration">{c.duration_minutes} min</Row>
          <Row k="Practice areas">{c.practice_areas.join(', ') || '—'}</Row>
          <Row k="Price">{c.price ? `$${c.price}` : 'TBD'} {c.payment_method === 'cash' ? '(cash)' : ''}</Row>

          {isLawyer ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {(c.status === 'pending') && (
                <button className="btn-primary" onClick={() => onAction(c.id, 'confirm')}>Confirm booking</button>
              )}
              {c.status === 'awaiting_payment' && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Awaiting client&rsquo;s proof of payment.</p>
              )}
              {c.status === 'confirmed' && (
                <button className="btn-outline" onClick={() => onAction(c.id, 'complete')}>Mark completed</button>
              )}
              {!['cancelled', 'completed'].includes(c.status) && (
                <button className="btn-outline" onClick={onReschedule}>Reschedule</button>
              )}
              {!['cancelled', 'completed'].includes(c.status) && (
                <button className="btn-outline" onClick={() => onAction(c.id, 'cancel')}>Cancel</button>
              )}
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              {c.status === 'awaiting_payment' && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Upload your proof of payment in the matter room to submit this booking.</p>
              )}
              {c.status === 'pending' && (
                <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted">Waiting for the lawyer to confirm.</p>
              )}
              {c.status === 'confirmed' && (
                <p className="rounded-lg bg-brand-light/15 px-3 py-2 text-xs text-brand">Confirmed — see you then!</p>
              )}
              {!['cancelled', 'completed'].includes(c.status) && (
                <button className="btn-outline w-full" onClick={onReschedule}>Reschedule</button>
              )}
            </div>
          )}

          {c.channel_id && (
            <Link href={`/matters/${c.matter}`} className="btn-light w-full">Open matter room</Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

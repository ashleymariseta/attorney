'use client';

import { Briefcase, Calendar, Clock, FileText, Pause, Play, PenSquare, Plus, Timer, X } from 'lucide-react';
import { Select } from 'antd';
import { useEffect, useState } from 'react';
import { timeEntries as timeApi, ApiError, type Matter } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { setRunning as setRunningStore, useRunningTimer } from '@/lib/timerStore';
import DateField from '@/components/DateField';

function fmt(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function TimeTracker({
  matters,
  onChange,
  compact = false,
}: {
  matters: Matter[];
  onChange?: () => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const running = useRunningTimer();
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (!running) return;
    const start = new Date(running.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  async function startTimer(matterId: number, description: string) {
    setBusy(true);
    try {
      const r = await timeApi.start(matterId, description);
      setRunningStore(r);
      setShowStart(false);
      onChange?.();
      toast.success('Timer started.', { title: r.matter_title });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start timer.');
    } finally {
      setBusy(false);
    }
  }

  async function stopTimer() {
    if (!running) return;
    setBusy(true);
    try {
      const stopped = await timeApi.stop(running.id);
      setRunningStore(null);
      setElapsed(0);
      onChange?.();
      toast.success(`Logged ${stopped.minutes}m · $${stopped.amount ?? '0.00'}.`, {
        title: 'Timer stopped',
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not stop timer.');
    } finally {
      setBusy(false);
    }
  }

  async function logEntry(payload: {
    matter: number;
    minutes: number;
    description: string;
    started_at?: string;
  }) {
    setBusy(true);
    try {
      const e = await timeApi.log(payload);
      setShowLog(false);
      onChange?.();
      toast.success(`${e.minutes}m logged · $${e.amount ?? '0.00'}.`, { title: 'Time saved' });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not log time.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-xl bg-brand-dark text-white shadow-card ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-brand-light">
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
            {running ? 'Tracking' : 'Time tracker'}
          </p>
          {running ? (
            <p className="truncate text-sm font-semibold text-white">
              <span className="font-mono">{fmt(elapsed)}</span>
              <span className="text-white/70"> · {running.matter_title}</span>
            </p>
          ) : (
            <p className="truncate text-sm font-medium text-white/70">Idle — log time or start a timer.</p>
          )}
        </div>

        {running ? (
          <button
            onClick={stopTimer}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-light disabled:opacity-50"
          >
            <Pause size={14} /> Stop
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowStart(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-light"
            >
              <Play size={14} /> Start
            </button>
            <button
              onClick={() => setShowLog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
            >
              <PenSquare size={14} /> Log
            </button>
          </div>
        )}
      </div>

      {showStart && (
        <StartTimerModal
          matters={matters}
          busy={busy}
          onClose={() => setShowStart(false)}
          onStart={startTimer}
        />
      )}
      {showLog && (
        <LogTimeModal
          matters={matters}
          busy={busy}
          onClose={() => setShowLog(false)}
          onSubmit={logEntry}
        />
      )}
    </div>
  );
}

const MODAL_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
};

function ModalShell({
  title,
  subtitle,
  icon: Icon,
  size = 'sm',
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof Clock;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${MODAL_SIZE[size]} overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line`}>
        <div className="flex items-start justify-between bg-gradient-to-br from-brand-dark to-brand px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            {Icon && (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25">
                <Icon size={18} />
              </span>
            )}
            <div>
              <h3 className="text-base font-bold leading-tight">{title}</h3>
              {subtitle && <p className="text-[11px] text-white/80">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function StartTimerModal({
  matters,
  busy,
  onClose,
  onStart,
}: {
  matters: Matter[];
  busy: boolean;
  onClose: () => void;
  onStart: (matterId: number, description: string) => void;
}) {
  const [matterId, setMatterId] = useState<number | undefined>(matters[0]?.id);
  const [description, setDescription] = useState('');
  return (
    <ModalShell title="Start timer" subtitle="Track billable time live" icon={Play} size="md" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!matterId) return;
          onStart(matterId, description);
        }}
        className="space-y-4"
      >
        <div>
          <label className="label flex items-center gap-1.5">
            <Briefcase size={12} /> Matter
          </label>
          <Select<number>
            showSearch
            value={matterId}
            onChange={(v) => setMatterId(v)}
            placeholder="Search a matter…"
            optionFilterProp="label"
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
            className="w-full"
            size="middle"
            disabled={matters.length === 0}
            options={matters.map((m) => ({ value: m.id, label: m.title }))}
            notFoundContent="No matters"
          />
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            <FileText size={12} /> Description
            <span className="ml-1 font-normal text-muted">(optional)</span>
          </label>
          <input
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Drafting the engagement letter"
          />
        </div>
        <button
          disabled={busy || matters.length === 0 || !matterId}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={16} /> {busy ? 'Starting…' : 'Start'}
        </button>
      </form>
    </ModalShell>
  );
}

const MINUTE_PRESETS = [15, 30, 45, 60, 90, 120];

export function LogTimeModal({
  matters,
  busy,
  onClose,
  onSubmit,
}: {
  matters: Matter[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { matter: number; minutes: number; description: string; started_at?: string }) => void;
}) {
  const [matterId, setMatterId] = useState<number | undefined>(matters[0]?.id);
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');

  const totalMinutes = Math.max(0, Number(hours || 0) * 60 + Number(minutes || 0));
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const totalLabel = `${hh}h ${String(mm).padStart(2, '0')}m`;

  function setPreset(m: number) {
    setHours(String(Math.floor(m / 60)));
    setMinutes(String(m % 60));
  }

  return (
    <ModalShell title="Log time" subtitle="Record a manual time entry" icon={Timer} size="lg" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!matterId || totalMinutes <= 0) return;
          onSubmit({
            matter: matterId,
            minutes: totalMinutes,
            description,
            started_at: when ? new Date(when).toISOString() : undefined,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className="label flex items-center gap-1.5">
            <Briefcase size={12} /> Matter
          </label>
          <Select<number>
            showSearch
            value={matterId}
            onChange={(v) => setMatterId(v)}
            placeholder="Search a matter…"
            optionFilterProp="label"
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
            className="w-full"
            size="middle"
            disabled={matters.length === 0}
            options={matters.map((m) => ({ value: m.id, label: m.title }))}
            notFoundContent="No matters"
          />
          {matters.length === 0 && (
            <p className="mt-1 text-[11px] text-muted">No active matters — open one with a client first.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
          <div>
            <label className="label flex items-center gap-1.5">
              <Clock size={12} /> Duration
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <input
                  className="field text-center"
                  type="number"
                  min="0"
                  max="24"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">hours</p>
              </div>
              <span className="pb-5 text-lg font-bold text-muted">:</span>
              <div className="flex-1">
                <input
                  className="field text-center"
                  type="number"
                  min="0"
                  max="59"
                  step="5"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
                <p className="mt-1 text-center text-[10px] uppercase tracking-wide text-muted">minutes</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MINUTE_PRESETS.map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setPreset(m)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    totalMinutes === m
                      ? 'border-brand-dark bg-brand-dark text-white'
                      : 'border-line text-muted hover:border-brand hover:text-brand'
                  }`}
                >
                  {m < 60 ? `${m}m` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Calendar size={12} /> When
              <span className="ml-1 font-normal text-muted">(optional)</span>
            </label>
            <DateField mode="datetime" value={when} onChange={setWhen} />
            <p className="mt-1 text-[11px] text-muted">Defaults to now if left blank.</p>
          </div>
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <FileText size={12} /> Description
          </label>
          <textarea
            className="field"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on? e.g. Reviewed counter-offer + drafted reply"
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total</p>
            <p className="text-xl font-bold text-ink">{totalLabel}</p>
          </div>
          <button
            disabled={busy || matters.length === 0 || totalMinutes <= 0 || !matterId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} /> {busy ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

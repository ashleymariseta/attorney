'use client';

import { Clock, Pause, Play, PenSquare, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { timeEntries as timeApi, ApiError, type Matter } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { setRunning as setRunningStore, useRunningTimer } from '@/lib/timerStore';

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

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-brand px-5 py-4 text-white">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
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
  const [matterId, setMatterId] = useState<number | ''>(matters[0]?.id ?? '');
  const [description, setDescription] = useState('');
  return (
    <ModalShell title="Start timer" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matterId === '') return;
          onStart(Number(matterId), description);
        }}
        className="space-y-3"
      >
        <div>
          <label className="label">Matter</label>
          <select className="field" value={matterId} onChange={(e) => setMatterId(Number(e.target.value))} required>
            {matters.length === 0 && <option value="">No active matters</option>}
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <input
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Drafting the engagement letter"
          />
        </div>
        <button
          disabled={busy || matters.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
        >
          <Play size={16} /> Start
        </button>
      </form>
    </ModalShell>
  );
}

function LogTimeModal({
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
  const [matterId, setMatterId] = useState<number | ''>(matters[0]?.id ?? '');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');
  return (
    <ModalShell title="Log time" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const total = Number(hours) * 60 + Number(minutes);
          if (!matterId || total <= 0) return;
          onSubmit({
            matter: Number(matterId),
            minutes: total,
            description,
            started_at: when ? new Date(when).toISOString() : undefined,
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="label">Matter</label>
          <select className="field" value={matterId} onChange={(e) => setMatterId(Number(e.target.value))} required>
            {matters.length === 0 && <option value="">No active matters</option>}
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Hours</label>
            <input className="field" type="number" min="0" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div>
            <label className="label">Minutes</label>
            <input className="field" type="number" min="0" max="59" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">When (optional)</label>
          <input className="field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you work on?" />
        </div>
        <button
          disabled={busy || matters.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand disabled:opacity-50"
        >
          <Plus size={16} /> Save entry
        </button>
      </form>
    </ModalShell>
  );
}

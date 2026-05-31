'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

type Tone = 'success' | 'error' | 'info' | 'warn';

interface ToastInput {
  title?: string;
  message: string;
  tone?: Tone;
  /** Plays the ring.mp3 notification when shown. Use for major outcomes only. */
  major?: boolean;
  /** Auto-dismiss in ms. Default 4500. Pass 0 to keep until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: Tone;
}

interface ConfirmInput {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'brand' | 'danger';
}

interface ToastApi {
  toast(input: ToastInput): void;
  success(message: string, opts?: Omit<ToastInput, 'message' | 'tone'>): void;
  error(message: string, opts?: Omit<ToastInput, 'message' | 'tone'>): void;
  info(message: string, opts?: Omit<ToastInput, 'message' | 'tone'>): void;
  warn(message: string, opts?: Omit<ToastInput, 'message' | 'tone'>): void;
  confirm(input: ConfirmInput): Promise<boolean>;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

interface ConfirmRequest extends ConfirmInput {
  resolve: (ok: boolean) => void;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio('/ring.mp3');
    audioRef.current.preload = 'auto';
    audioRef.current.volume = 0.6;
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = Math.floor(Math.random() * 1e9);
      const item: ToastItem = { id, tone: 'info', ...input };
      setItems((cur) => [...cur, item]);
      if (input.major && audioRef.current) {
        try {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        } catch {}
      }
      const duration = input.duration ?? 4500;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const api: ToastApi = {
    toast: push,
    success: (message, opts) => push({ ...opts, message, tone: 'success' }),
    error: (message, opts) => push({ ...opts, message, tone: 'error' }),
    info: (message, opts) => push({ ...opts, message, tone: 'info' }),
    warn: (message, opts) => push({ ...opts, message, tone: 'warn' }),
    confirm: (input) =>
      new Promise<boolean>((resolve) => {
        setConfirmReq({ ...input, resolve });
      }),
  };

  function settleConfirm(ok: boolean) {
    if (confirmReq) confirmReq.resolve(ok);
    setConfirmReq(null);
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <Toaster items={items} onDismiss={dismiss} />
      {confirmReq && <ConfirmDialog req={confirmReq} onResolve={settleConfirm} />}
    </Ctx.Provider>
  );
}

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warn: AlertTriangle,
};

const TONE_CLS: Record<Tone, string> = {
  success: 'border-emerald-200 bg-white text-ink',
  error: 'border-red-200 bg-white text-ink',
  info: 'border-line bg-white text-ink',
  warn: 'border-amber-200 bg-white text-ink',
};

const TONE_ICON_CLS: Record<Tone, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-brand-dark',
  warn: 'text-amber-600',
};

const TONE_BAR: Record<Tone, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-brand',
  warn: 'bg-amber-500',
};

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:top-4 sm:left-auto sm:px-0">
      {items.map((t) => {
        const Icon = TONE_ICON[t.tone];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border ${TONE_CLS[t.tone]} shadow-lg`}
            role="status"
          >
            <div className={`w-1 self-stretch ${TONE_BAR[t.tone]}`} />
            <div className="flex flex-1 items-start gap-3 py-3 pr-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${TONE_ICON_CLS[t.tone]}`} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold leading-tight text-ink">{t.title}</p>}
                <p className={`text-sm leading-snug ${t.title ? 'mt-0.5 text-ink/80' : 'text-ink'}`}>
                  {t.message}
                </p>
              </div>
              <button
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="ml-1 rounded p-1 text-muted hover:bg-canvas hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmDialog({ req, onResolve }: { req: ConfirmRequest; onResolve: (ok: boolean) => void }) {
  const tone = req.tone ?? 'brand';
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-darker/50 backdrop-blur-sm" onClick={() => onResolve(false)} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className={`flex items-center justify-between px-5 py-4 text-white ${tone === 'danger' ? 'bg-red-600' : 'bg-brand'}`}>
          <h3 className="text-base font-bold">{req.title}</h3>
          <button onClick={() => onResolve(false)} aria-label="Close" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {req.body && <p className="text-sm text-ink/80">{req.body}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onResolve(false)}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              {req.cancelLabel ?? 'Cancel'}
            </button>
            <button
              onClick={() => onResolve(true)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                tone === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-brand-dark hover:bg-brand'
              }`}
            >
              {req.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

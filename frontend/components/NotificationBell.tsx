'use client';

import { Bell, CheckCircle2, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { notifications as notifApi, type Notif } from '@/lib/api';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [align, setAlign] = useState<'left' | 'right'>('right');
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        // Vertical — flip up if there isn't 440px below the bell.
        const spaceBelow = window.innerHeight - rect.bottom;
        setDirection(spaceBelow < 440 ? 'up' : 'down');
        // Horizontal — the popover is 320px wide. If there isn't enough
        // room to extend leftward (sidebar bell pinned near the screen's
        // left edge), anchor left and let it extend rightward instead.
        const spaceLeft = rect.right;
        setAlign(spaceLeft < 340 ? 'left' : 'right');
      }
      return next;
    });
  }

  async function refresh() {
    try {
      setItems((await notifApi.list()).results);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAllRead() {
    setLoading(true);
    try {
      await notifApi.markAllRead();
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onClickItem(n: Notif) {
    if (!n.read_at) {
      try { await notifApi.markRead(n.id); } catch {}
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative grid h-8 w-8 place-items-center rounded-full text-ink hover:bg-canvas"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className={`absolute z-30 w-80 overflow-hidden rounded-lg border border-line bg-white shadow-xl ${
            direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${align === 'left' ? 'left-0' : 'right-0'}`}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-[11px] font-semibold text-brand hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                <Inbox size={20} className="text-muted/60" />
                <p className="text-xs text-muted">No notifications yet</p>
              </div>
            ) : (
              items.slice(0, 20).map((n) => {
                const body = (
                  <div className={`group flex items-start gap-2 px-3 py-2.5 transition hover:bg-canvas ${!n.read_at ? 'bg-brand-light/5' : ''}`}>
                    {!n.read_at ? (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                    ) : (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-muted/40" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs ${!n.read_at ? 'font-semibold text-ink' : 'text-muted'}`}>{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{n.body}</p>}
                      <p className="mt-1 text-[10px] text-muted/70">{new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                );
                if (n.link && n.link.startsWith('/')) {
                  return (
                    <Link key={n.id} href={n.link} onClick={() => { onClickItem(n); setOpen(false); }}>
                      {body}
                    </Link>
                  );
                }
                return (
                  <button key={n.id} onClick={() => onClickItem(n)} className="block w-full text-left">
                    {body}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

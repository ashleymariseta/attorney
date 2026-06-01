'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Calendar, Clock, GraduationCap, Home, Menu, Plus, Search, Settings, Wallet, X } from 'lucide-react';
import CreateMatterModal from '@/components/CreateMatterModal';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  auth,
  matters as mattersApi,
  retainers as retainersApi,
  consultations as consultationsApi,
  isAuthed,
  type Matter,
  type Retainer,
  type Consultation,
  type User,
} from '@/lib/api';

interface AppData {
  me: User | null;
  matters: Matter[];
  retainers: Retainer[];
  consultations: Consultation[];
  reloadMe: () => Promise<void>;
  reloadMatters: () => Promise<void>;
  reloadRetainers: () => Promise<void>;
  reloadConsultations: () => Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppShell');
  return ctx;
}

function initials(u: User | null) {
  if (!u) return '–';
  return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase() || u.email[0].toUpperCase();
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<User | null>(null);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [matterQuery, setMatterQuery] = useState('');
  const [createMatterOpen, setCreateMatterOpen] = useState(false);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await auth.me());
    } catch {}
  }, []);
  const reloadMatters = useCallback(async () => setMatters((await mattersApi.list()).results), []);
  const reloadRetainers = useCallback(async () => setRetainers((await retainersApi.list()).results), []);
  const reloadConsultations = useCallback(
    async () => setConsultations((await consultationsApi.list()).results),
    []
  );

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        setMe(await auth.me());
        await Promise.all([reloadMatters(), reloadRetainers(), reloadConsultations()]);
      } catch {
        router.replace('/login');
      } finally {
        setReady(true);
      }
    })();
  }, [router, reloadMatters, reloadRetainers, reloadConsultations]);

  useEffect(() => setOpen(false), [pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-muted">
        Loading workspace…
      </div>
    );
  }

  const isLawyer = me?.role === 'lawyer';
  const isClient = me?.role?.startsWith('client');

  async function onLogout() {
    await auth.logout();
    router.push('/login');
  }

  const pendingBookings = consultations.filter(
    (c) => c.status === 'pending' || c.status === 'awaiting_payment'
  ).length;

  const navItem = (href: string, label: string, icon: React.ReactNode, badge?: number) => {
    const active = pathname === href;
    return (
      <Link href={href} className={`side-link ${active ? 'side-link-active' : ''}`}>
        <span className="opacity-80">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge ? (
          <span className="rounded-full bg-brand-light px-1.5 text-[10px] font-bold text-brand-darker">{badge}</span>
        ) : null}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full w-64 flex-col border-r border-line bg-white text-ink">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <Image
          src="/img/logos/icon-mark-teal.png"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 object-contain"
        />
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight">Attorney</p>
          <p className="text-[11px] text-muted">{isLawyer ? 'Practitioner' : 'Client'} workspace</p>
        </div>
      </div>

      {/* Primary nav — desktop only; on mobile the bottom strip handles these. */}
      <nav className="hidden space-y-1 px-2 py-3 md:block">
        {navItem('/dashboard', 'Dashboard', <Home size={16} />)}
        {isClient && navItem('/my-lawyers', 'My Legal Team', <GraduationCap size={16} />)}
        {navItem('/bookings', isLawyer ? 'Bookings' : 'My Bookings', <Calendar size={16} />, pendingBookings)}
        {isLawyer && navItem('/billables', 'Billables', <Clock size={16} />)}
        {navItem('/transactions', 'Transactions', <Wallet size={16} />)}
      </nav>
      {/* Always visible — Settings & Matters live in the hamburger on mobile. */}
      <nav className="space-y-1 px-2 pt-3 md:pt-0">
        {navItem('/settings', isLawyer ? 'Settings & Rate' : 'Settings & KYC', <Settings size={16} />)}
      </nav>

      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Matters</p>
          {matters.length > 3 && (
            <span className="text-[10px] text-muted">{matters.length}</span>
          )}
        </div>
        {isLawyer && (
          <button
            type="button"
            onClick={() => setCreateMatterOpen(true)}
            aria-label="New matter"
            title="New matter"
            className="grid h-6 w-6 place-items-center rounded-full bg-brand-light/20 text-brand-dark transition hover:bg-brand-light/35"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {matters.length > 0 && (
        <div className="px-2 pb-1">
          <div
            className={`flex items-center gap-1.5 rounded-md border bg-white px-2 transition ${
              matterQuery ? 'border-brand' : 'border-line'
            }`}
          >
            <Search size={12} className="text-muted" />
            <input
              type="text"
              value={matterQuery}
              onChange={(e) => setMatterQuery(e.target.value)}
              placeholder="Search matters…"
              className="w-full bg-transparent py-1 text-xs text-ink placeholder:text-muted focus:outline-none"
            />
            {matterQuery && (
              <button
                type="button"
                onClick={() => setMatterQuery('')}
                aria-label="Clear search"
                className="text-muted hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {matters.length === 0 && <p className="px-3 py-2 text-xs text-muted">No matters yet.</p>}
        {(() => {
          const q = matterQuery.trim().toLowerCase();
          const visible = q ? matters.filter((m) => m.title.toLowerCase().includes(q)) : matters;
          if (matters.length > 0 && visible.length === 0) {
            return (
              <div className="flex flex-col items-center gap-1 px-3 py-4 text-center">
                <Search size={14} className="text-muted/60" />
                <p className="text-xs text-muted">No matches for &ldquo;{matterQuery}&rdquo;</p>
              </div>
            );
          }
          return visible.map((m) => {
            const active = pathname === `/matters/${m.id}`;
            return (
              <Link key={m.id} href={`/matters/${m.id}`}
                className={`side-link ${active ? 'side-link-active' : ''}`} title={m.title}>
                <span className="text-muted">#</span>
                <span className="truncate">{m.title}</span>
              </Link>
            );
          });
        })()}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand-dark">{initials(me)}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{me?.first_name} {me?.last_name}</p>
            <p className="truncate text-[11px] text-muted">{me?.email}</p>
          </div>
        </div>
        <button onClick={onLogout} className="mt-2 w-full rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">Log out</button>
      </div>
    </div>
  );

  return (
    <Ctx.Provider
      value={{ me, matters, retainers, consultations, reloadMe, reloadMatters, reloadRetainers, reloadConsultations }}
    >
      <div className="flex h-screen overflow-hidden bg-white">
        <aside className="hidden md:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-30 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0">{sidebar}</div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
            <button onClick={() => setOpen(true)} className="btn-ghost px-2 py-1" aria-label="Open menu"><Menu size={20} /></button>
            <Image
              src="/img/logos/logo-horizontal-teal.png"
              alt="Attorney — Law & Advisory"
              width={200}
              height={66}
              className="h-10 w-auto"
            />
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto pb-2 md:pb-0">{children}</main>
          <MobileNavStrip
            pathname={pathname}
            isLawyer={isLawyer}
            isClient={!!isClient}
            pendingBookings={pendingBookings}
          />
        </div>
      </div>
      {createMatterOpen && (
        <CreateMatterModal
          onClose={() => setCreateMatterOpen(false)}
          onCreated={() => reloadMatters()}
        />
      )}
    </Ctx.Provider>
  );
}

function MobileNavStrip({
  pathname,
  isLawyer,
  isClient,
  pendingBookings,
}: {
  pathname: string;
  isLawyer: boolean;
  isClient: boolean;
  pendingBookings: number;
}) {
  const items: Array<{ href: string; label: string; icon: React.ReactNode; badge?: number }> = [
    { href: '/dashboard', label: 'Dashboard', icon: <Home size={16} /> },
    ...(isClient
      ? [{ href: '/my-lawyers', label: 'Team', icon: <GraduationCap size={16} /> }]
      : []),
    {
      href: '/bookings',
      label: isLawyer ? 'Bookings' : 'My Bookings',
      icon: <Calendar size={16} />,
      badge: pendingBookings || undefined,
    },
    ...(isLawyer
      ? [{ href: '/billables', label: 'Billables', icon: <Clock size={16} /> }]
      : []),
    { href: '/transactions', label: 'Transactions', icon: <Wallet size={16} /> },
  ];

  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 overflow-x-auto border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`relative flex flex-1 min-w-[80px] flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide transition ${
              active ? 'text-brand-dark' : 'text-muted hover:text-ink'
            }`}
          >
            <span className="relative">
              {it.icon}
              {it.badge ? (
                <span className="absolute -right-2 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand-dark px-1 text-[9px] font-bold text-white">
                  {it.badge}
                </span>
              ) : null}
            </span>
            <span>{it.label}</span>
            {active && <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-brand-dark" />}
          </Link>
        );
      })}
    </nav>
  );
}


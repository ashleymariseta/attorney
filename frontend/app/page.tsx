import Image from 'next/image';
import Link from 'next/link';
import { Calendar } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2">
          <Link href="/" className="flex items-center" aria-label="Attorney — Law & Advisory">
            <Image
              src="/img/logos/logo-horizontal-teal.png"
              alt="Attorney — Law & Advisory"
              width={260}
              height={86}
              priority
              className="h-16 w-auto"
            />
          </Link>
          <div className="hidden items-center gap-7 text-sm text-ink/70 md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#trust" className="hover:text-ink">Trust &amp; safety</a>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/login" className="hidden rounded-lg px-3 py-1.5 text-ink/80 hover:text-ink sm:inline-flex">Log in</Link>
            <Link
              href="/lawyers"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-brand"
            >
              Find a lawyer
              <ArrowRightIcon />
            </Link>
          </div>
        </nav>
      </header>

      {/* SERVICES MARQUEE */}
      <section
        aria-label="Practice areas"
        className="overflow-hidden bg-white py-3"
      >
        <div className="flex w-max animate-marquee">
          {Array.from({ length: 2 }).map((_, group) => (
            <ul
              key={group}
              aria-hidden={group === 1}
              className="flex shrink-0 items-center gap-10 pr-10 text-[10px] font-semibold uppercase tracking-[0.32em] text-brand-dark sm:text-[11px]"
            >
              {[
                'Name Transfer',
                'Bond Registration',
                'Conveyancing',
                'Trust Accounts',
                'Family Law',
                'Notarial',
                'Estate Planning',
                'Commercial Law',
                'Litigation',
              ].map((s) => (
                <li key={`${group}-${s}`} className="flex items-center gap-10">
                  <span>{s}</span>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-brand-dark/40" />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-32 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(45,212,191,0.18),transparent_70%)]"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-12 lg:pb-28 lg:pt-24">
          <div className="lg:col-span-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-light/40 bg-brand-light/10 px-3 py-1 text-xs font-medium text-brand-dark">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Verified legal counsel, on demand
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              A workspace for you and your{' '}
              <span className="bg-gradient-to-r from-brand-dark to-brand bg-clip-text text-transparent">lawyer</span>
              <span className="text-ink">.</span>
              <span className="block text-ink/40">Not another inbox.</span>
            </h1>
            <p className="mt-6 hidden max-w-xl text-lg leading-relaxed text-muted sm:block">
              Choose a verified lawyer, book a consultation, and do the work in one place —
              messages, documents, drafts, and trust-accounted payments. Keep counsel on
              retainer and skip straight to the room.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/lawyers"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-dark px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
              >
                Find a lawyer
                <ArrowRightIcon />
              </Link>
              <Link
                href="/register"
                className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
              >
                Create an account
              </Link>
              <Link
                href="/login"
                className="text-sm font-semibold text-muted hover:text-ink"
              >
                Log in
              </Link>
            </div>

            <div className="mt-10 flex items-center gap-6 text-xs text-muted">
              <div className="flex items-center gap-2">
                <ShieldIcon /> Bar-verified lawyers
              </div>
              <div className="flex items-center gap-2">
                <LockIcon /> Funds held in escrow
              </div>
              <div className="flex items-center gap-2">
                <BoltIcon /> Same-day matters
              </div>
            </div>
          </div>

          <div className="relative lg:col-span-6">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-line shadow-[0_30px_60px_-30px_rgba(8,40,38,0.35)]">
              <Image
                src="/img/law-6.jpg"
                alt="Legal consultation"
                fill
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-b from-brand-darker/30 via-brand-darker/45 to-brand-darker/70" />

              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-brand-light">
                  Know your rights
                </p>
                <p className="mt-3 max-w-sm text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
                  You have the right to an attorney.
                </p>
                <p className="mt-3 max-w-xs text-sm text-white/70">
                  Exercise it — on your terms, from anywhere.
                </p>
              </div>
            </div>

            <div className="absolute -left-6 bottom-10 hidden w-56 rounded-xl border border-line bg-white p-4 shadow-card sm:block">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light/20 text-brand-dark">
                  <CheckIcon />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink">Matter opened</p>
                  <p className="text-xs text-muted">Lease review · Today</p>
                </div>
              </div>
            </div>
            <div className="absolute -right-4 top-10 hidden w-60 rounded-xl border border-line bg-white p-4 shadow-card sm:block">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light/20 text-brand-dark">
                  <Calendar className="h-4 w-4" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink">Consultation booked</p>
                  <p className="text-xs text-muted">Tomorrow · 10:30 AM</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* LOGO STRIP / PROOF */}
      <section className="border-y border-line/70 bg-canvas">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-4 px-6 py-8 text-xs uppercase tracking-[0.2em] text-muted sm:grid-cols-4 sm:gap-y-0">
          <p className="text-center">Bar-verified</p>
          <p className="text-center">Trust-accounted</p>
          <p className="text-center">End-to-end secure</p>
          <p className="text-center">Built for retainers</p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">How it works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            From question to counsel in three steps.
          </h2>
          <p className="mt-4 text-muted">
            Skip the cold calls and email chains. Match with a verified lawyer, fund the
            matter, and work together in a dedicated room.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            {
              n: '01',
              t: 'Find a verified lawyer',
              d: 'Browse profiles, areas of practice, and rates. Every lawyer is bar-verified before listing.',
            },
            {
              n: '02',
              t: 'Open a matter',
              d: 'Book a consultation or, if on retainer, jump straight into a private matter room.',
            },
            {
              n: '03',
              t: 'Work in one room',
              d: 'Chat, share documents, sign drafts, and pay — all from a single timeline.',
            },
          ].map((s) => (
            <li key={s.n} className="group relative rounded-2xl border border-line bg-white p-6 transition hover:border-brand/40 hover:shadow-card">
              <span className="text-xs font-semibold tracking-[0.2em] text-brand">{s.n}</span>
              <h3 className="mt-3 text-lg font-semibold text-ink">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FEATURES */}
      <section id="features" className="bg-canvas">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="grid items-end gap-6 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Features</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Everything a matter needs. Nothing it doesn&apos;t.
              </h2>
            </div>
            <p className="text-muted">
              Purpose-built for client-lawyer work: rooms instead of inboxes, escrow instead
              of invoices, and provenance for every document.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                t: 'Matter rooms',
                d: 'Slack-style channels per engagement, with files, drafts, and decisions in one timeline.',
                i: <ChatIcon />,
              },
              {
                t: 'On retainer',
                d: 'Keep counsel on standby. Skip the intake call — open a room and pick up where you left off.',
                i: <BoltIcon />,
              },
              {
                t: 'Trust accounting',
                d: 'Client funds held in escrow until released. Every movement is logged on the trust ledger.',
                i: <LockIcon />,
              },
              {
                t: 'Verified counsel',
                d: 'Every lawyer is bar-verified before they list. Profiles show practice areas and rates upfront.',
                i: <ShieldIcon />,
              },
              {
                t: 'Documents that sign themselves',
                d: 'Upload, redline, and sign drafts directly in the room. Versioning baked in.',
                i: <DocIcon />,
              },
              {
                t: 'Provider-agnostic payments',
                d: 'Card, transfer, or manual proof-of-payment — same ledger, same review flow.',
                i: <CardIcon />,
              },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-line bg-white p-6 transition hover:border-brand/40 hover:shadow-card">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light/15 text-brand-dark">
                  {f.i}
                </span>
                <h3 className="mt-4 text-base font-semibold text-ink">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section id="trust" className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
        <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-line">
          <Image src="/img/law-3.jpg" alt="Trust and safety" fill className="object-cover" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Trust &amp; safety</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Built on the same rails your firm already trusts.
          </h2>
          <p className="mt-4 text-muted">
            Client money never mingles with operating funds. Every deposit, hold, and release
            posts to an internal trust ledger you can audit at any time.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-ink">
            {[
              'Escrow-first payments with reviewed proof of payment',
              'Bar verification before any lawyer can list',
              'Per-matter access controls and audit trail',
              'JWT auth with rotating refresh and blacklist',
            ].map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-light/20 text-brand-dark">
                  <CheckIcon />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20 lg:pb-28">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-darker px-8 py-14 text-white sm:px-14">
          <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <Image
                src="/img/logos/logo-horizontal-white.png"
                alt="Attorney — Law & Advisory"
                width={240}
                height={80}
                className="mb-5 h-12 w-auto opacity-90"
              />
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Open your first matter today.
              </h2>
              <p className="mt-3 max-w-xl text-white/70">
                Free to sign up. You only fund a matter when you choose to engage a lawyer.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link
                href="/lawyers"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-darker hover:bg-brand-light hover:text-brand-darker"
              >
                Find a lawyer
                <ArrowRightIcon />
              </Link>
              <Link
                href="/register"
                className="rounded-lg border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} Attorney. All rights reserved.</p>
          <nav className="flex items-center gap-4">
            <Link href="/lawyers" className="hover:text-ink">Find a lawyer</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

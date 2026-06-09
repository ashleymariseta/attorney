'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CalendarCheck, Sparkles } from 'lucide-react';
import { auth, ApiError } from '@/lib/api';

function safeNext(raw: string | null): string {
  // Only allow same-origin relative redirects.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const isBookingFlow = next.startsWith('/book/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [twoFa, setTwoFa] = useState<null | { token: string; method: 'email' | 'whatsapp' }>(null);
  const [code, setCode] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login(email, password);
      if ('requires_2fa' in res && res.requires_2fa) {
        setTwoFa({ token: res.challenge_token, method: res.method });
      } else {
        router.push(next);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!twoFa) return;
    setError('');
    setLoading(true);
    try {
      await auth.verify2fa(twoFa.token, code.trim());
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify code.');
    } finally {
      setLoading(false);
    }
  }

  const registerHref = next !== '/dashboard' ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="inline-flex items-center" aria-label="Attorney — Law & Advisory">
            <Image
              src="/img/logos/logo-horizontal-teal.png"
              alt="Attorney — Law & Advisory"
              width={320}
              height={106}
              priority
              className="h-16 w-auto"
            />
          </Link>
          {isBookingFlow && !twoFa && (
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-brand-light/30 bg-brand-light/10 p-4 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-dark text-white">
                <CalendarCheck size={18} />
              </span>
              <div className="text-brand-dark">
                <p className="font-semibold">Almost there — one quick login</p>
                <p className="text-xs text-brand-dark/80">
                  Sign in and we&rsquo;ll drop you straight into your booking screen.
                </p>
              </div>
            </div>
          )}
          <h1 className="mt-6 text-2xl font-bold">{twoFa ? 'Enter your code' : 'Log in'}</h1>
          <p className="mt-1 text-sm text-muted">
            {twoFa
              ? `We sent a 6-digit code via ${twoFa.method === 'email' ? 'email' : 'WhatsApp'}. It expires in 10 minutes.`
              : isBookingFlow
              ? 'Welcome — sign in to continue your booking.'
              : 'Welcome back to your workspace.'}
          </p>

          {!twoFa ? (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="field" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="label mb-0">Password</label>
                  <Link href="/forgot-password" className="text-[11px] font-semibold text-brand hover:underline">
                    Forgot?
                  </Link>
                </div>
                <input className="field" type="password" value={password} required
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button className="btn-primary w-full" disabled={loading}>
                {loading ? 'Signing in…' : 'Log in'}
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmitOtp} className="mt-6 space-y-4">
              <div>
                <label className="label">6-digit code</label>
                <input
                  className="field text-center font-mono text-2xl tracking-[0.4em]"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="••••••"
                />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button className="btn-primary w-full" disabled={loading || code.length !== 6}>
                {loading ? 'Verifying…' : 'Verify and continue'}
              </button>
              <button
                type="button"
                onClick={() => { setTwoFa(null); setCode(''); setError(''); }}
                className="block w-full text-center text-xs font-semibold text-muted hover:text-ink"
              >
                Use a different account
              </button>
            </form>
          )}

          {!twoFa && (
            <>
              <p className="mt-6 text-sm text-muted">
                No account?{' '}
                <Link href={registerHref} className="font-semibold text-brand underline underline-offset-2">Create one</Link>
              </p>
              <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
                Demo client: <span className="font-mono">client@attorney.test</span> / <span className="font-mono">ClientPass123!</span>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="relative hidden overflow-hidden lg:block">
        <Image
          src="/img/pexels-karola-g-5412187.jpg"
          alt=""
          fill
          className="scale-110 object-cover object-center blur-md"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-brand-darker/70 via-brand-dark/55 to-brand/40" />
        <div className="absolute inset-0 flex flex-col justify-end p-12 text-white">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90 backdrop-blur">
            <Sparkles size={12} /> AI-powered workflows
          </span>
          <h2 className="mt-5 text-4xl font-bold leading-tight tracking-tight">
            Spend less time<br />on the busywork.
          </h2>
          <p className="mt-3 max-w-md text-base text-white/85">
            Draft, review and route matters with AI built into your workspace —
            your firm moves at the speed of decisions, not paperwork.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            <li className="flex items-center gap-2"><span className="grid h-1.5 w-1.5 rounded-full bg-white" />Auto-summarised chats and consultations</li>
            <li className="flex items-center gap-2"><span className="grid h-1.5 w-1.5 rounded-full bg-white" />Smart drafting from your matter context</li>
            <li className="flex items-center gap-2"><span className="grid h-1.5 w-1.5 rounded-full bg-white" />Faster invoice + payment review</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

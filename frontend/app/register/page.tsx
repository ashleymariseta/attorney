'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { auth, ApiError } from '@/lib/api';

/** Framed by what the person came to do, rather than by the role name we
 *  store. `value` still maps 1:1 onto the API's role field. */
const ROLES: { value: string; label: string; hint: string }[] = [
  { value: 'client_individual', label: 'Looking for a Lawyer', hint: 'For myself' },
  { value: 'client_business', label: 'Looking for a Lawyer', hint: 'For my business' },
  { value: 'lawyer', label: 'Looking for Clients', hint: "I'm a practising lawyer" },
];

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}

function RegisterInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const isBookingFlow = next.startsWith('/book/');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    role: 'client_individual',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }


  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.register(form);
      const res = await auth.login(form.email, form.password);
      // Fresh accounts can't have 2FA on yet, so login returns tokens directly.
      if ('requires_2fa' in res && res.requires_2fa) {
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const loginHref = next !== '/dashboard' ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden lg:block">
        <Image src="/img/law-5.jpg" alt="" fill className="object-cover" />
        <div className="absolute inset-0 bg-brand-dark/40" />
      </div>

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
          {isBookingFlow && (
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-brand-light/30 bg-brand-light/10 p-4 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-dark text-white">
                <CalendarCheck size={18} />
              </span>
              <div className="text-brand-dark">
                <p className="font-semibold">One quick sign-up to finish booking</p>
                <p className="text-xs text-brand-dark/80">
                  We&rsquo;ll take you straight to the consultation screen as soon as your account is ready.
                </p>
              </div>
            </div>
          )}
          <h1 className="mt-6 text-2xl font-bold">Create your account</h1>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First name</label>
                <input className="field" value={form.first_name} required onChange={(e) => set('first_name', e.target.value)} />
              </div>
              <div>
                <label className="label">Last name</label>
                <input className="field" value={form.last_name} required onChange={(e) => set('last_name', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Email</label>
              <input className="field" type="email" value={form.email} required onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="field" type="password" value={form.password} required minLength={8}
                onChange={(e) => set('password', e.target.value)} placeholder="min. 8 characters" />
            </div>
            <div>
              <label className="label" id="role-label">I&rsquo;m here because I&rsquo;m…</label>
              <div className="space-y-2" role="radiogroup" aria-labelledby="role-label">
                {ROLES.map((r) => {
                  const active = form.role === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => set('role', r.value)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition ${
                        active
                          ? 'bg-brand-dark text-white shadow-sm'
                          : 'border border-line bg-white text-ink hover:border-brand hover:bg-canvas'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight">{r.label}</span>
                        <span className={`block text-xs ${active ? 'text-white/70' : 'text-muted'}`}>
                          {r.hint}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                          active ? 'border-white' : 'border-line'
                        }`}
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            Already registered?{' '}
            <Link href={loginHref} className="font-semibold text-brand underline underline-offset-2">Log in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

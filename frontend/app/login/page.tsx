'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { auth, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="mt-8 text-2xl font-bold">Log in</h1>
          <p className="mt-1 text-sm text-muted">Welcome back to your workspace.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="field" type="email" value={email} required
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="field" type="password" value={password} required
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            No account?{' '}
            <Link href="/register" className="font-semibold text-brand underline underline-offset-2">Create one</Link>
          </p>
          <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
            Demo client: <span className="font-mono">client@attorney.test</span> / <span className="font-mono">ClientPass123!</span>
          </p>
        </div>
      </div>

      <div className="relative hidden lg:block">
        <Image src="/img/law-4.jpg" alt="" fill className="object-cover" />
        <p className="absolute inset-x-0 top-64 pl-4 pr-12 text-left text-6xl font-bold tracking-tight text-white drop-shadow-lg xl:text-7xl">
          The right
        </p>
        <p className="absolute inset-x-0 bottom-80 pl-12 pr-4 text-right text-6xl font-bold tracking-tight text-white drop-shadow-lg xl:text-7xl">
          changes everything.
        </p>
      </div>
    </main>
  );
}

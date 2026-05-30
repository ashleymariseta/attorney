'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { auth, ApiError } from '@/lib/api';

const ROLES = [
  ['client_individual', 'Client — Individual'],
  ['client_business', 'Client — Business'],
  ['lawyer', 'Lawyer'],
];

export default function RegisterPage() {
  const router = useRouter();
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
      await auth.login(form.email, form.password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="mt-8 text-2xl font-bold">Create your account</h1>

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
              <label className="label">I am a</label>
              <select className="field" value={form.role} onChange={(e) => set('role', e.target.value)}>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            Already registered?{' '}
            <Link href="/login" className="font-semibold text-brand underline underline-offset-2">Log in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

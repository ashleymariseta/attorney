'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { passwordReset, setTokens, ApiError } from '@/lib/api';
import { useToast } from '@/components/Toast';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const uid = params?.get('uid') ?? '';
  const token = params?.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!uid || !token) {
      setError('Missing reset details. Use the link from your email.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const tokens = await passwordReset.confirm({ uid, token, password });
      setTokens(tokens.access, tokens.refresh);
      toast.success('Password updated.', { major: true });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password.');
    } finally {
      setBusy(false);
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
          <h1 className="mt-8 text-2xl font-bold">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted">Make it strong — at least 8 characters.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label">New password</label>
              <input
                className="field"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                className="field"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>

          <p className="mt-6 text-sm text-muted">
            Need a new link?{' '}
            <Link href="/forgot-password" className="font-semibold text-brand underline underline-offset-2">
              Request another
            </Link>
          </p>
        </div>
      </div>

      <div className="relative hidden lg:block">
        <Image src="/img/still-life-with-scales-justice.jpg" alt="" fill className="object-cover object-right" />
      </div>
    </main>
  );
}

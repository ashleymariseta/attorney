'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { passwordReset, ApiError } from '@/lib/api';
import { useToast } from '@/components/Toast';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await passwordReset.request(email.trim());
      setSent(true);
      toast.success('Check your email for the reset link.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send reset email.');
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
          <h1 className="mt-8 text-2xl font-bold">Forgot your password?</h1>
          <p className="mt-1 text-sm text-muted">
            Enter the email you signed up with and we&apos;ll send you a reset link.
          </p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              If an account exists for <span className="font-semibold">{email}</span>, a reset email is on the way.
              The link expires in 24 hours.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label">Email</label>
                <input
                  className="field"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-muted">
            Remembered it?{' '}
            <Link href="/login" className="font-semibold text-brand underline underline-offset-2">
              Log in
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

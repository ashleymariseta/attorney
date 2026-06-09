'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { auth_invite, ApiError, setTokens } from '@/lib/api';
import { useToast } from '@/components/Toast';

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const token = params?.get('token') ?? '';

  const [preview, setPreview] = useState<{
    email: string;
    first_name: string;
    last_name: string;
    matter_title: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invite token. Please use the link from your invite.');
      setLoading(false);
      return;
    }
    auth_invite
      .preview(token)
      .then((p) => {
        setPreview(p);
        setEmail(p.email);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'This invite is invalid or has already been used.')
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const tokens = await auth_invite.accept({ token, password, email: email || undefined });
      setTokens(tokens.access, tokens.refresh);
      toast.success('Welcome — your account is ready.', { major: true });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invite.');
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
          <h1 className="mt-8 text-2xl font-bold">Accept your invite</h1>
          {loading ? (
            <p className="mt-2 text-sm text-muted">Loading invite…</p>
          ) : preview ? (
            <p className="mt-2 text-sm text-muted">
              You&apos;ve been invited to the matter{' '}
              <span className="font-semibold text-ink">&ldquo;{preview.matter_title}&rdquo;</span>. Set a password to
              activate your account.
            </p>
          ) : (
            <p className="mt-2 text-sm text-red-700">{error}</p>
          )}

          {preview && (
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
                <p className="mt-1 text-[11px] text-muted">
                  This is the address you&apos;ll use to log in.
                </p>
              </div>
              <div>
                <label className="label">Password</label>
                <input
                  className="field"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="label">Confirm password</label>
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
                {busy ? 'Activating…' : 'Activate account'}
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-brand underline underline-offset-2">
              Log in
            </Link>
          </p>
        </div>
      </div>

      <div className="relative hidden lg:block">
        <Image src="/img/law-4.jpg" alt="" fill className="object-cover" />
      </div>
    </main>
  );
}

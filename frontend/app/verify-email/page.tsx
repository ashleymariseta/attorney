'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { emailVerify, ApiError } from '@/lib/api';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const uid = params?.get('uid') ?? '';
  const token = params?.get('token') ?? '';

  const [state, setState] = useState<'pending' | 'ok' | 'err'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!uid || !token) {
      setState('err');
      setMessage('Missing verification details — use the link from your email.');
      return;
    }
    emailVerify
      .confirm({ uid, token })
      .then(() => {
        setState('ok');
        setMessage('Your email is verified.');
      })
      .catch((err) => {
        setState('err');
        setMessage(err instanceof ApiError ? err.message : 'Could not verify this link.');
      });
  }, [uid, token]);

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
          <h1 className="mt-8 text-2xl font-bold">
            {state === 'pending' ? 'Verifying your email…' : state === 'ok' ? 'Email verified' : 'Verification failed'}
          </h1>
          <p className="mt-2 text-sm text-muted">{message}</p>

          {state === 'ok' && (
            <Link href="/dashboard" className="btn-primary mt-6 inline-flex">Go to dashboard</Link>
          )}
          {state === 'err' && (
            <Link href="/login" className="btn-outline mt-6 inline-flex">Back to login</Link>
          )}
        </div>
      </div>

      <div className="relative hidden lg:block">
        <Image src="/img/still-life-with-scales-justice.jpg" alt="" fill className="object-cover object-right" />
      </div>
    </main>
  );
}

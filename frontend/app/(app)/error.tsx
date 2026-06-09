'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('App route error:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-bold text-ink">We hit a snag</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The page couldn&apos;t render. Try again, or jump back to the dashboard.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
        >
          Go to dashboard
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 text-[10px] uppercase tracking-wider text-muted/60">Trace: {error.digest}</p>
      )}
    </main>
  );
}

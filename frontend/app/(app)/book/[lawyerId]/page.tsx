'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { lawyers as lawyersApi, type Lawyer } from '@/lib/api';
import BookModal from '@/components/BookModal';
import { SkeletonCard } from '@/components/Skeleton';

export default function BookLawyerPage({ params }: { params: { lawyerId: string } }) {
  const router = useRouter();
  const lawyerId = Number(params.lawyerId);
  const [lawyer, setLawyer] = useState<Lawyer | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLawyer(await lawyersApi.get(lawyerId));
      } catch {
        setError('We could not find this lawyer.');
      }
    })();
  }, [lawyerId]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/lawyers"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark hover:underline"
      >
        <ArrowLeft size={12} /> Back to directory
      </Link>

      <div className="mt-6 rounded-3xl border border-line bg-gradient-to-br from-brand-light/15 via-white to-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <h1 className="text-xl font-bold">{error}</h1>
            <p className="mt-2 text-sm text-muted">It may have been removed or is no longer accepting new matters.</p>
          </>
        ) : !lawyer ? (
          <>
            <h1 className="text-xl font-bold">Preparing your booking…</h1>
            <p className="mt-2 text-sm text-muted">Loading the lawyer&rsquo;s profile.</p>
            <div className="mt-6">
              <SkeletonCard className="h-24" />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Booking with {lawyer.full_name}</h1>
            <p className="mt-2 text-sm text-muted">
              We&rsquo;ve opened the consultation form. Close it to return to the directory.
            </p>
          </>
        )}
      </div>

      {lawyer && (
        <BookModal
          lawyer={lawyer}
          onClose={() => {
            router.push('/dashboard');
          }}
        />
      )}
    </div>
  );
}

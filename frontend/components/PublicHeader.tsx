'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isAuthed } from '@/lib/api';

export default function PublicHeader({ variant = 'light' }: { variant?: 'light' | 'transparent' }) {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isAuthed());
  }, [pathname]);

  const wrapClasses =
    variant === 'transparent'
      ? 'absolute inset-x-0 top-0 z-30 bg-transparent'
      : 'sticky top-0 z-30 border-b border-line/70 bg-white/80 backdrop-blur';

  return (
    <header className={wrapClasses}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2">
        <Link href="/" className="flex items-center" aria-label="Attorney — Law & Advisory">
          <Image
            src="/img/logos/logo-horizontal-teal.png"
            alt="Attorney — Law & Advisory"
            width={260}
            height={86}
            priority
            className="h-16 w-auto"
          />
        </Link>
        <div className="hidden items-center gap-7 text-sm text-ink/70 md:flex">
          <Link href="/lawyers" className="hover:text-ink">
            Find a lawyer
          </Link>
          <Link href="/#how" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/#trust" className="hover:text-ink">
            Trust &amp; safety
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {authed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-brand"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-1.5 text-ink/80 hover:text-ink sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/lawyers"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-brand"
              >
                Find a lawyer
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

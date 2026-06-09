'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';

const KEY = 'attorney.cookie-consent';

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.localStorage.getItem(KEY)) setShow(true);
  }, []);

  function accept() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ choice: 'accepted', ts: Date.now() }));
    } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-2xl ring-1 ring-line">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light/15 text-brand-dark">
          <Cookie size={16} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-ink">We use essential cookies only</p>
          <p className="mt-0.5 text-xs text-muted">
            We use local storage to keep you signed in. We don&apos;t run ad trackers or share your data
            with third parties. See our{' '}
            <Link href="/privacy" className="font-semibold text-brand hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <button
          onClick={accept}
          className="shrink-0 rounded-lg bg-brand-dark px-3 py-2 text-xs font-semibold text-white hover:bg-brand"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

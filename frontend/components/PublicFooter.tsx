'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 md:grid-cols-3">
        <div>
          <Link href="/" className="inline-flex items-center" aria-label="Attorney — Law & Advisory">
            <Image
              src="/img/logos/logo-horizontal-teal.png"
              alt="Attorney — Law & Advisory"
              width={220}
              height={72}
              className="h-10 w-auto"
            />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted">
            Verified lawyers, clear pricing, and a workspace that keeps your matter moving.
          </p>
        </div>
        <div className="text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Product</p>
          <ul className="space-y-1.5">
            <li><Link className="hover:text-brand" href="/lawyers">Find a lawyer</Link></li>
            <li><Link className="hover:text-brand" href="/#how">How it works</Link></li>
            <li><Link className="hover:text-brand" href="/#trust">Trust &amp; safety</Link></li>
            <li><Link className="hover:text-brand" href="/login">Log in</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Legal</p>
          <ul className="space-y-1.5">
            <li><Link className="hover:text-brand" href="/terms">Terms of Service</Link></li>
            <li><Link className="hover:text-brand" href="/privacy">Privacy Policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-6 py-4 text-xs text-muted">
          © {new Date().getFullYear()} Attorney — Law &amp; Advisory. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

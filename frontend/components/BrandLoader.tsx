'use client';

import Image from 'next/image';

/**
 * Branded full-screen loading state: the Attorney mark inside a rotating
 * conic-gradient ring, with a soft glow, a gentle logo pulse and shimmering
 * label. Animations respect prefers-reduced-motion (see globals.css).
 */
export default function BrandLoader({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-white">
      <div className="relative grid h-28 w-28 place-items-center">
        {/* soft breathing glow */}
        <div className="brand-loader-glow absolute inset-1 rounded-full bg-brand-light/40 blur-2xl" />

        {/* rotating conic-gradient arc, masked into a thin ring */}
        <div
          className="brand-loader-spin absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(45,212,191,0.12) 70deg, #14b8a6 250deg, #0f766e 330deg, transparent 360deg)',
            WebkitMask:
              'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
          }}
        />

        {/* faint static track under the arc */}
        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-line/60" />

        {/* the mark */}
        <div className="brand-loader-pulse relative grid h-16 w-16 place-items-center rounded-full bg-white shadow-[0_4px_20px_-6px_rgba(8,40,38,0.35)]">
          <Image
            src="/img/logos/icon-mark-teal.png"
            alt="Attorney"
            width={44}
            height={44}
            priority
            className="h-11 w-11 object-contain"
          />
        </div>
      </div>

      <p className="flex items-baseline text-sm font-semibold tracking-wide">
        <span className="brand-loader-shimmer">{label}</span>
        <span className="brand-loader-dots ml-0.5 w-3 text-left text-brand" aria-hidden="true" />
      </p>
    </div>
  );
}

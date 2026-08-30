'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { appConfig } from '@/lib/api';

// Baked into the build at deploy time; bump AppConfig.web_version in Django
// admin after each deploy and open tabs on the old build will prompt to reload.
const BAKED_VERSION = Number(process.env.NEXT_PUBLIC_APP_VERSION ?? '1');

export default function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const cfg = await appConfig.get();
        if (active && cfg.web_version > BAKED_VERSION) setShow(true);
      } catch {
        /* ignore — never break the app over a version check */
      }
    }
    check();
    const t = setInterval(check, 5 * 60 * 1000); // re-check every 5 min
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="flex items-center gap-3 bg-brand-dark px-4 py-2.5 text-white">
      <Image
        src="/img/logos/logo-horizontal-white.png"
        alt="Legal Online"
        width={108}
        height={36}
        className="hidden h-6 w-auto object-contain sm:block"
      />
      <p className="flex-1 text-sm font-medium">
        A new version of Legal Online is available. Reload to get the latest.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-brand-dark transition hover:bg-white/90"
      >
        <RefreshCw size={14} /> Reload
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded-md p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}

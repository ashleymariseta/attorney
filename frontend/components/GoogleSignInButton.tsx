'use client';

import { useEffect, useRef } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** True when NEXT_PUBLIC_GOOGLE_CLIENT_ID is baked into this build. Pages use
 * it to hide the "or" divider so nothing dangles when Google isn't set up. */
export const googleEnabled = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Minimal typing for the Google Identity Services global.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gis load error')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gis load error'));
    document.head.appendChild(s);
  });
}

/**
 * Renders the official "Sign in with Google" button. On success it hands the
 * Google ID token back via `onCredential`. Renders nothing if the client ID
 * env var isn't configured.
 */
export default function GoogleSignInButton({
  onCredential,
  onError,
  text = 'continue_with',
}: {
  onCredential: (idToken: string) => void;
  onError?: (msg: string) => void;
  text?: 'continue_with' | 'signin_with' | 'signup_with' | 'signin';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    // No client ID baked into this build → Google sign-in isn't set up in this
    // environment. That's a deployment-config state, not a user error, so we
    // render nothing silently instead of showing a scary banner.
    if (!clientId) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            if (resp.credential) onCredential(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'center',
          width: 320,
        });
      })
      .catch(() => onError?.('Could not load Google sign-in.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;
  return <div ref={ref} className="flex min-h-[44px] justify-center" />;
}

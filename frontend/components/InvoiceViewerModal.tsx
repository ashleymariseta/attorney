'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, getAccess } from '@/lib/api';
import FileViewerModal from '@/components/FileViewerModal';

/** Opens an in-app PDF viewer for an invoice. The endpoint requires a JWT
 * (so an iframe pointed at the URL would 401); we fetch the file with the
 * bearer token, wrap the response in a blob URL, then hand it to
 * :func:`FileViewerModal` for rendering. The blob URL is revoked on close
 * so we don't leak memory across opens. */
export default function InvoiceViewerModal({
  paymentId,
  onClose,
}: {
  paymentId: number;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = getAccess();
        const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
        const res = await fetch(`${base}/api/v1/payments/${paymentId}/invoice-pdf/`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) {
          throw new ApiError(res.status, null, 'Could not load invoice.');
        }
        const blob = await res.blob();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load invoice.');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [paymentId]);

  const title = `Invoice INV-${String(paymentId).padStart(5, '0')}`;

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-brand-darker/70 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 max-w-sm rounded-2xl bg-surface p-6 shadow-2xl ring-1 ring-line">
          <p className="text-sm font-semibold text-ink">Could not open invoice</p>
          <p className="mt-1 text-xs text-muted">{error}</p>
          <button
            onClick={onClose}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-dark px-4 py-2 text-xs font-semibold text-white hover:bg-brand"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-brand-darker/70 backdrop-blur-sm">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-ink shadow-lg">
          <Loader2 size={14} className="animate-spin text-brand-dark" /> Preparing invoice…
        </div>
      </div>
    );
  }

  return <FileViewerModal url={url} title={title} mime="application/pdf" onClose={onClose} />;
}

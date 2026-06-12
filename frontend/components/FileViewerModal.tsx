'use client';

import { Download, ExternalLink, FileText, X } from 'lucide-react';
import { useEscape } from '@/lib/useEscape';

/** Lightweight in-app viewer for images and PDFs.
 *
 * Browsers can render both natively — image via <img>, PDF via <iframe>
 * pointed at the file URL. We expose a download + open-in-new-tab affordance
 * for anything we can't preview (e.g. .docx). The modal is a focused
 * overlay rather than a full route so the matter chat / transactions table
 * stays one click away.
 */
export default function FileViewerModal({
  url,
  title,
  mime,
  onClose,
}: {
  url: string;
  title?: string;
  /** Override-based hint for renderer choice. Required for blob: URLs
   * (which have no file extension to sniff). */
  mime?: 'application/pdf' | `image/${string}`;
  onClose: () => void;
}) {
  useEscape(onClose);
  const lower = url.split('?')[0].toLowerCase();
  const isBlob = url.startsWith('blob:');
  const isImage = mime?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lower);
  // Blob URLs are usually PDFs in this app (invoices). Treat as PDF when
  // we can't disambiguate.
  const isPdf = mime === 'application/pdf' || /\.pdf$/.test(lower) || (isBlob && !isImage);
  const filename = decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-brand-darker/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light/25 text-brand-dark">
              <FileText size={14} />
            </span>
            <p className="truncate text-sm font-semibold text-ink">{title ?? filename}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={url}
              download={filename}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-brand"
              title="Download"
            >
              <Download size={12} /> Download
            </a>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-brand"
              title="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={title ?? filename} className="max-h-full max-w-full object-contain" />
          ) : isPdf ? (
            <iframe
              src={url}
              title={title ?? filename}
              className="h-full w-full"
            />
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-ink">In-browser preview not available</p>
              <p className="mt-1 text-xs text-muted">Download the file or open it in a new tab.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

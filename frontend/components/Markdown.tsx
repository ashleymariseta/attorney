'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// Allow images (including inline data: images we insert), plus the usual safe
// schemes. Blocks javascript: and other unsafe protocols.
function safeUrl(url: string): string {
  if (url.startsWith('data:image/')) return url;
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return url;
  if (!/:/.test(url)) return url; // relative path
  return '';
}

/**
 * Renders Markdown (AI output, precedent documents) with sensible legal-
 * document styling. No raw HTML is rendered (react-markdown default), so the
 * output is safe.
 */
export default function Markdown({
  children,
  className = '',
  size = 'base',
}: {
  children: string;
  className?: string;
  size?: 'sm' | 'base';
}) {
  const sizeClass = size === 'sm' ? 'text-[13px]' : 'text-[15px]';
  return (
    <div className={`md-body ${sizeClass} leading-7 text-ink ${className}`}>
      <ReactMarkdown
        // remark-breaks: honour single newlines as line breaks so legal
        // documents (party blocks, addresses, numbered clauses) don't collapse
        // onto one another the way default Markdown flows them.
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={safeUrl}
        components={{
          img: (p) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img className="my-3 max-h-[480px] max-w-full rounded-lg border border-line" {...p} />
          ),
          h1: (p) => <h1 className="mt-7 mb-3 text-center text-lg font-bold uppercase tracking-wide" {...p} />,
          h2: (p) => <h2 className="mt-6 mb-2.5 text-base font-bold uppercase tracking-wide" {...p} />,
          h3: (p) => <h3 className="mt-5 mb-2 text-sm font-bold" {...p} />,
          p: (p) => <p className="my-3.5" {...p} />,
          ul: (p) => <ul className="my-3.5 list-disc space-y-1.5 pl-6" {...p} />,
          ol: (p) => <ol className="my-3.5 list-decimal space-y-1.5 pl-6" {...p} />,
          li: (p) => <li className="pl-1" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => <a className="text-brand-dark underline" target="_blank" rel="noreferrer" {...p} />,
          blockquote: (p) => (
            <blockquote className="my-3 border-l-4 border-line pl-4 italic text-ink/80" {...p} />
          ),
          hr: () => <hr className="my-5 border-line" />,
          code: (p) => <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[13px]" {...p} />,
          table: (p) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          th: (p) => <th className="border border-line bg-canvas px-3 py-1.5 text-left font-semibold" {...p} />,
          td: (p) => <td className="border border-line px-3 py-1.5 align-top" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

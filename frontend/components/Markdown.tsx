'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders Markdown (Claude output, precedent documents) with sensible legal-
 * document styling. No raw HTML is rendered (react-markdown default), so the
 * output is safe.
 */
export default function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`md-body text-[15px] leading-relaxed text-ink ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-5 mb-2 text-center text-lg font-bold uppercase tracking-wide" {...p} />,
          h2: (p) => <h2 className="mt-5 mb-2 text-base font-bold uppercase tracking-wide" {...p} />,
          h3: (p) => <h3 className="mt-4 mb-1.5 text-sm font-bold" {...p} />,
          p: (p) => <p className="my-2.5" {...p} />,
          ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-6" {...p} />,
          ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-6" {...p} />,
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

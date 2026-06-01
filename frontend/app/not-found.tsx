import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted">404</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The page you were looking for doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand"
      >
        Go home
      </Link>
    </main>
  );
}

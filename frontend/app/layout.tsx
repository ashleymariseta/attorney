import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Attorney — Lawyer on Demand',
  description: 'Verified legal counsel, on demand.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink font-sans antialiased">{children}</body>
    </html>
  );
}

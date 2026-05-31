import type { Metadata } from 'next';
import { Aldrich } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/Toast';

const aldrich = Aldrich({ subsets: ['latin'], weight: '400', variable: '--font-aldrich' });

export const metadata: Metadata = {
  title: 'Attorney — Lawyer on Demand',
  description: 'Verified legal counsel, on demand.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={aldrich.variable}>
      <body className="min-h-screen bg-canvas text-ink font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Aldrich, Playfair_Display } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import CookieConsent from '@/components/CookieConsent';

const aldrich = Aldrich({ subsets: ['latin'], weight: '400', variable: '--font-aldrich' });
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Attorney — Lawyer on Demand',
    template: '%s · Attorney',
  },
  description:
    'A workspace for you and your lawyer — verified counsel, booked consultations, ' +
    'matter rooms with messages, documents and trust-accounted payments.',
  applicationName: 'Attorney',
  keywords: ['lawyer on demand', 'legal counsel', 'matter rooms', 'trust accounting', 'attorney'],
  authors: [{ name: 'Attorney' }],
  openGraph: {
    type: 'website',
    siteName: 'Attorney',
    title: 'Attorney — Lawyer on Demand',
    description:
      'Verified legal counsel, on demand. Book a consultation, work in a shared matter room, ' +
      'pay safely through trust accounting.',
    url: SITE_URL,
    images: [{ url: '/img/law-6.jpg', width: 1200, height: 630, alt: 'Attorney' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Attorney — Lawyer on Demand',
    description: 'Verified legal counsel, on demand.',
    images: ['/img/law-6.jpg'],
  },
  robots: { index: true, follow: true },
  icons: { icon: '/img/logos/icon-mark-teal.png', apple: '/img/logos/icon-mark-teal.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${aldrich.variable} ${playfair.variable}`}>
      <body className="min-h-screen bg-canvas text-ink font-sans antialiased">
        <ToastProvider>
          {children}
          <CookieConsent />
        </ToastProvider>
      </body>
    </html>
  );
}

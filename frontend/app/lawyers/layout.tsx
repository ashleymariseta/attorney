import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Find a lawyer · Attorney',
  description:
    'Browse verified lawyers and firms by practice area, jurisdiction, experience and rate. Book a consultation in minutes.',
  openGraph: {
    title: 'Find a lawyer · Attorney',
    description:
      'Browse verified lawyers and firms by practice area, jurisdiction, experience and rate. Book a consultation in minutes.',
  },
};

export default function LawyersDirectoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

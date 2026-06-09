import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset password',
  description: 'Choose a new password for your Attorney account.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

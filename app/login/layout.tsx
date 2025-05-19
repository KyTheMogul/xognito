import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Login - Xognito',
  description: 'Sign in to your Xognito account',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
} 
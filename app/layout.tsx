import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Trigger new deployment
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Xognito",
  description: "Your AI-powered memory companion that helps you remember, organize, and recall your thoughts and experiences.",
  keywords: ["AI", "memory", "productivity", "organization", "personal assistant", "cognitive enhancement"],
  authors: [{ name: "Xognito Team" }],
  creator: "Xognito",
  publisher: "Xognito",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://xognito.com'),
  alternates: {
    canonical: '/',
    types: {
      'application/rss+xml': [
        {
          url: '/sitemap.xml',
          title: 'Xognito Sitemap',
        },
      ],
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://xognito.com',
    title: 'Xognito - Your AI Memory Companion',
    description: 'Enhance your memory and productivity with Xognito, your AI-powered personal memory assistant.',
    siteName: 'Xognito',
    images: [
      {
        url: '/XognitoLogoFull.png',
        width: 1200,
        height: 630,
        alt: 'Xognito Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Xognito - Your AI Memory Companion',
    description: 'Enhance your memory and productivity with Xognito, your AI-powered personal memory assistant.',
    creator: '@xognito',
    images: ['/XognitoLogoFull.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/xognito.ico' },
      { url: '/xognito.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/xognito.ico', sizes: '16x16', type: 'image/x-icon' },
    ],
    shortcut: '/xognito.ico',
    apple: '/xognito.ico',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  verification: {
    google: 'your-google-site-verification', // Add your Google verification code
  },
  category: 'technology',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/xognito.ico" sizes="any" />
        <link rel="icon" href="/xognito.ico" type="image/x-icon" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ToastContainer position="top-right" />
      </body>
    </html>
  );
}

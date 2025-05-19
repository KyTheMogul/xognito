import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  description: "Your AI-powered memory companion",
  icons: {
    icon: [
      { url: '/xognito.ico' },
      { url: '/xognito.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/xognito.ico', sizes: '16x16', type: 'image/x-icon' },
    ],
    shortcut: '/xognito.ico',
    apple: '/xognito.ico',
  },
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
      </body>
    </html>
  );
}

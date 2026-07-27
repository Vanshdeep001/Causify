import type { Metadata } from 'next';
import { Syne, Fraunces, Space_Grotesk } from 'next/font/google';
import Providers from './providers';
import './globals.css';

// ---- Fonts ----
const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['700', '800'],
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  weight: ['400', '700', '900'],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

// ---- Metadata ----
export const metadata: Metadata = {
  title: {
    default: 'ShopVerse — Premium Multi-Vendor Marketplace',
    template: '%s | ShopVerse',
  },
  description:
    'Discover premium products from top brands. Shop fashion, electronics, home & more with exclusive deals and fast delivery.',
  keywords: [
    'ecommerce',
    'online shopping',
    'fashion',
    'electronics',
    'deals',
    'ShopVerse',
    'marketplace',
  ],
  authors: [{ name: 'ShopVerse Team' }],
  creator: 'ShopVerse',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    siteName: 'ShopVerse',
    title: 'ShopVerse — Premium Multi-Vendor Marketplace',
    description: 'Discover premium products from top brands with exclusive deals.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ShopVerse',
    description: 'Premium Multi-Vendor Marketplace',
  },
  robots: {
    index: true,
    follow: true,
  },
};

// ---- Root Layout ----
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${syne.variable} ${fraunces.variable} ${spaceGrotesk.variable}`}
    >
      <head />
      <body
        className="min-h-screen antialiased"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

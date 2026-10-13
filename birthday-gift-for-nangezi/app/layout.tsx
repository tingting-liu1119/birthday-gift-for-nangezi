import type { Metadata } from 'next';
import './globals.css';

const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000');
const socialImage = `${siteUrl.replace(/\/$/, '')}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: '一份给南歌子的生日礼物 · From 听听',
  description: '一场为南歌子准备的互动生日仪式。',
  openGraph: {
    title: '一份给南歌子的生日礼物 · From 听听',
    description: '完成小小校准后，开启一场由听听送出的互动生日仪式。',
    type: 'website',
    images: [{ url: socialImage, width: 1200, height: 630, alt: '一份给南歌子的生日礼物，HAPPY BIRTHDAY，From 听听' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '一份给南歌子的生日礼物 · From 听听',
    description: '完成小小校准后，开启一场由听听送出的互动生日仪式。',
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

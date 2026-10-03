import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Launch Detective — ask why about a rocket launch',
  description: 'An AI-guided, interactive 3D what-if explorer for launch timing, orbits, and weather. Educational simulation.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050b18' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

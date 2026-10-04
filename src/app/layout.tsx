import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrbitStudio — what-if launch explorer',
  description: 'An AI-guided, interactive 3D what-if explorer for launch timing, orbits, and weather. Educational simulation.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0b0c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

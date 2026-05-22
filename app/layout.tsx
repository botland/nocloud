import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'nocloud.ai — Private Generative AI Appliances',
  description: 'High-performance private AI appliances for European organizations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

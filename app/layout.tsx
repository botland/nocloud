import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'nocloud.ai — Private Generative AI Appliances | B2B',
  description: 'High-performance on-premise generative AI appliances for European organizations. Fully private. No cloud. Edge, Studio and Forge models with optional managed services.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-950 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}

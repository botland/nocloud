import type { Metadata } from 'next';
import './globals.css';
import { getLocale } from 'next-intl/server';

const titles: Record<string, string> = {
  en: 'nocloud.ai — Private Generative AI Appliances | B2B',
  fr: 'nocloud.ai — Appareils IA Générative Privés | B2B',
};

const descriptions: Record<string, string> = {
  en: 'High-performance on-premise generative AI appliances for European organizations. Fully private. No cloud. Edge, Studio and Forge models with optional managed services.',
  fr: 'Appareils d\'IA générative haute performance sur site pour les organisations européennes. Entièrement privés. Pas de cloud. Modèles Edge, Studio et Forge avec services gérés optionnels.',
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: titles[locale] || titles.en,
    description: descriptions[locale] || descriptions.en,
    icons: {
      icon: '/favicon.svg',
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Font Awesome for consistent icons with full-b2b.html */}
        <link 
          rel="stylesheet" 
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" 
        />
      </head>
      <body className="bg-slate-950 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}

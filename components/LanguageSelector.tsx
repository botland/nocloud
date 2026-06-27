'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';

interface Language {
  code: string;
  name: string;
}

const languages: Language[] = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Fran\u00e7ais' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Espa\u00f1ol' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
];

interface Props {
  variant?: 'bottom' | 'top';
}

export default function LanguageSelector({ variant = 'bottom' }: Props) {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchTo = (newLocale: string) => {
    if (newLocale === currentLocale) return;
    const newPath = pathname.replace(`/${currentLocale}`, `/${newLocale}`);
    router.push(newPath);
  };

  if (variant === 'top') {
    // Only show for countries that speak multiple languages (basic client-side heuristic for now)
    // Proper country detection should be done server-side with IP geolocation.
    if (typeof window === 'undefined') return null;

    const lang = navigator.language.toLowerCase();
    const isMultiLangCountry = lang.startsWith('fr-be') || lang.startsWith('nl-be') || lang.startsWith('de-be');

    if (!isMultiLangCountry) return null;

    return (
      <div className="bg-slate-900 border-b border-slate-800 py-2 text-xs">
        <div className="max-w-7xl mx-auto px-6 flex items-center gap-x-3 text-slate-400">
          <span className="font-medium">Language:</span>
          <select
            value={currentLocale}
            onChange={(e) => switchTo(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1 text-sm focus:outline-none focus:border-cyan-500"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  // Bottom: clean select box (no flags, as requested)
  return (
    <div className="mt-8 pt-6 border-t border-slate-800">
      <label className="block text-xs tracking-[1.5px] text-slate-500 mb-2 font-medium">LANGUAGE</label>
      <select
        value={currentLocale}
        onChange={(e) => switchTo(e.target.value)}
        className="w-full max-w-xs bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}

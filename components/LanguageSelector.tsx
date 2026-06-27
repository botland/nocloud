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

  // Top bar disabled for now - only show when we have reliable country detection (IP geolocation)
  if (variant === 'top') {
    return null;
  }

  // Bottom: clean select
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

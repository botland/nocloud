'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';

interface Language {
  code: string;
  name: string;
  flag: string;
  region?: string;
}

const allLanguages: Language[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
];

interface LanguageSelectorProps {
  variant?: 'bottom' | 'top-suggestion';
}

export default function LanguageSelector({ variant = 'bottom' }: LanguageSelectorProps) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (newLocale: string) => {
    // Replace the current locale segment in the path
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPath);
  };

  if (variant === 'top-suggestion') {
    // Only show if browser suggests a non-English primary language
    const browserLang = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
    const suggested = allLanguages.filter(l => 
      browserLang.startsWith(l.code) || 
      (l.code === 'en' && browserLang.startsWith('en'))
    );

    if (suggested.length === 0 || suggested[0].code === locale) return null;

    return (
      <div className="bg-slate-900 border-b border-slate-800 py-2 text-xs">
        <div className="max-w-7xl mx-auto px-6 flex items-center gap-x-3 text-slate-400">
          <span className="font-medium">Suggested for your region:</span>
          <div className="flex gap-x-2">
            {suggested.slice(0, 3).map((lang) => (
              <button
                key={lang.code}
                onClick={() => switchLocale(lang.code)}
                className={`px-3 py-1 rounded-full border transition-colors ${locale === lang.code ? 'bg-cyan-400 text-slate-950 border-cyan-400' : 'border-slate-700 hover:bg-slate-800'}`}
              >
                {lang.flag} {lang.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Bottom full selector
  return (
    <div className="pt-8 border-t border-slate-800 mt-8">
      <div className="text-xs text-slate-500 mb-3 font-medium tracking-wider">LANGUAGE / LANGUE</div>
      <div className="flex flex-wrap gap-x-2 gap-y-2 text-sm">
        {allLanguages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => switchLocale(lang.code)}
            className={`px-4 py-1.5 rounded-2xl border transition-all flex items-center gap-x-2 ${locale === lang.code 
              ? 'bg-white text-slate-950 border-white font-semibold' 
              : 'border-slate-700 hover:bg-slate-900 hover:border-slate-600 text-slate-300'}`}
          >
            <span>{lang.flag}</span>
            <span>{lang.name}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-3">More languages coming soon. Current selection updates the entire site.</p>
    </div>
  );
}

'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';

interface Language {
  code: string;
  name: string;
  flag: string;
}

const languages: Language[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
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

  // Top suggestion bar (only show if browser language suggests something different)
  if (variant === 'top') {
    if (typeof window === 'undefined') return null;

    const browserLang = navigator.language.toLowerCase().split('-')[0];
    const suggestedLang = languages.find(l => l.code === browserLang);

    if (!suggestedLang || suggestedLang.code === currentLocale || suggestedLang.code === 'en') {
      return null;
    }

    return (
      <div className="bg-slate-900 border-b border-slate-800 py-2 text-xs">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
          <span className="font-medium">Language for your region:</span>
          <button
            onClick={() => switchTo(suggestedLang.code)}
            className="px-4 py-1 rounded-full border border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-slate-950 transition-colors"
          >
            {suggestedLang.flag} {suggestedLang.name}
          </button>
          <button
            onClick={() => switchTo('en')}
            className="px-3 py-1 text-xs text-slate-500 hover:text-slate-300"
          >
            Use English instead
          </button>
        </div>
      </div>
    );
  }

  // Bottom full selector
  return (
    <div className="mt-10 pt-8 border-t border-slate-800">
      <div className="text-xs tracking-[2px] text-slate-500 mb-4 font-medium">CHOOSE LANGUAGE</div>
      <div className="flex flex-wrap gap-2">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => switchTo(lang.code)}
            className={`px-5 py-2 rounded-2xl border text-sm flex items-center gap-x-2 transition-all
              ${currentLocale === lang.code 
                ? 'bg-white text-slate-950 border-white font-semibold' 
                : 'border-slate-700 hover:bg-slate-900 text-slate-300 hover:border-slate-500'}`}
          >
            <span className="text-base">{lang.flag}</span>
            <span>{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

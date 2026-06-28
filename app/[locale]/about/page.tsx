'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import {
  BRAND_DISPLAY,
  MANAGING_DIRECTOR,
} from '@/lib/brand';

export default function AboutPage() {
  const locale = useLocale();
  const t = useTranslations('about');

  const whyList = t.raw('whyList') as string[];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800">
        <Container className="py-6 flex items-center justify-between">
          <Link href={`/${locale}`} className="flex items-center gap-x-3">
            <span className="text-2xl font-bold tracking-tighter">{BRAND_DISPLAY}</span>
          </Link>
          <Link 
            href={`/${locale}`}
            className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            {t('back')}
          </Link>
        </Container>
      </div>

      <Container className="max-w-3xl py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">{t('title')}</h1>
        <p className="text-xl text-slate-400 mb-10">{t('subtitle')}</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('missionTitle')}</h2>
            <p>{t('missionText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('founderTitle', { director: MANAGING_DIRECTOR })}</h2>
            <p>{t('founderP1')}</p>
            <p className="mt-4">{t('founderP2')}</p>
            <p className="mt-4">{t('founderP3')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('whyTitle')}</h2>
            <p>{t('whyText')}</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              {whyList.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </section>
        </div>

        <div className="mt-12">
          <Link 
            href={`/${locale}#products`}
            className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all"
          >
            {t('cta')}
          </Link>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          {t('copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}
        </div>
      </Container>
    </div>
  );
}
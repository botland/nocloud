'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import { BRAND_DISPLAY, getBrandEmail } from '@/lib/brand';

export default function PrivacyPage() {
  const locale = useLocale();
  const t = useTranslations('privacy');
  const email = getBrandEmail('support');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800">
        <Container className="py-6 flex items-center justify-between">
          <Link href={`/${locale}`} className="flex items-center gap-x-3">
            <span className="text-2xl font-bold tracking-tighter">{BRAND_DISPLAY}</span>
          </Link>
          <Link href={`/${locale}`} className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
            {t('back')}
          </Link>
        </Container>
      </div>

      <Container className="max-w-3xl py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">{t('title')}</h1>
        <p className="text-slate-400 mb-10">{t('updated')}</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('commitmentTitle')}</h2>
            <p>{t('commitmentText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataTitle')}</h2>
            <p>{t('dataText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('useTitle')}</h2>
            <p>{t('useText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('storageTitle')}</h2>
            <p>{t('storageText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('rightsTitle')}</h2>
            <p>{t('rightsText', { email })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('cookiesTitle')}</h2>
            <p>{t('cookiesText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('changesTitle')}</h2>
            <p>{t('changesText')}</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          {t('copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}
        </div>
      </Container>
    </div>
  );
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import {
  BRAND_DISPLAY,
  COMPANY_LEGAL_NAME,
  REGISTRY_NUMBER,
  VAT_NUMBER,
  COMPANY_ADDRESS,
  MANAGING_DIRECTOR,
  LEGAL_CONTACT_EMAIL,
} from '@/lib/brand';

export default function LegalPage() {
  const locale = useLocale();
  const t = useTranslations('legal');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Top bar */}
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

      {/* Main content */}
      <Container className="max-w-3xl py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">{t('title')}</h1>
        <p className="text-slate-400 mb-10">{t('updated')}</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('companyInfoTitle')}</h2>
            <p><strong>{t('companyName', { companyName: COMPANY_LEGAL_NAME })}</strong></p>
            <p>{t('regNumber', { regNumber: REGISTRY_NUMBER })}</p>
            <p>{t('vatNumber', { vatNumber: VAT_NUMBER })}</p>
            <p>{t('address', { address: COMPANY_ADDRESS })}</p>
            <p>{t('director', { director: MANAGING_DIRECTOR })}</p>
            <p>
              {t('contactLabel')}: <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-cyan-400 hover:underline"
              >
                {t('contactEmail', { contactEmail: LEGAL_CONTACT_EMAIL })}
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('operatorTitle')}</h2>
            <p>{t('operatorText', { companyName: COMPANY_LEGAL_NAME })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('liabilityTitle')}</h2>
            <p>{t('liabilityText1')}</p>
            <p className="mt-4">{t('liabilityText2', { companyName: COMPANY_LEGAL_NAME })}</p>
            <p className="mt-4">{t('liabilityText3')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('intellectualPropertyTitle')}</h2>
            <p>{t('intellectualPropertyText', { companyName: COMPANY_LEGAL_NAME })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('governingLawTitle')}</h2>
            <p>{t('governingLawText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('disputeResolutionTitle')}</h2>
            <p>{t('disputeResolutionText')}</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          {t('copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}
        </div>
      </Container>
    </div>
  );
}

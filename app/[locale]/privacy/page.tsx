'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import { BRAND_DISPLAY, COMPANY_LEGAL_NAME, LEGAL_CONTACT_EMAIL } from '@/lib/brand';

export default function PrivacyPage() {
  const locale = useLocale();
  const t = useTranslations('privacy');

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
            <h2 className="text-xl font-semibold text-white mb-3">{t('introductionTitle')}</h2>
            <p>{t('introductionText', { companyName: COMPANY_LEGAL_NAME })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataControllerTitle')}</h2>
            <p>{t('dataControllerText', { companyName: COMPANY_LEGAL_NAME, contactEmail: LEGAL_CONTACT_EMAIL })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataWeCollectTitle')}</h2>
            <p>{t('dataWeCollectText')}</p>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-slate-300">
              {(t.raw('dataWeCollectList') as string[] || []).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('howWeUseDataTitle')}</h2>
            <p>{t('howWeUseDataText')}</p>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-slate-300">
              {(t.raw('howWeUseDataList') as string[] || []).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('legalBasisTitle')}</h2>
            <p>{t('legalBasisText')}</p>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-slate-300">
              {(t.raw('legalBasisList') as string[] || []).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataSharingTitle')}</h2>
            <p>{t('dataSharingText')}</p>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-slate-300">
              {(t.raw('dataSharingList') as string[] || []).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm italic">{t('dataSharingNote')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataRetentionTitle')}</h2>
            <p>{t('dataRetentionText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('yourRightsTitle')}</h2>
            <p>{t('yourRightsText')}</p>
            <ul className="list-disc pl-6 mt-3 space-y-1 text-slate-300">
              {(t.raw('yourRightsList') as string[] || []).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <p className="mt-3">{t('yourRightsContact', { contactEmail: LEGAL_CONTACT_EMAIL })}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('cookiesTitle')}</h2>
            <p>{t('cookiesText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('dataSecurityTitle')}</h2>
            <p>{t('dataSecurityText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('internationalTransfersTitle')}</h2>
            <p>{t('internationalTransfersText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('changesTitle')}</h2>
            <p>{t('changesText')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('contactTitle')}</h2>
            <p>{t('contactText')}</p>
            <p className="mt-2">
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-cyan-400 hover:underline"
              >
                {t('contactEmail', { contactEmail: LEGAL_CONTACT_EMAIL })}
              </a>
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          {t('copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}
        </div>
      </Container>
    </div>
  );
}
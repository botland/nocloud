'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function SuccessPage() {
  const t = useTranslations('success');
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-20 h-20 bg-emerald-900/30 rounded-full flex items-center justify-center mb-8">
          <i className="fa-solid fa-check text-emerald-400 text-5xl"></i>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight mb-4">{t('title')}</h1>
        <p className="text-lg text-slate-400 mb-8">{t('message')}</p>

        {sessionId && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-8 text-sm">
            <div className="text-slate-400 mb-1">{t('reference', { id: '' })}</div>
            <div className="font-mono text-slate-200 break-all">{sessionId}</div>
          </div>
        )}

        <Link
          href="/"
          className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all"
        >
          {t('returnHome')}
        </Link>

        <div className="mt-10 text-xs text-slate-500">
          You will also receive a confirmation email with tracking and setup instructions.
        </div>
      </div>
    </div>
  );
}

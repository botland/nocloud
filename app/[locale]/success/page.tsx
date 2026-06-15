'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function SuccessPage() {
  const t = useTranslations('success');
  const locale = useLocale();

  // Client-side only to avoid any useSearchParams hook side effects on hydration/interactivity.
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const sid = sp.get('session_id');
      setSessionId(sid);
      if (sid) {
        // Best-effort: ensure service subscriptions are created for full + card/sepa orders.
        // This is a fallback so users reliably see the recurring subs even if the
        // Stripe webhook (the canonical path) has not yet delivered or is not configured
        // in their local dev environment (common cause of "still no subs" for full credit card).
        // The webhook will also call the same helper (with idempotency guard).
        fetch(`/api/fulfill?session_id=${encodeURIComponent(sid)}`).catch(() => {});
      }
    }
  }, []);

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
            <div className="text-slate-400 mb-1">{t('referenceLabel')}</div>
            <div className="font-mono text-slate-200 break-all">{sessionId}</div>
          </div>
        )}

        <Link
          href={`/${locale}`}
          className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all"
        >
          {t('returnHome')}
        </Link>

        <div className="mt-10 text-xs text-slate-500">
          {t('emailNote')}
        </div>
      </div>
    </div>
  );
}

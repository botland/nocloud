'use client';

import { useLocale } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import { BRAND_DISPLAY, getBrandEmail } from '@/lib/brand';

export default function LegalPage() {
  const locale = useLocale();

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
            ← Back to home
          </Link>
        </Container>
      </div>

      <Container className="max-w-3xl py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">Legal Notice</h1>
        <p className="text-slate-400 mb-10">Last updated: June 2026</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Company Information</h2>
            <p><strong>OwnEdge OÜ</strong> (to be incorporated)</p>
            <p>Registration number: [To be completed — Estonia company registry]</p>
            <p>Registered office: Tallinn, Estonia</p>
            <p>Director / Management Board: Alexandre Bureau</p>
            <p>Contact: <a href={`mailto:${getBrandEmail('sales')}`} className="text-cyan-400 hover:underline">{getBrandEmail('sales')}</a></p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Website Operator</h2>
            <p>
              This website is operated by OwnEdge OÜ, a company to be incorporated in the Republic of Estonia.
              OwnEdge provides high-performance, on-premise appliances for private generative AI inference.
              All hardware is designed for European organizations that require full data sovereignty, low latency, and predictable costs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Liability &amp; Disclaimers</h2>
            <p>
              The information on this website is provided for general informational purposes only.
              While we strive for accuracy, OwnEdge makes no representations or warranties of any kind, express or implied, about the completeness, accuracy, reliability, suitability or availability of the products, services, or related graphics.
            </p>
            <p className="mt-4">
              In no event will OwnEdge be liable for any loss or damage including without limitation, indirect or consequential loss or damage, or any loss or damage whatsoever arising from loss of data or profits arising out of, or in connection with, the use of this website or the products described herein.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Governing Law</h2>
            <p>
              These terms and any dispute arising out of or in connection with them shall be governed by and construed in accordance with the laws of the Republic of Estonia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p>
              For any legal inquiries, please contact us at <a href={`mailto:${getBrandEmail('sales')}`} className="text-cyan-400 hover:underline">{getBrandEmail('sales')}</a>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          © {new Date().getFullYear()} {BRAND_DISPLAY} — Private generative AI infrastructure for Europe
        </div>
      </div>
    </div>
  );
}

'use client';

import { useLocale } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import { BRAND_DISPLAY, getBrandEmail } from '@/lib/brand';

export default function PrivacyPage() {
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
        <h1 className="text-4xl font-semibold tracking-tight mb-4">Privacy Policy</h1>
        <p className="text-slate-400 mb-10">Last updated: June 2026 • Compliant with GDPR (RGPD)</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Our Commitment to Privacy</h2>
            <p>
              At OwnEdge, privacy is not a feature — it is the foundation of everything we build.
              Our appliances run entirely on-premise. Your data, models, and inference workloads never leave your infrastructure.
              We collect the minimum information necessary to process your order and provide support.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Data We Collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Order information</strong>: Company name, email address, VAT / SIRET number (for EU compliance and invoicing), billing and shipping addresses.</li>
              <li><strong>Payment information</strong>: Handled securely by Stripe. We never store full card details.</li>
              <li><strong>Technical data</strong>: Basic server logs for security and fraud prevention (IP address, user agent). No profiling or marketing tracking.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How We Use Your Data</h2>
            <p>
              We use your information solely to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Process and fulfill your hardware order</li>
              <li>Issue invoices and manage VAT / reverse charge</li>
              <li>Provide customer support and service subscriptions (Managed Care, SecureVault Backup)</li>
              <li>Comply with legal obligations (tax, anti-fraud)</li>
            </ul>
            <p className="mt-4">We do not sell, rent, or share your data with third parties for marketing purposes.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Data Storage &amp; Security</h2>
            <p>
              All customer data is stored within the European Union.
              Payment processing is handled by Stripe (PCI-DSS compliant).
              We implement appropriate technical and organizational measures to protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Your Rights (GDPR)</h2>
            <p>
              You have the right to access, rectify, erase, restrict processing, and port your personal data.
              To exercise these rights, contact us at <a href={`mailto:${getBrandEmail('support')}`} className="text-cyan-400 hover:underline">{getBrandEmail('support')}</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Cookies &amp; Tracking</h2>
            <p>
              This site uses only essential technical cookies for cart persistence and checkout flow.
              No third-party analytics or advertising cookies are used.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. The latest version will always be available on this page.
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

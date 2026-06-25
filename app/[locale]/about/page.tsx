'use client';

import { useLocale } from 'next-intl';
import Link from 'next/link';
import Container from '@/components/Container';
import { BRAND_DISPLAY } from '@/lib/brand';

export default function AboutPage() {
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
        <h1 className="text-4xl font-semibold tracking-tight mb-4">About OwnEdge</h1>
        <p className="text-xl text-slate-400 mb-10">Private generative AI infrastructure, built for European organizations that demand control.</p>

        <div className="prose prose-invert max-w-none text-slate-300 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Our Mission</h2>
            <p>
              OwnEdge exists to give European teams and organizations full ownership of their generative AI workloads.
              No cloud. No data exfiltration. No unpredictable token costs. Just powerful, on-premise appliances that run the latest open-source models at the edge or in your datacenter — with complete sovereignty.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">The Founder</h2>
            <p>
              OwnEdge was founded by Alexandre Bureau, an engineer with deep expertise in high-performance computing.
            </p>
            <p className="mt-4">
              He has extensive experience designing, building, and operating very large HPC clusters for the most demanding AI and scientific workloads.
              His background spans advanced industrial systems and energy infrastructure (previously at GE) and he currently contributes to a leading name in the high-performance computing industry.
            </p>
            <p className="mt-4">
              This unique combination of large-scale systems experience and focus on European data sovereignty led to OwnEdge: purpose-built appliances that deliver enterprise-grade generative AI performance without compromising privacy or control.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Why OwnEdge Appliances?</h2>
            <p>
              Every system we ship — from the compact Edge desktop to the full-scale Forge enterprise rack — is engineered for one purpose:
              running private, high-performance inference on your terms.
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>Pre-configured with leading open-source models</li>
              <li>Optional managed services and encrypted backup</li>
              <li>Full European data residency and support</li>
              <li>Predictable one-time hardware cost + optional recurring services</li>
            </ul>
          </section>
        </div>

        <div className="mt-12">
          <Link 
            href={`/${locale}#products`}
            className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all"
          >
            Explore the appliances
          </Link>
        </div>

        <div className="mt-16 pt-8 border-t border-slate-800 text-xs text-slate-500">
          © {new Date().getFullYear()} {BRAND_DISPLAY} — Private generative AI infrastructure for Europe
        </div>
      </div>
    </div>
  );
}

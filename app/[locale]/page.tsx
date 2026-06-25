'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import ProductCard from '@/components/ProductCard';
import ConfiguratorModal from '@/components/ConfiguratorModal';
import CartSidebar from '@/components/CartSidebar';
import CheckoutModal from '@/components/CheckoutModal';
import Container from '@/components/Container';
import { Product, CartItem, CheckoutFormDraft } from '@/lib/types';
import { HARDWARE_PRICES, calculateHardwarePrice } from '@/lib/pricing';
import { resolveHardwarePrice, resolveMinServicePrice } from '@/lib/promotions';
import PromoBadge from '@/components/PromoBadge';
import PromoPrice from '@/components/PromoPrice';
import { BRAND_NAME, BRAND_TLD, BRAND_SLUG, BRAND_DISPLAY, getBrandEmail } from '@/lib/brand';
import LogoIcon from '@/icons/logo.svg';
import LanguageSelector from '@/components/LanguageSelector';

// ... (rest of the component is unchanged except footer and addition of top suggestion + LanguageSelector in footer)

// In the return, after the main content and before or inside footer:

// Add this near the top of the page (after navbar or as a thin bar):
{/* Conditional top language suggestion for non-English browsers */}
<LanguageSelector variant="top-suggestion" />

// In the footer, replace the old simple links with:
<footer className="border-t border-slate-800 py-9 text-sm">
  <Container className="flex flex-col md:flex-row justify-between items-center gap-y-4 text-slate-400">
    <div>{t('footer.copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}</div>
    <div className="flex gap-x-6 text-xs">
      <a href={`/${locale}/legal`} className="hover:text-slate-300">{t('footer.legal')}</a>
      <a href={`/${locale}/privacy`} className="hover:text-slate-300">{t('footer.privacy')}</a>
      <a href={`mailto:${getBrandEmail('support')}`} className="hover:text-slate-300">{t('footer.support')}</a>
    </div>
  </Container>

  {/* Full language selector at the bottom as requested */}
  <Container>
    <LanguageSelector variant="bottom" />
  </Container>
</footer>

// Note: The full page.tsx with all previous logic is preserved; only footer and import + top suggestion added.
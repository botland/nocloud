'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import ProductCard from '@/components/ProductCard';
import ConfiguratorModal from '@/components/ConfiguratorModal';
import CartSidebar from '@/components/CartSidebar';
import CheckoutModal from '@/components/CheckoutModal';
import Container from '@/components/Container';
import { Product, CartItem, CheckoutFormDraft } from '@/lib/types';
import { HARDWARE_PRICES, calculateHardwarePrice } from '@/lib/pricing';
import { isPreorderMode } from '@/lib/commerce-mode';
import { resolveHardwarePrice, resolveMinServicePrice } from '@/lib/promotions';
import PromoBadge from '@/components/PromoBadge';
import PromoPrice from '@/components/PromoPrice';
import { BRAND_NAME, BRAND_TLD, BRAND_SLUG, BRAND_DISPLAY, getBrandEmail } from '@/lib/brand';
import LogoIcon from '@/icons/logo.svg';

const baseProducts = [
  { id: 0, slug: 'edge', price: HARDWARE_PRICES.edge },
  { id: 1, slug: 'studio', price: HARDWARE_PRICES.studio },
  { id: 2, slug: 'forge', price: HARDWARE_PRICES.forge },
];

export default function LocaleHome() {
  const t = useTranslations();
  const preorderMode = isPreorderMode();

  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // For re-editing an existing cart item from the sidebar (prefill customization, services, qty)
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  // When user opens edit from cart, we want to return to cart on cancel or after update
  const [returnToCartAfterConfig, setReturnToCartAfterConfig] = useState(false);

  // Persisted checkout form draft so that if user fills B2B info, goes to Stripe, and cancels,
  // the company/email/address etc. are still there when they retry.
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutFormDraft | null>(null);

  // Refs to track when we've loaded persisted data from localStorage.
  // Used to prevent the persist effects from overwriting the real data with the initial empty state
  // on page load (including after Stripe cancel redirects).
  const cartLoadedRef = useRef(false);
  const draftLoadedRef = useRef(false);

  // Persist checkout draft
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    try {
      if (checkoutDraft) {
        localStorage.setItem(`${BRAND_SLUG}_checkout_draft`, JSON.stringify(checkoutDraft));
      } else {
        localStorage.removeItem(`${BRAND_SLUG}_checkout_draft`);
      }
    } catch {}
  }, [checkoutDraft]);

  // Persist cart to localStorage whenever it changes (survives cancel from Stripe, refreshes, etc.).
  useEffect(() => {
    if (!cartLoadedRef.current) return;
    try {
      localStorage.setItem(`${BRAND_SLUG}_cart`, JSON.stringify(cart));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [cart]);

  // Load cart + draft from localStorage *after* the first client render.
  // This guarantees the server render and the first client render produce identical HTML
  // (both start with empty cart / null draft), avoiding hydration mismatches on the cart badge etc.
  // The actual values from localStorage are applied in a subsequent render via setState.
  // We also set the *LoadedRef so that persist effects know it's safe to write (prevents
  // the initial empty state from overwriting previously persisted data on reloads/cancels).
  useEffect(() => {
    try {
      const savedCart = localStorage.getItem(`${BRAND_SLUG}_cart`);
      if (savedCart) {
        setCart(JSON.parse(savedCart));
      }
    } catch {
      // ignore storage / JSON errors (corrupt data, private mode, etc.)
    }
    cartLoadedRef.current = true;
  }, []);

  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(`${BRAND_SLUG}_checkout_draft`);
      if (savedDraft) {
        setCheckoutDraft(JSON.parse(savedDraft));
      }
    } catch {}
    draftLoadedRef.current = true;
  }, []);

  // Client-side only check for ?canceled=true (from Stripe cancel_url).
  // Using useEffect + URLSearchParams avoids useSearchParams() hook entirely,
  // which was causing hydration and event handler attachment issues for
  // interactive elements (configure buttons, basket/cart button, etc.).
  // We also clean the param from the URL so the banner doesn't re-appear on refresh.
  const [showCanceled, setShowCanceled] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('canceled') === 'true') {
        setShowCanceled(true);
        // Auto-open the cart sidebar so the user immediately sees their restored items.
        setIsCartOpen(true);

        // Remove the param so a refresh doesn't keep showing the canceled banner forever.
        sp.delete('canceled');
        const newSearch = sp.toString();
        const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, []);

  const products: Product[] = baseProducts.map((base) => {
    const resolved = resolveHardwarePrice(base.slug);
    return {
      ...base,
      price: resolved.net,
      listPrice: resolved.list > resolved.net ? resolved.list : undefined,
      promotionBadge: resolved.badge,
      promotionBadges: resolved.badges,
      name: t(`products.items.${base.slug}.name`),
      tier: t(`products.items.${base.slug}.tier`),
      description: t(`products.items.${base.slug}.description`),
    };
  });

  const openConfigurator = (product: Product, editItem?: CartItem) => {
    setSelectedProduct(product);
    setEditingCartItem(editItem || null);
    setIsConfiguratorOpen(true);
  };

  const addToCart = (item: CartItem) => {
    // If we opened the configurator to edit an existing cart item, replace it in place
    // (preserve the original cart item id, take the newly computed customization/quantity/services/totalPrice).
    // Otherwise append as a new line.
    setCart((prev) => {
      if (editingCartItem) {
        return prev.map((ci) =>
          ci.id === editingCartItem.id
            ? { ...item, id: editingCartItem.id }
            : ci
        );
      }
      return [...prev, item];
    });

    setIsConfiguratorOpen(false);
    setEditingCartItem(null);
    setSelectedProduct(null);
    setReturnToCartAfterConfig(false);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const editCartItem = (item: CartItem) => {
    setReturnToCartAfterConfig(true);
    setIsCartOpen(false);
    openConfigurator(item.product, item);
  };

  const updateCartQuantity = (id: number, newQuantity: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          // Use the shared calculator when customization is present (single logical component).
          const unit = resolveHardwarePrice(
            item.product.slug,
            item.customization,
          ).net;
          const newTotal = unit * newQuantity;
          return { ...item, quantity: newQuantity, totalPrice: newTotal };
        }
        return item;
      })
    );
  };

  const openCheckout = () => {
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  const closeCheckout = () => {
    setIsCheckoutOpen(false);
  };

  // Called by CheckoutModal as user types so the draft survives even if they partially fill then close.
  const updateCheckoutDraft = (partial: Partial<CheckoutFormDraft>) => {
    setCheckoutDraft((prev) => {
      const base: CheckoutFormDraft = prev || {
        email: '',
        company: '',
        vatNumber: '',
        poNumber: '',
        address: '',
        city: '',
        postal: '',
        country: 'FR',
        deliveryDifferent: false,
        deliveryAddress: '',
        deliveryCity: '',
        deliveryPostal: '',
        deliveryCountry: 'FR',
        paymentMethod: 'stripe',
        financing: 'full',
        vatInclusive: false,
      };
      return { ...base, ...partial };
    });
  };

  // Clear draft on successful order (along with cart)
  const handleOrderComplete = () => {
    setCart([]);
    setCheckoutDraft(null);
    try {
      localStorage.removeItem(`${BRAND_SLUG}_cart`);
      localStorage.removeItem(`${BRAND_SLUG}_checkout_draft`);
    } catch {}
    closeCheckout();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <Container>
          <div className="flex items-center justify-between h-20">
            {/* Logo with white background + Cloud Slash */}
            <div className="flex items-center gap-x-3">
              <div className="flex items-center gap-x-2.5">
<div className="w-20 h-20 bg-[#0a1428] rounded-2xl flex items-center justify-center">
  <LogoIcon className="w-full h-full text-cyan-400" />
</div>
                <div className="flex items-baseline">
                  <span className="font-display text-[28px] font-semibold tracking-tighter">{BRAND_NAME}</span>
                  <span className="text-cyan-400 font-display text-[28px] font-semibold">{BRAND_TLD}</span>
                </div>
              </div>
              <div className="hidden md:block px-3 py-1 text-[10px] font-bold tracking-[1.5px] border border-slate-700 rounded-2xl text-slate-400">B2B</div>
            </div>

            <div className="hidden md:flex items-center gap-x-9 text-sm font-medium">
              <a href="#products" className="hover:text-cyan-400 transition-colors">{t('nav.products')}</a>
              <a href="#services" className="hover:text-cyan-400 transition-colors">{t('nav.services')}</a>
              <a href="#why" className="hover:text-cyan-400 transition-colors">{t('nav.why', { brand: BRAND_NAME })}</a>
              <a href="#docs" className="hover:text-cyan-400 transition-colors">{t('nav.docs')}</a>
            </div>

            <div className="flex items-center gap-x-3">
              <div className="flex border border-slate-700 rounded-3xl overflow-hidden text-sm">
                <a href="/en" className="px-4 py-1.5 text-xs font-semibold hover:bg-slate-900">EN</a>
                <a href="/fr" className="px-4 py-1.5 text-xs font-semibold border-l border-slate-700 hover:bg-slate-900">FR</a>
              </div>

              <button onClick={() => setIsCartOpen(true)} className="flex items-center gap-x-2 px-5 py-2 text-sm font-medium border border-slate-700 hover:bg-slate-900 rounded-3xl transition-colors">
                <i className="fa-solid fa-shopping-cart"></i>
                <span className="font-mono text-xs bg-slate-800 px-1.5 rounded">{cart.length}</span>
              </button>
            </div>
          </div>
        </Container>
      </nav>

      {/* Canceled payment feedback (from Stripe cancel_url) */}
      {showCanceled && (
        <div className="border-b border-amber-900/50 bg-amber-950/60">
          <Container className="py-3 text-sm flex items-center gap-x-3 text-amber-300">
            <i className="fa-solid fa-exclamation-triangle"></i>
            <span className="font-medium">{t('canceledTitle')}</span>
            <span className="text-amber-400/80">{t('canceledMessage')}</span>

            {/* Improved actions: direct way to continue, and dismiss */}
            <button
              onClick={() => {
                setIsCartOpen(true);
                setShowCanceled(false);
              }}
              className="ml-auto text-xs px-3 py-1 border border-amber-700 hover:bg-amber-900/40 rounded-full transition-colors"
            >
              View cart
            </button>
            <button
              onClick={() => setShowCanceled(false)}
              className="text-amber-400 hover:text-amber-200 text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </Container>
        </div>
      )}

      {/* Hero */}
      <Container className="pt-16 pb-14">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-x-2 px-4 h-9 rounded-3xl bg-slate-900 border border-slate-800 text-sm mb-6">
            <div className="flex items-center gap-x-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${preorderMode ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
              <span className="font-medium">{t(preorderMode ? 'hero.badgePreorder' : 'hero.badge')}</span>
            </div>
          </div>
          
          <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter leading-[1.05] mb-5">
            {t('hero.title1')}<br />
            <span className="text-white">{t('hero.title2')}</span>
          </h1>
          
          <p className="max-w-lg text-xl text-slate-400 mb-9">
            {t('hero.subtitle')}
          </p>
          
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <button onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })} className="px-8 h-14 bg-white text-slate-950 font-semibold rounded-3xl flex items-center justify-center gap-x-3 text-base hover:bg-slate-100 transition-all shadow-lg">
              {t('hero.cta1')} <i className="fa-solid fa-arrow-right ml-1"></i>
            </button>
          </div>
          
          <div className="mt-8 flex items-center gap-x-8 text-sm">
            <div className="text-slate-400">{t('hero.trusted')}</div>
          </div>
        </div>
      </Container>

      {/* Products */}
      <div id="products" className="pb-16">
        <Container>
          <div className="flex items-end justify-between mb-8">
          <div>
            <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-1">{t('products.tag')}</div>
            <h2 className="text-[2.1rem] leading-[2.4rem] font-semibold tracking-tighter">{t('products.title')}</h2>
          </div>
          <div className="hidden lg:block text-sm text-slate-400 max-w-xs text-right">
            {t('products.blurb')}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onConfigure={() => openConfigurator(product)} />
          ))}
        </div>
          </Container>
      </div>

      {/* Services */}
      <div id="services" className="bg-slate-900 border-y border-slate-800 py-16">
        <Container>
          <div className="max-w-xl mb-9">
            <div className="text-cyan-400 text-xs font-bold tracking-[2.5px] mb-2">{t('services.tag')}</div>
            <h2 className="text-[2.1rem] leading-[2.4rem] font-semibold tracking-tighter">{t('services.title1')}<br />{t('services.title2')}</h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
            <div className="bg-slate-950 border border-slate-700 p-7 rounded-3xl relative">
              {(() => {
                const mc = resolveMinServicePrice('managedCare');
                return mc.badge ? <PromoBadge badge={mc.badge} /> : null;
              })()}
              <div className="flex gap-x-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-900/30 text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-headset text-2xl"></i>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-xl">{t('services.managedCare')}</div>
                  {(() => {
                    const mc = resolveMinServicePrice('managedCare');
                    return (
                      <div className="text-emerald-400 font-medium mt-1 flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xs text-slate-400">{t('products.from')}</span>
                        <PromoPrice
                          amount={mc.net}
                          listAmount={mc.list > mc.net ? mc.list : undefined}
                          suffix={t('common.perMonthLong')}
                        />
                      </div>
                    );
                  })()}
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> {t('services.managedCareDesc1')}</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> {t('services.managedCareDesc2')}</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> {t('services.managedCareDesc3')}</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-950 border border-slate-700 p-7 rounded-3xl relative">
              {(() => {
                const vault = resolveMinServicePrice('secureVaultBackup');
                return vault.badge ? <PromoBadge badge={vault.badge} /> : null;
              })()}
              <div className="flex gap-x-4">
                <div className="w-11 h-11 rounded-2xl bg-sky-900/30 text-sky-400 flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-shield-halved text-2xl"></i>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-xl">{t('services.secureVaultBackup')}</div>
                  {(() => {
                    const vault = resolveMinServicePrice('secureVaultBackup');
                    return (
                      <div className="text-sky-400 font-medium mt-1 flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xs text-slate-400">{t('products.from')}</span>
                        <PromoPrice
                          amount={vault.net}
                          listAmount={vault.list > vault.net ? vault.list : undefined}
                          suffix={t('common.perMonthLong')}
                        />
                      </div>
                    );
                  })()}
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> {t('services.secureVaultBackupDesc1')}</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> {t('services.secureVaultBackupDesc2')}</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> {t('services.secureVaultBackupDesc3')}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* Why NoCloud */}
      <div id="why" className="py-20">
        <Container>
          <div className="grid md:grid-cols-12 gap-x-10">
          <div className="md:col-span-5 mb-10 md:mb-0">
            <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-3">{t('why.tag')}</div>
            <h2 className="text-[2.1rem] leading-none font-semibold tracking-tighter">{t('why.title1')}<br />{t('why.title2')}<br />{t('why.title3')}</h2>
          </div>
<div className="md:col-span-7">
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
      <i className="fa-solid fa-lock text-3xl text-cyan-400 mb-4"></i>
      <div className="font-semibold mb-1.5">{t('why.privacyTitle')}</div>
      <p className="text-sm text-slate-400">{t('why.privacyDesc')}</p>
    </div>
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
      <i className="fa-solid fa-bolt text-3xl text-cyan-400 mb-4"></i>
      <div className="font-semibold mb-1.5">{t('why.latencyTitle')}</div>
      <p className="text-sm text-slate-400">{t('why.latencyDesc')}</p>
    </div>
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
      <i className="fa-solid fa-file-invoice-dollar text-3xl text-cyan-400 mb-4"></i>
      <div className="font-semibold mb-1.5">{t('why.costsTitle')}</div>
      <p className="text-sm text-slate-400">{t('why.costsDesc')}</p>
    </div>
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
      <i className="fa-solid fa-sync text-3xl text-cyan-400 mb-4"></i>
      <div className="font-semibold mb-1.5">{t('why.controlTitle')}</div>
      <p className="text-sm text-slate-400">{t('why.controlDesc')}</p>
    </div>
  </div>
</div>
          </div>
        </Container>
      </div>

      <div className="border-t border-slate-800 bg-slate-900 py-14">
        <Container className="text-center">
          <h3 className="text-3xl font-semibold tracking-tight mb-3">{t('custom.title')}</h3>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">{t('custom.subtitle')}</p>
          <a href={`mailto:${getBrandEmail('sales')}`} className="px-9 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all inline-flex items-center gap-x-3">
            {t('custom.cta')}
          </a>
        </Container>
      </div>

      <footer className="border-t border-slate-800 py-9 text-sm">
        <Container className="flex flex-col md:flex-row justify-between items-center gap-y-4 text-slate-400">
          <div>{t('footer.copyright', { year: new Date().getFullYear(), brand: BRAND_DISPLAY })}</div>
          <div className="flex gap-x-6 text-xs">
            <a href="#" className="hover:text-slate-300">{t('footer.legal')}</a>
            <a href="#" className="hover:text-slate-300">{t('footer.privacy')}</a>
            <a href="#" className="hover:text-slate-300">{t('footer.support')}</a>
          </div>
        </Container>
      </footer>

      {isConfiguratorOpen && selectedProduct && (
        <ConfiguratorModal 
          product={selectedProduct} 
          editingItem={editingCartItem}
          onClose={() => {
            setIsConfiguratorOpen(false);
            setEditingCartItem(null);
            if (returnToCartAfterConfig) {
              setIsCartOpen(true);
              setReturnToCartAfterConfig(false);
            }
          }} 
          onAddToCart={addToCart} 
        />
      )}

      {isCartOpen && (
        <CartSidebar 
          cart={cart} 
          onClose={() => setIsCartOpen(false)} 
          onCheckout={openCheckout} 
          onRemoveItem={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
          onEditItem={editCartItem}
        />
      )}

      {isCheckoutOpen && (
        <CheckoutModal
          cart={cart}
          onClose={closeCheckout}
          onOrderComplete={handleOrderComplete}
          initialData={checkoutDraft}
          onDraftChange={updateCheckoutDraft}
        />
      )}
    </div>
  );
}

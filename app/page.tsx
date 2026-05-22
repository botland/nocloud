'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ProductCard from '@/components/ProductCard';
import ConfiguratorModal from '@/components/ConfiguratorModal';
import CartSidebar from '@/components/CartSidebar';
import { Product } from '@/lib/types';

const products: Product[] = [
  {
    id: 0,
    slug: 'edge',
    name: 'Edge',
    tier: 'LOW',
    price: 2490,
    description: 'Compact desktop appliance for individuals and small teams. Quiet and efficient.',
  },
  {
    id: 1,
    slug: 'studio',
    name: 'Studio',
    tier: 'MEDIUM',
    price: 9490,
    description: 'Powerful tower for teams. Up to 70B parameter models with high throughput.',
  },
  {
    id: 2,
    slug: 'forge',
    name: 'Forge',
    tier: 'HIGH',
    price: 27900,
    description: 'Enterprise system. Massive scale inference & fine-tuning. Cluster expandable.',
  },
];

export default function Home() {
  const t = useTranslations();
  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState('en');

  const openConfigurator = (product: Product) => {
    setSelectedProduct(product);
    setIsConfiguratorOpen(true);
  };

  const addToCart = (item: any) => {
    setCart([...cart, item]);
    setIsConfiguratorOpen(false);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: number) => {
    setCart(cart.filter(item => item.id !== id));
  };

  const handleQuoteRequest = () => {
    const company = prompt('Company name for quote request:');
    if (company) {
      alert(`Thank you, ${company}. Our team will contact you within 24h with a custom quote.`);
    }
  };

  // Simple lang switch (in real app use next-intl routing)
  const switchLang = (lang: string) => {
    setCurrentLang(lang);
    // For demo: reload or in production use router.push(`/${lang}`)
    if (lang !== currentLang) {
      window.location.href = `/${lang}`; // assumes locale routing works
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navbar - matches prototype */}
      <nav className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-x-3">
            <div className="flex items-center gap-x-2.5">
              <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
                <div className="w-5 h-5 bg-slate-950 rounded-xl flex items-center justify-center">
                  <span className="text-cyan-400 text-[21px]">🛡️</span>
                </div>
              </div>
              <span className="font-display text-[27px] font-semibold tracking-tighter">nocloud<span className="text-cyan-400">.ai</span></span>
            </div>
            <div className="px-3 py-1 text-[10px] font-bold tracking-widest border border-slate-700 rounded-2xl text-slate-400">B2B</div>
          </div>

          <div className="flex items-center gap-x-8 text-sm">
            {/* Language switcher */}
            <div className="flex border border-slate-700 rounded-3xl overflow-hidden text-xs font-semibold">
              <button 
                onClick={() => switchLang('en')}
                className={`px-4 py-1.5 ${currentLang === 'en' ? 'bg-slate-900 text-white' : ''}`}
              >EN</button>
              <button 
                onClick={() => switchLang('fr')}
                className={`px-4 py-1.5 border-l border-slate-700 ${currentLang === 'fr' ? 'bg-slate-900 text-white' : ''}`}
              >FR</button>
            </div>

            <button 
              onClick={() => setIsCartOpen(true)} 
              className="flex items-center gap-x-2 px-5 py-2 border border-slate-700 rounded-3xl text-sm hover:bg-slate-900 transition-colors"
            >
              <span>🛒</span>
              <span id="cart-count" className="font-mono text-xs bg-slate-800 px-1.5 rounded">{cart.length}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Hero - inspired by prototype */}
      <div className="max-w-screen-2xl mx-auto px-8 pt-14 pb-12">
        <div className="max-w-3xl">
          <div className="inline px-4 py-1.5 rounded-3xl bg-slate-900 border border-slate-800 text-sm mb-6">
            {t('hero.badge') || 'Now shipping across Europe • 3-year warranty • B2B focused'}
          </div>
          <h1 className="text-6xl font-semibold tracking-tighter leading-none mb-5">
            Private Generative AI.<br />
            <span className="text-white">Your infrastructure.<br />Your rules.</span>
          </h1>
          <p className="max-w-md text-xl text-slate-400 mb-8">
            High-performance appliances for European organizations. Fully private. No cloud. Built for B2B.
          </p>
          <div className="flex gap-x-4">
            <button 
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-8 h-14 bg-white text-slate-950 font-semibold rounded-3xl flex items-center gap-x-3 hover:bg-slate-100"
            >
              Browse appliances
            </button>
            <button 
              onClick={handleQuoteRequest}
              className="px-7 h-14 border border-slate-700 rounded-3xl font-semibold hover:bg-slate-900"
            >
              Request a custom quote
            </button>
          </div>
        </div>
      </div>

      {/* Products Section */}
      <div id="products" className="max-w-screen-2xl mx-auto px-8 pb-16">
        <div className="mb-8">
          <div className="text-cyan-400 text-xs font-bold tracking-[3px]">HARDWARE APPLIANCES</div>
          <h2 className="text-[2.1rem] leading-[2.35rem] font-semibold tracking-tighter">Choose your performance level</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard 
              key={product.id} 
              product={product} 
              onConfigure={() => openConfigurator(product)} 
            />
          ))}
        </div>
      </div>

      {/* Services teaser */}
      <div id="services" className="bg-slate-900 border-y border-slate-800 py-14">
        <div className="max-w-screen-2xl mx-auto px-8">
          <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-2">OPTIONAL SERVICES</div>
          <h3 className="text-3xl font-semibold tracking-tighter mb-8">Add management, backup or setup</h3>
          <div className="grid md:grid-cols-3 gap-5 text-sm">
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-700">Managed Care — priority support & updates</div>
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-700">SecureVault Backup — daily encrypted snapshots</div>
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-700">Professional Setup — installation + training</div>
          </div>
        </div>
      </div>

      {/* Footer simple */}
      <footer className="max-w-screen-2xl mx-auto px-8 py-10 text-xs text-slate-500 flex justify-between border-t border-slate-800">
        <div>© nocloud.ai — Private AI infrastructure for Europe</div>
        <div className="flex gap-x-5">
          <span>3-year warranty</span>
          <span>EU data residency</span>
          <span>Stripe secured</span>
        </div>
      </footer>

      {/* Modals */}
      {isConfiguratorOpen && selectedProduct && (
        <ConfiguratorModal 
          product={selectedProduct} 
          onClose={() => setIsConfiguratorOpen(false)} 
          onAddToCart={addToCart} 
        />
      )}

      {isCartOpen && (
        <CartSidebar 
          cart={cart} 
          onClose={() => setIsCartOpen(false)} 
          onCheckout={() => {}}
          onRemoveItem={removeFromCart}
        />
      )}
    </div>
  );
}

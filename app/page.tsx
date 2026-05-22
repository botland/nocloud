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
    description: 'Compact desktop appliance for individuals and small teams.',
  },
  {
    id: 1,
    slug: 'studio',
    name: 'Studio',
    tier: 'MEDIUM',
    price: 9490,
    description: 'Powerful tower for teams. Handles up to 70B models.',
  },
  {
    id: 2,
    slug: 'forge',
    name: 'Forge',
    tier: 'HIGH',
    price: 27900,
    description: 'Enterprise-grade system for large scale inference and fine-tuning.',
  },
];

export default function Home() {
  const t = useTranslations();
  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const openConfigurator = (product: Product) => {
    setSelectedProduct(product);
    setIsConfiguratorOpen(true);
  };

  const addToCart = (item: any) => {
    setCart([...cart, item]);
    setIsConfiguratorOpen(false);
    setIsCartOpen(true);
  };

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-x-3">
            <div className="flex items-center gap-x-2">
              <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
                <span className="text-cyan-400 text-2xl">🛡️</span>
              </div>
              <span className="font-display text-3xl font-semibold tracking-tighter">
                nocloud<span className="text-cyan-400">.ai</span>
              </span>
            </div>
            <div className="px-3 py-1 text-xs font-bold tracking-widest border border-slate-700 rounded-2xl">B2B</div>
          </div>

          <div className="flex items-center gap-x-6 text-sm">
            <a href="#products" className="hover:text-cyan-400 transition-colors">{t('nav.products')}</a>
            <a href="#services" className="hover:text-cyan-400 transition-colors">{t('nav.services')}</a>
            <button 
              onClick={() => setIsCartOpen(true)}
              className="flex items-center gap-x-2 px-5 py-2 border border-slate-700 rounded-3xl hover:bg-slate-900"
            >
              Cart ({cart.length})
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-screen-2xl mx-auto px-8 pt-16 pb-14">
        <div className="max-w-3xl">
          <div className="inline-block px-4 py-1.5 rounded-3xl bg-slate-900 border border-slate-800 text-sm mb-6">
            {t('hero.badge')}
          </div>
          <h1 className="text-7xl font-semibold tracking-tighter leading-none mb-6">
            {t('hero.title1')}<br />
            <span className="text-white">{t('hero.title2')}</span>
          </h1>
          <p className="max-w-lg text-xl text-slate-400 mb-8">
            {t('hero.subtitle')}
          </p>
          <div className="flex gap-x-4">
            <button 
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-8 h-14 bg-white text-slate-950 font-semibold rounded-3xl flex items-center gap-x-3 hover:bg-slate-100"
            >
              {t('hero.cta1')}
            </button>
            <button className="px-7 h-14 border border-slate-700 rounded-3xl font-semibold hover:bg-slate-900">
              {t('hero.cta2')}
            </button>
          </div>
        </div>
      </div>

      {/* Products */}
      <div id="products" className="max-w-screen-2xl mx-auto px-8 pb-20">
        <div className="mb-8">
          <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-1">{t('products.tag')}</div>
          <h2 className="text-4xl font-semibold tracking-tighter">{t('products.title')}</h2>
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

      {/* Services */}
      <div id="services" className="bg-slate-900 border-y border-slate-800 py-16">
        <div className="max-w-screen-2xl mx-auto px-8">
          <h2 className="text-3xl font-semibold tracking-tighter mb-8">{t('services.title')}</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-950 p-7 rounded-3xl border border-slate-700">
              <h3 className="font-semibold text-xl mb-2">Managed Care — €89/mo</h3>
              <p className="text-slate-400">Remote management, automatic updates, priority European support.</p>
            </div>
            <div className="bg-slate-950 p-7 rounded-3xl border border-slate-700">
              <h3 className="font-semibold text-xl mb-2">SecureVault Backup — €39/mo</h3>
              <p className="text-slate-400">Daily encrypted backups with one-click restore.</p>
            </div>
          </div>
        </div>
      </div>

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
          onCheckout={() => {
            // Call Stripe checkout
            console.log("Starting Stripe checkout...");
          }} 
        />
      )}
    </div>
  );
}

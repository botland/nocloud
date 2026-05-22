'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import ProductCard from '@/components/ProductCard';
import ConfiguratorModal from '@/components/ConfiguratorModal';
import CartSidebar from '@/components/CartSidebar';
import TechSpecsModal from '@/components/TechSpecsModal';
import { Product } from '@/lib/types';

const products: Product[] = [
  {
    id: 0,
    slug: 'edge',
    name: 'Edge',
    tier: 'LOW',
    price: 2490,
    description: 'Compact desktop appliance for individuals and small teams.',
    techSpecs: {
      "Processor / NPU": "AMD Ryzen AI 9 HX 370 or equivalent",
      "Dedicated AI Acceleration": "Up to 50 TOPS NPU",
      "System Memory": "24 GB LPDDR5X unified",
      "Storage": "1 TB PCIe 4.0 NVMe SSD",
      "Inference Performance": "60+ tokens/s (7B Q4), 35+ tokens/s (13B)",
      "Max Model Size": "13B parameters (quantized)",
      "Networking": "2.5 GbE + Wi-Fi 6E + BT 5.3",
      "Form Factor": "Compact desktop (quiet, 35W TDP)",
      "Power Supply": "External 120W USB-C PD",
      "Warranty": "3 years"
    }
  },
  {
    id: 1,
    slug: 'studio',
    name: 'Studio',
    tier: 'MEDIUM',
    price: 9490,
    description: 'Powerful tower for teams. Up to 70B models.',
    techSpecs: {
      "GPU / Accelerator": "NVIDIA RTX 4090 or dual RTX 3090 equivalent",
      "AI Performance": "Up to 660 TOPS (Tensor)",
      "System Memory": "96 GB DDR5 ECC",
      "Storage": "4 TB NVMe RAID 1 (expandable)",
      "Inference Performance": "High throughput multi-model",
      "Max Model Size": "70B parameters",
      "Networking": "10 GbE + dual 2.5 GbE",
      "Form Factor": "Desktop tower (quiet optimized)",
      "Cooling": "Advanced air cooling",
      "Warranty": "3 years"
    }
  },
  {
    id: 2,
    slug: 'forge',
    name: 'Forge',
    tier: 'HIGH',
    price: 27900,
    description: 'Enterprise-grade system for large scale inference and fine-tuning.',
    techSpecs: {
      "Accelerators": "4× NVIDIA H100 / A100 or equivalent",
      "Total AI Performance": "Up to 4000+ TFLOPS",
      "System Memory": "256–512 GB HBM3 / DDR5",
      "Storage": "8–16 TB Enterprise NVMe",
      "Inference Performance": "Enterprise scale (multi-node ready)",
      "Max Model Size": "100B+ parameters + fine-tuning",
      "Networking": "100 GbE / InfiniBand ready",
      "Form Factor": "2U/4U Rackmount (cluster expandable)",
      "Power": "High-density redundant PSU",
      "Warranty": "3 years + enterprise SLA options"
    }
  }
];

export default function Home() {
  const t = useTranslations();
  const locale = useLocale();

  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isTechOpen, setIsTechOpen] = useState(false);
  const [techProduct, setTechProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const openConfigurator = (product: Product) => {
    setSelectedProduct(product);
    setIsConfiguratorOpen(true);
  };

  const showTechSpecs = (product: Product) => {
    setTechProduct(product);
    setIsTechOpen(true);
  };

  const addToCart = (item: any) => {
    setCart([...cart, item]);
    setIsConfiguratorOpen(false);
    setIsCartOpen(true);
  };

  const switchLanguage = (newLocale: string) => {
    if (newLocale === locale) return;
    // Simple and robust locale switch
    const path = window.location.pathname;
    const newPath = path.replace(`/${locale}`, `/${newLocale}`);
    window.location.href = newPath;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-x-3">
            <div className="flex items-center gap-x-2.5">
              <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
                <span className="text-cyan-400 text-2xl">🛡️</span>
              </div>
              <span className="font-display text-[27px] font-semibold tracking-tighter">
                nocloud<span className="text-cyan-400">.ai</span>
              </span>
            </div>
            <div className="px-3 py-1 text-[10px] font-bold tracking-widest border border-slate-700 rounded-2xl text-slate-400">B2B</div>
            </div>

          <div className="flex items-center gap-x-6 text-sm">
            {/* Language Switcher */}
            <div className="flex border border-slate-700 rounded-3xl overflow-hidden text-xs">
              <button 
                onClick={() => switchLanguage('en')}
                className={`px-4 py-1.5 font-semibold transition-all ${locale === 'en' ? 'bg-slate-900 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                EN
              </button>
              <button 
                onClick={() => switchLanguage('fr')}
                className={`px-4 py-1.5 font-semibold border-l border-slate-700 transition-all ${locale === 'fr' ? 'bg-slate-900 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                FR
              </button>
            </div>

            <a href="#products" className="hover:text-cyan-400 transition-colors">Products</a>
            <a href="#services" className="hover:text-cyan-400 transition-colors">Services</a>

            <button 
              onClick={() => setIsCartOpen(true)}
              className="flex items-center gap-x-2 px-5 py-2 border border-slate-700 rounded-3xl hover:bg-slate-900"
            >
              🛒 <span className="font-mono text-xs bg-slate-800 px-1.5 rounded">{cart.length}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-screen-2xl mx-auto px-8 pt-14 pb-12">
        <div className="max-w-3xl">
          <div className="inline px-4 py-1.5 rounded-3xl bg-slate-900 border border-slate-800 text-sm mb-6">
            Now shipping across Europe • 3-year warranty • B2B focused
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
              onClick={() => alert('Quote request modal would open here (company + requirements).')}
              className="px-7 h-14 border border-slate-700 rounded-3xl font-semibold hover:bg-slate-900"
            >
              Request a custom quote
            </button>
          </div>
        </div>
      </div>

      {/* Products */}
      <div id="products" className="max-w-screen-2xl mx-auto px-8 pb-16">
        <div className="mb-8">
          <div className="text-cyan-400 text-xs font-bold tracking-[3px]">HARDWARE APPLIANCES</div>
          <h2 className="text-4xl font-semibold tracking-tighter">Choose your performance level</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard 
              key={product.id} 
              product={product} 
              onConfigure={() => openConfigurator(product)}
              onShowTechSpecs={() => showTechSpecs(product)}
            />
          ))}
        </div>
      </div>

      {/* Services */}
      <div id="services" className="bg-slate-900 border-y border-slate-800 py-16">
        <div className="max-w-screen-2xl mx-auto px-8">
          <h2 className="text-3xl font-semibold tracking-tighter mb-8">Optional Services</h2>
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

      {isTechOpen && techProduct && (
        <TechSpecsModal 
          product={techProduct} 
          onClose={() => setIsTechOpen(false)} 
        />
      )}

      {isCartOpen && (
        <CartSidebar 
          cart={cart} 
          onClose={() => setIsCartOpen(false)} 
          onCheckout={() => alert('Stripe checkout would start here')} 
        />
      )}
    </div>
  );
}

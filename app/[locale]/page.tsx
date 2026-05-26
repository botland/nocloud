'use client';

import { useState } from 'react';
import ProductCard from '@/components/ProductCard';
import ConfiguratorModal from '@/components/ConfiguratorModal';
import CartSidebar from '@/components/CartSidebar';
import CheckoutModal from '@/components/CheckoutModal';
import { Product } from '@/lib/types';

const products: Product[] = [
  {
    id: 0,
    slug: 'edge',
    name: 'Edge',
    tier: 'LOW • DESKTOP',
    price: 2490,
    description: 'Compact desktop appliance for individuals and small teams. Excellent for 7B–13B models with high-speed local inference.',
  },
  {
    id: 1,
    slug: 'studio',
    name: 'Studio',
    tier: 'MEDIUM • TOWER',
    price: 9490,
    description: 'Powerful tower for teams. Handles up to 70B models, collaborative RAG, and production workloads with ease.',
  },
  {
    id: 2,
    slug: 'forge',
    name: 'Forge',
    tier: 'HIGH • ENTERPRISE',
    price: 27900,
    description: 'Enterprise-grade system for large organizations. Massive scale inference, fine-tuning, and multi-node ready.',
  },
];

export default function LocaleHome() {
  const [isConfiguratorOpen, setIsConfiguratorOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const openConfigurator = (product: Product) => {
    setSelectedProduct(product);
    setIsConfiguratorOpen(true);
  };

  const addToCart = (item: any) => {
    setCart((prev) => [...prev, item]);
    setIsConfiguratorOpen(false);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const updateCartQuantity = (id: number, newQuantity: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newTotal = item.product.price * newQuantity;
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo with white background + Cloud Slash */}
            <div className="flex items-center gap-x-3">
              <div className="flex items-center gap-x-2.5">
                <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
                  <i className="fa-solid fa-cloud-slash text-cyan-400 text-[21px]"></i>
                </div>
                <div className="flex items-baseline">
                  <span className="font-display text-[28px] font-semibold tracking-tighter">nocloud</span>
                  <span className="text-cyan-400 font-display text-[28px] font-semibold">.ai</span>
                </div>
              </div>
              <div className="hidden md:block px-3 py-1 text-[10px] font-bold tracking-[1.5px] border border-slate-700 rounded-2xl text-slate-400">B2B</div>
            </div>

            <div className="hidden md:flex items-center gap-x-9 text-sm font-medium">
              <a href="#products" className="hover:text-cyan-400 transition-colors">Products</a>
              <a href="#services" className="hover:text-cyan-400 transition-colors">Services</a>
              <a href="#why" className="hover:text-cyan-400 transition-colors">Why NoCloud</a>
              <a href="#docs" className="hover:text-cyan-400 transition-colors">Docs</a>
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
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-screen-2xl mx-auto px-8 pt-16 pb-14">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-x-2 px-4 h-9 rounded-3xl bg-slate-900 border border-slate-800 text-sm mb-6">
            <div className="flex items-center gap-x-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="font-medium">Now shipping across Europe • 3-year warranty • B2B focused</span>
            </div>
          </div>
          
          <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter leading-[1.05] mb-5">
            Private Generative AI.<br />
            <span className="text-white">Your infrastructure.<br />Your rules.</span>
          </h1>
          
          <p className="max-w-lg text-xl text-slate-400 mb-9">
            High-performance appliances for European organizations. 
            Fully private. No cloud. Built for B2B.
          </p>
          
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <button onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })} className="px-8 h-14 bg-white text-slate-950 font-semibold rounded-3xl flex items-center justify-center gap-x-3 text-base hover:bg-slate-100 transition-all shadow-lg">
              Browse appliances <i className="fa-solid fa-arrow-right ml-1"></i>
            </button>
          </div>
          
          <div className="mt-8 flex items-center gap-x-8 text-sm">
            <div className="text-slate-400">Trusted by <span className="font-semibold text-slate-200">240+</span> European teams</div>
          </div>
        </div>
      </div>

      {/* Products */}
      <div id="products" className="max-w-screen-2xl mx-auto px-8 pb-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-1">HARDWARE APPLIANCES</div>
            <h2 className="text-[2.1rem] leading-[2.4rem] font-semibold tracking-tighter">Choose your performance level</h2>
          </div>
          <div className="hidden lg:block text-sm text-slate-400 max-w-xs text-right">
            All appliances include our private inference engine and come pre-loaded with leading open-source models.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onConfigure={() => openConfigurator(product)} />
          ))}
        </div>
      </div>

      {/* Services */}
      <div id="services" className="bg-slate-900 border-y border-slate-800 py-16">
        <div className="max-w-screen-2xl mx-auto px-8">
          <div className="max-w-xl mb-9">
            <div className="text-cyan-400 text-xs font-bold tracking-[2.5px] mb-2">OPTIONAL SERVICES</div>
            <h2 className="text-[2.1rem] leading-[2.4rem] font-semibold tracking-tighter">Add management or backup.<br />Keep full control.</h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
            <div className="bg-slate-950 border border-slate-700 p-7 rounded-3xl">
              <div className="flex gap-x-4">
                <div className="w-11 h-11 rounded-2xl bg-emerald-900/30 text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-headset text-2xl"></i>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-xl">Managed Care</div>
                  <div className="text-emerald-400 font-medium">€89 / month</div>
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> Proactive monitoring &amp; alerts</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> Automatic updates &amp; security patches</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-emerald-400 text-xs mt-1"></i> Priority European support</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-950 border border-slate-700 p-7 rounded-3xl">
              <div className="flex gap-x-4">
                <div className="w-11 h-11 rounded-2xl bg-sky-900/30 text-sky-400 flex items-center justify-center flex-shrink-0">
                  <i className="fa-solid fa-shield-halved text-2xl"></i>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-xl">SecureVault Backup</div>
                  <div className="text-sky-400 font-medium">€39 / month</div>
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> Daily encrypted backups</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> One-click restore to any appliance</li>
                    <li className="flex gap-x-2"><i className="fa-solid fa-check text-sky-400 text-xs mt-1"></i> Compliance-ready logs</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Why NoCloud */}
      <div id="why" className="max-w-screen-2xl mx-auto px-8 py-20">
        <div className="grid md:grid-cols-12 gap-x-10">
          <div className="md:col-span-5 mb-10 md:mb-0">
            <div className="text-cyan-400 text-xs font-bold tracking-[3px] mb-3">BUILT FOR EUROPEAN ORGANIZATIONS</div>
            <h2 className="text-[2.1rem] leading-none font-semibold tracking-tighter">Sovereign AI.<br />European data residency.<br />Full control.</h2>
          </div>
          <div className="md:col-span-7">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                <i className="fa-solid fa-lock text-3xl text-cyan-400 mb-4"></i>
                <div className="font-semibold mb-1.5">100% Private</div>
                <p className="text-sm text-slate-400">Your models and data never leave your premises or chosen EU location.</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                <i className="fa-solid fa-file-invoice-dollar text-3xl text-cyan-400 mb-4"></i>
                <div className="font-semibold mb-1.5">B2B Ready</div>
                <p className="text-sm text-slate-400">Company invoicing, VAT handling, purchase orders, and dedicated support.</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                <i className="fa-solid fa-globe text-3xl text-cyan-400 mb-4"></i>
                <div className="font-semibold mb-1.5">EU First</div>
                <p className="text-sm text-slate-400">Data residency in Europe, French &amp; English support, seamless intra-EU shipping.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-900 py-14">
        <div className="max-w-screen-2xl mx-auto px-8 text-center">
          <h3 className="text-3xl font-semibold tracking-tight mb-3">Need a custom configuration?</h3>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">Contact our team for tailored enterprise quotes and volume pricing.</p>
          <a href="mailto:sales@nocloud.ai" className="px-9 py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-all inline-flex items-center gap-x-3">
            Contact sales
          </a>
        </div>
      </div>

      <footer className="border-t border-slate-800 py-9 text-sm">
        <div className="max-w-screen-2xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-y-4 text-slate-400">
          <div>© {new Date().getFullYear()} nocloud.ai — Private generative AI infrastructure for Europe</div>
          <div className="flex gap-x-6 text-xs">
            <a href="#" className="hover:text-slate-300">Legal</a>
            <a href="#" className="hover:text-slate-300">Privacy (RGPD)</a>
            <a href="#" className="hover:text-slate-300">Support</a>
          </div>
        </div>
      </footer>

      {isConfiguratorOpen && selectedProduct && (
        <ConfiguratorModal product={selectedProduct} onClose={() => setIsConfiguratorOpen(false)} onAddToCart={addToCart} />
      )}

      {isCartOpen && (
        <CartSidebar 
          cart={cart} 
          onClose={() => setIsCartOpen(false)} 
          onCheckout={openCheckout} 
          onRemoveItem={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
        />
      )}

      {isCheckoutOpen && (
        <CheckoutModal cart={cart} onClose={closeCheckout} onOrderComplete={() => { setCart([]); closeCheckout(); }} />
      )}
    </div>
  );
}

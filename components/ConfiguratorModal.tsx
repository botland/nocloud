'use client';

import { useState } from 'react';
import { Product, CartItem } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

export default function ConfiguratorModal({ product, onClose, onAddToCart }: Props) {
  const [managed, setManaged] = useState(false);
  const [backup, setBackup] = useState(false);
  const [setup, setSetup] = useState(false);

  const selectedServices = [];
  if (managed) selectedServices.push({ name: "Managed Care", price: 89 });
  if (backup) selectedServices.push({ name: "SecureVault Backup", price: 39 });
  if (setup) selectedServices.push({ name: "Professional Setup & Training", price: 499 });

  const servicesTotal = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalPrice = product.price + servicesTotal; // Upfront total (services include setup fees + first mo where applicable)

  const handleAddToCart = () => {
    const item: CartItem = {
      id: Date.now(),
      product,
      services: selectedServices,
      totalPrice,
    };
    onAddToCart(item);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-7">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs font-bold tracking-[2px] text-cyan-400">{product.tier} PERFORMANCE</div>
              <h2 className="text-3xl font-semibold tracking-tighter">{product.name}</h2>
            </div>
            <button onClick={onClose} className="text-3xl leading-none text-slate-400 hover:text-white">×</button>
          </div>

          <div className="mt-6 mb-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Base appliance</span>
              <span className="font-semibold tabular-nums">€{product.price}</span>
            </div>
          </div>

          <div className="mb-6">
            <div className="text-xs uppercase tracking-[2px] text-slate-400 mb-3 mt-4">OPTIONAL SERVICES</div>
            
            <label className="flex items-start gap-x-3 p-4 border border-slate-700 hover:border-slate-600 rounded-2xl mb-2.5 cursor-pointer transition-colors">
              <input type="checkbox" checked={managed} onChange={e => setManaged(e.target.checked)} className="mt-1 accent-cyan-400 w-4 h-4" />
              <div className="flex-1">
                <div className="flex justify-between">
                  <div className="font-medium">Managed Care</div>
                  <div className="text-emerald-400 font-mono text-sm">€89/mo</div>
                </div>
                <div className="text-xs text-slate-400">Remote management, updates, priority support</div>
              </div>
            </label>

            <label className="flex items-start gap-x-3 p-4 border border-slate-700 hover:border-slate-600 rounded-2xl mb-2.5 cursor-pointer transition-colors">
              <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} className="mt-1 accent-cyan-400 w-4 h-4" />
              <div className="flex-1">
                <div className="flex justify-between">
                  <div className="font-medium">SecureVault Backup</div>
                  <div className="text-sky-400 font-mono text-sm">€39/mo</div>
                </div>
                <div className="text-xs text-slate-400">Daily encrypted backups + one-click restore</div>
              </div>
            </label>

            <label className="flex items-start gap-x-3 p-4 border border-slate-700 hover:border-slate-600 rounded-2xl cursor-pointer transition-colors">
              <input type="checkbox" checked={setup} onChange={e => setSetup(e.target.checked)} className="mt-1 accent-cyan-400 w-4 h-4" />
              <div className="flex-1">
                <div className="flex justify-between">
                  <div className="font-medium">Professional Setup & Training</div>
                  <div className="text-amber-400 font-mono text-sm">€499 one-time</div>
                </div>
                <div className="text-xs text-slate-400">On-site or remote installation + team training</div>
              </div>
            </label>
          </div>

          <div className="text-xs text-slate-500">Services are billed monthly after initial setup (where applicable). Setup fee is one-time.</div>
        </div>

        <div className="bg-slate-950 px-7 py-5 flex justify-between items-center border-t border-slate-800">
          <div>
            <div className="text-xs text-slate-400">Total today</div>
            <div className="text-3xl font-semibold tabular-nums">€{totalPrice}</div>
            {servicesTotal > 0 && <div className="text-[10px] text-emerald-400">+ recurring services selected</div>}
          </div>
          <button 
            onClick={handleAddToCart}
            className="px-9 py-3.5 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 active:scale-[0.985] transition-all"
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

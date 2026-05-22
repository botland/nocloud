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

  const selectedServices = [];
  if (managed) selectedServices.push({ name: "Managed Care", price: 89 });
  if (backup) selectedServices.push({ name: "SecureVault Backup", price: 39 });

  const hardwarePrice = product.price;
  const monthlyTotal = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const handleAddToCart = () => {
    const item: CartItem = {
      id: Date.now(),
      product,
      services: selectedServices,
      totalPrice: hardwarePrice, // hardware is one-time; services are monthly
    };
    onAddToCart(item);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-7">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-semibold">{product.name}</h2>
              <p className="text-cyan-400 text-sm">{product.tier} PERFORMANCE</p>
            </div>
            <button onClick={onClose} className="text-2xl">×</button>
          </div>

          <div className="my-6 space-y-1">
            <div className="flex justify-between text-sm">
              <span>Hardware (one-time)</span>
              <span className="font-semibold">€{hardwarePrice}</span>
            </div>
            {selectedServices.length > 0 && (
              <div className="pt-2">
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">Monthly services</div>
                {selectedServices.map((service, idx) => (
                  <div key={idx} className="flex justify-between text-sm text-emerald-400">
                    <span>{service.name}</span>
                    <span>€{service.price}/mo</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-3">OPTIONAL SERVICES</div>
            
            <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl mb-3 cursor-pointer hover:border-slate-600">
              <input 
                type="checkbox" 
                checked={managed} 
                onChange={e => setManaged(e.target.checked)} 
                className="accent-cyan-400 w-4 h-4" 
              />
              <div className="flex-1">
                <div className="font-medium">Managed Care <span className="text-emerald-400 text-sm">€89/mo</span></div>
                <div className="text-xs text-slate-400">Remote management, updates & priority support</div>
              </div>
            </label>

            <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer hover:border-slate-600">
              <input 
                type="checkbox" 
                checked={backup} 
                onChange={e => setBackup(e.target.checked)} 
                className="accent-cyan-400 w-4 h-4" 
              />
              <div className="flex-1">
                <div className="font-medium">SecureVault Backup <span className="text-sky-400 text-sm">€39/mo</span></div>
                <div className="text-xs text-slate-400">Daily encrypted backups with one-click restore</div>
              </div>
            </label>
          </div>
        </div>

        <div className="bg-slate-950 px-7 py-5 flex justify-between items-center border-t border-slate-800">
          <div>
            <div className="text-xs text-slate-400">Hardware total (today)</div>
            <div className="text-2xl font-semibold">€{hardwarePrice}</div>
            {monthlyTotal > 0 && (
              <div className="text-xs text-emerald-400 mt-0.5">+ €{monthlyTotal}/mo services</div>
            )}
          </div>
          <button 
            onClick={handleAddToCart}
            className="px-8 py-3 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-colors"
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

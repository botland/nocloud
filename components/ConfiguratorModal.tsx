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

  const services = [];
  if (managed) services.push({ name: "Managed Care", price: 89 });
  if (backup) services.push({ name: "SecureVault Backup", price: 39 });

  const totalPrice = product.price;

  const handleAddToCart = () => {
    const item: CartItem = {
      id: Date.now(),
      product,
      services,
      totalPrice,
    };
    onAddToCart(item);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-7">
          <div className="flex justify-between">
            <div>
              <h2 className="text-2xl font-semibold">{product.name}</h2>
              <p className="text-cyan-400 text-sm">{product.tier} PERFORMANCE</p>
            </div>
            <button onClick={onClose} className="text-2xl">×</button>
          </div>

          <div className="my-6">
            <div className="flex justify-between text-sm mb-1">
              <span>Base price</span>
              <span className="font-semibold">€{product.price}</span>
            </div>
          </div>

          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-3">OPTIONAL SERVICES</div>
            
            <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl mb-3 cursor-pointer">
              <input type="checkbox" checked={managed} onChange={e => setManaged(e.target.checked)} className="accent-cyan-400" />
              <div className="flex-1">
                <div>Managed Care <span className="text-emerald-400 text-sm">€89/mo</span></div>
              </div>
            </label>

            <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer">
              <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} className="accent-cyan-400" />
              <div className="flex-1">
                <div>SecureVault Backup <span className="text-sky-400 text-sm">€39/mo</span></div>
              </div>
            </label>
          </div>
        </div>

        <div className="bg-slate-950 px-7 py-5 flex justify-between items-center border-t border-slate-800">
          <div>
            <div className="text-xs text-slate-400">Total today</div>
            <div className="text-2xl font-semibold">€{totalPrice}</div>
          </div>
          <button 
            onClick={handleAddToCart}
            className="px-8 py-3 bg-white text-slate-950 font-bold rounded-3xl"
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

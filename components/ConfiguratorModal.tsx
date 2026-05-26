'use client';

import { useState } from 'react';
import { Product, CartItem } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

const productSpecs: Record<number, Array<[string, string]>> = {
  0: [['Inference', '60+ tokens/s (7B)'], ['Models', 'Up to 13B'], ['Memory', '24 GB'], ['Storage', '1 TB NVMe'], ['Form factor', 'Compact desktop']],
  1: [['Inference', 'High performance multi-model'], ['Models', 'Up to 70B'], ['Memory', '96 GB'], ['Storage', '4 TB RAID'], ['Form factor', 'Desktop tower']],
  2: [['Inference', 'Enterprise scale'], ['Models', '100B+ & multi-node ready'], ['Memory', '256+ GB HBM'], ['Storage', '8 TB+ Enterprise'], ['Form factor', 'Rackmount ready']],
};

export default function ConfiguratorModal({ product, onClose, onAddToCart }: Props) {
  const [managed, setManaged] = useState(false);
  const [backup, setBackup] = useState(false);

  const specs = productSpecs[product.id] || [];

  const selectedServices: { name: string; price: number }[] = [];
  if (managed) selectedServices.push({ name: "Managed Care", price: 89 });
  if (backup) selectedServices.push({ name: "SecureVault Backup", price: 39 });

  const totalPrice = product.price;

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden flex flex-col max-h-[92vh]" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header - fixed */}
        <div className="px-7 pt-6 pb-5 border-b border-slate-800 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="font-semibold text-2xl tracking-tight">{product.name}</div>
            <div className="text-xs uppercase tracking-[2px] text-cyan-400 font-bold mt-0.5">{product.tier}</div>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        
        {/* Scrollable content */}
        <div className="p-7 overflow-y-auto flex-1">
          <div className="flex justify-between items-baseline mb-6">
            <div className="text-sm text-slate-400">Base appliance</div>
            <div className="text-3xl font-semibold tabular-nums">€{product.price}</div>
          </div>
          
          <div className="mb-7">
            <div className="uppercase text-xs tracking-widest text-slate-400 mb-3 font-medium">KEY SPECIFICATIONS</div>
            <div className="text-sm">
              {specs.map((spec, idx) => (
                <div key={idx} className="flex justify-between py-[7px] border-b border-slate-800 last:border-none">
                  <span className="text-slate-400">{spec[0]}</span>
                  <span className="font-medium">{spec[1]}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <div className="uppercase text-xs tracking-widest text-slate-400 mb-3 font-medium">OPTIONAL SERVICES</div>
            <div className="space-y-3">
              <label className="flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors">
                <input type="checkbox" checked={managed} onChange={e => setManaged(e.target.checked)} className="accent-cyan-400 mt-1" />
                <div className="flex-1">
                  <div className="flex justify-between"><span className="font-medium">Managed Care</span> <span className="text-emerald-400 font-mono text-sm">€89/mo</span></div>
                  <div className="text-xs text-slate-400">Remote management, updates &amp; priority support</div>
                </div>
              </label>
              
              <label className="flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors">
                <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} className="accent-cyan-400 mt-1" />
                <div className="flex-1">
                  <div className="flex justify-between"><span className="font-medium">SecureVault Backup</span> <span className="text-sky-400 font-mono text-sm">€39/mo</span></div>
                  <div className="text-xs text-slate-400">Daily encrypted backups + restore</div>
                </div>
              </label>
            </div>
          </div>
        </div>
        
        {/* Footer - fixed */}
        <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-xs text-slate-400">Total today</div>
            <div className="text-3xl font-semibold tabular-nums tracking-tighter">€{totalPrice}</div>
            <div className="text-[10px] text-slate-500">+ recurring services (billed monthly)</div>
          </div>
          <button onClick={handleAddToCart} className="px-8 py-3.5 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-3xl text-sm flex items-center gap-x-2">
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

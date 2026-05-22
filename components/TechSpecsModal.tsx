'use client';

import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
}

export default function TechSpecsModal({ product, onClose }: Props) {
  if (!product.techSpecs) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-900 border border-slate-700 max-w-2xl w-full rounded-3xl p-8" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between mb-6">
          <div>
            <div className="text-2xl font-semibold">{product.name}</div>
            <div className="text-cyan-400 text-sm tracking-widest">TECHNICAL SPECIFICATIONS</div>
          </div>
          <button 
            onClick={onClose} 
            className="text-3xl leading-none text-slate-400 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="divide-y divide-slate-800">
          {Object.entries(product.techSpecs).map(([key, value]) => (
            <div key={key} className="flex justify-between py-3 text-sm">
              <span className="text-slate-400 pr-4">{key}</span>
              <span className="font-medium text-right text-slate-200">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500">
          All appliances include 3-year warranty and priority European support.
        </div>
      </div>
    </div>
  );
}

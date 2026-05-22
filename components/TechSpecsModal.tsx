'use client';

import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
}

export default function TechSpecsModal({ product, onClose }: Props) {
  if (!product.techSpecs) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 z-[150] flex items-center justify-center p-4" 
      onClick={onClose}
    >
      <div 
        className="bg-slate-900 border border-slate-700 max-w-2xl w-full rounded-3xl p-8" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between mb-6">
          <div>
            <div className="text-2xl font-semibold">{product.name}</div>
            <div className="text-cyan-400 text-sm">Technical Specifications</div>
          </div>
          <button onClick={onClose} className="text-2xl hover:text-slate-400">×</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {Object.entries(product.techSpecs).map(([key, value]) => (
            <div key={key} className="flex justify-between py-2.5 border-b border-slate-800">
              <span className="text-slate-400">{key}</span>
              <span className="font-medium text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 text-xs text-slate-500">
          All appliances come with 3-year warranty and priority European support.
        </div>
      </div>
    </div>
  );
}

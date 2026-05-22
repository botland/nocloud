'use client';

import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onConfigure: () => void;
}

export default function ProductCard({ product, onConfigure }: Props) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className={`text-xs font-extrabold tracking-widest ${
            product.tier === 'LOW' ? 'text-emerald-400' : 
            product.tier === 'MEDIUM' ? 'text-cyan-400' : 'text-violet-400'
          }`}>
            {product.tier}
          </div>
          <h3 className="text-3xl font-semibold tracking-tight mt-1">{product.name}</h3>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">from</div>
          <div className="text-3xl font-semibold tabular-nums">€{product.price}</div>
        </div>
      </div>

      <p className="text-slate-400 flex-1 text-sm mb-6">{product.description}</p>

      <button 
        onClick={onConfigure}
        className="mt-auto w-full py-3.5 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-colors"
      >
        Configure &amp; Buy
      </button>
    </div>
  );
}

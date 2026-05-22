'use client';

import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onConfigure: () => void;
  onShowTechSpecs?: () => void;
}

export default function ProductCard({ product, onConfigure, onShowTechSpecs }: Props) {
  const isPopular = product.tier === 'MEDIUM';

  return (
    <div className="product-card bg-slate-900 border border-slate-800 rounded-3xl p-7 flex flex-col relative">
      {isPopular && (
        <div className="absolute top-5 right-5 bg-cyan-400 text-slate-950 text-xs font-bold px-3 py-1 rounded-2xl">
          POPULAR
        </div>
      )}

      <div className="flex justify-between mb-5">
        <div>
          <div className={`text-xs font-extrabold tracking-widest ${
            product.tier === 'LOW' ? 'text-emerald-400' : 
            product.tier === 'MEDIUM' ? 'text-cyan-400' : 'text-violet-400'
          }`}>
            {product.tier}
          </div>
          <div className="text-3xl font-semibold tracking-tight mt-1">{product.name}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">from</div>
          <div className="text-3xl font-semibold tabular-nums">€{product.price}</div>
        </div>
      </div>

      <p className="text-slate-400 text-sm mb-6 flex-1">{product.description}</p>

      <button 
        onClick={onConfigure}
        className="w-full py-3.5 bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 transition-colors"
      >
        Configure & Buy
      </button>

      {onShowTechSpecs && (
        <button 
          onClick={onShowTechSpecs}
          className="mt-3 w-full text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View technical specifications →
        </button>
      )}
    </div>
  );
}

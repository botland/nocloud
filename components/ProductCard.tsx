'use client';

import { useTranslations } from 'next-intl';
import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onConfigure: () => void;
}

export default function ProductCard({ product, onConfigure }: Props) {
  const t = useTranslations('products');

  const bestFor = t(`bestFor.${product.id}`);

  return (
    <div className="product-card bg-slate-900 border border-slate-800 rounded-3xl p-7 flex flex-col transition-all duration-200 hover:-translate-y-1 hover:border-slate-700 hover:shadow-xl">
      <div className="flex justify-between mb-4">
        <div>
          <div className={`${product.id === 0 ? 'text-emerald-400' : product.id === 1 ? 'text-cyan-400' : 'text-violet-400'} text-xs font-extrabold tracking-widest`}>
            {product.tier}
          </div>
          <h3 className="text-3xl font-semibold tracking-tight mt-0.5">{product.name}</h3>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">{t('from')}</div>
          <div className="text-3xl font-semibold tabular-nums">€{product.price}</div>
        </div>
      </div>
      
      <p className="text-slate-400 flex-1 text-[15px] mb-6">{product.description}</p>
      
      <div className="my-2 text-xs">
        <div className="flex justify-between text-slate-400 mb-1.5">
          <span>{t('bestForLabel')}</span> 
          <span className={`font-medium ${product.id === 0 ? 'text-emerald-400' : product.id === 1 ? 'text-cyan-400' : 'text-violet-400'}`}>
            {bestFor}
          </span>
        </div>
      </div>
      
      <button 
        onClick={onConfigure}
        className="mt-auto w-full py-[15px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 transition-all flex items-center justify-center gap-x-2"
      >
        {t('configure')}
      </button>
    </div>
  );
}

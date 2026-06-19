'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Product } from '@/lib/types';
import PromoBadge from '@/components/PromoBadge';
import { formatPromoDate } from '@/lib/promo-display';
import { isPreorderMode } from '@/lib/commerce-mode';
import { getPreorderDeposit } from '@/lib/pricing';

interface Props {
  product: Product;
  onConfigure: () => void;
}

export default function ProductCard({ product, onConfigure }: Props) {
  const locale = useLocale();
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const tp = useTranslations('promotions');
  const bestFor = t(`bestFor.${product.id}`);
  const preorderMode = isPreorderMode();
  const deposit = getPreorderDeposit(product.slug);

  const hasPromo =
    product.listPrice != null && product.listPrice > product.price;

  const tierColor =
    product.id === 0 ? 'text-emerald-400' :
    product.id === 1 ? 'text-cyan-400' :
    'text-violet-400';

  return (
    <div className="product-card bg-slate-900 border border-slate-800 rounded-3xl p-7 flex flex-col relative transition-all duration-200 hover:-translate-y-1 hover:border-slate-700 hover:shadow-xl">
      {product.promotionBadge && <PromoBadge badge={product.promotionBadge} />}

      <div className="flex justify-between items-start mb-4">
        <div>
          <div className={`${tierColor} text-xs font-extrabold tracking-widest`}>
            {product.tier}
          </div>
          <h3 className="text-3xl font-semibold tracking-tight mt-0.5">{product.name}</h3>
        </div>
        <div className="text-right shrink-0 max-w-[55%]">
          {hasPromo ? (
            <>
              <div className="text-xs text-slate-400 tabular-nums">
                {t('from')}{' '}
                <span className="line-through">{tc('price', { amount: product.listPrice! })}</span>
              </div>
              <div className="text-3xl font-semibold tabular-nums tracking-tight text-white mt-0.5">
                {tc('price', { amount: product.price })}
              </div>
              {product.promotionBadge?.until && (
                <div className="text-xs text-slate-400 tabular-nums mt-0.5">
                  {tp('hardwarePromoUntil', {
                    date: formatPromoDate(product.promotionBadge.until, locale),
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="text-3xl font-semibold tabular-nums tracking-tight">
              <span className="text-xs text-slate-400 font-normal block mb-0.5">{t('from')}</span>
              {tc('price', { amount: product.price })}
            </div>
          )}
        </div>
      </div>

      <p className="text-slate-400 flex-1 text-[15px] mb-6">{product.description}</p>

      <div className="my-2 text-xs">
        <div className="flex justify-between text-slate-400 mb-1.5">
          <span>{t('bestForLabel')}</span>
          <span className={`font-medium ${tierColor}`}>{bestFor}</span>
        </div>
        {preorderMode && (
          <div className="flex justify-between text-slate-400 mb-1.5">
            <span>{t('preorderDepositLabel')}</span>
            <span className="font-medium text-amber-400/90">
              {tc('price', { amount: deposit })}
              <span className="text-slate-500 font-normal ml-1">{tc('exclVat')}</span>
            </span>
          </div>
        )}
      </div>

      <button
        onClick={onConfigure}
        className="mt-auto w-full py-[15px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 transition-all flex items-center justify-center gap-x-2"
      >
        {preorderMode ? t('preorder') : t('configure')}
      </button>
    </div>
  );
}
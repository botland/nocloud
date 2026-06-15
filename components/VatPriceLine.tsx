'use client';

import { useTranslations } from 'next-intl';

interface Props {
  label: string;
  /** Amount shown to the customer (gross when VAT-inclusive). */
  amount: number;
  net: number;
  vat: number;
  showBreakdown?: boolean;
  /** `row`: label left, amount right (step 1 footer). `summary`: stacked headline (step 2). */
  variant?: 'row' | 'summary';
  className?: string;
  labelClassName?: string;
  amountClassName?: string;
  breakdownClassName?: string;
}

export default function VatPriceLine({
  label,
  amount,
  net,
  vat,
  showBreakdown = false,
  variant = 'row',
  className = '',
  labelClassName,
  amountClassName,
  breakdownClassName,
}: Props) {
  const tc = useTranslations('common');
  const t = useTranslations('checkout');

  const defaultLabelClass =
    variant === 'summary' ? 'text-xs text-slate-400' : 'text-slate-400';
  const defaultAmountClass =
    variant === 'summary'
      ? 'text-2xl font-semibold tabular-nums'
      : 'font-semibold tabular-nums';
  const defaultBreakdownClass = 'text-[10px] text-emerald-400';

  const price = tc('price', { amount });

  if (variant === 'summary') {
    return (
      <div className={className}>
        <div className={labelClassName ?? defaultLabelClass}>{label}</div>
        <div className={amountClassName ?? defaultAmountClass}>{price}</div>
        {showBreakdown && (
          <div className={breakdownClassName ?? defaultBreakdownClass}>
            {t('vatBreakdown', { net, vat })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex justify-between text-sm">
        <span className={labelClassName ?? defaultLabelClass}>{label}</span>
        <span className={amountClassName ?? defaultAmountClass}>{price}</span>
      </div>
      {showBreakdown && (
        <div className={`${breakdownClassName ?? defaultBreakdownClass} text-right mt-0.5`}>
          {t('vatBreakdown', { net, vat })}
        </div>
      )}
    </div>
  );
}
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatPromoDate, isRecurringPromo, recurringPriceSuffix } from '@/lib/promo-display';

interface Props {
  amount: number;
  listAmount?: number;
  /** Promo end (inclusive) or launch-free until (exclusive) — ISO YYYY-MM-DD */
  untilDate?: string;
  untilKind?: 'launch_free' | 'promotion';
  suffix?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** `recurring` shows "€X/mo until D then €Y/mo"; `oneTime` shows promo + optional from/list */
  mode?: 'recurring' | 'oneTime';
}

export default function PromoPrice({
  amount,
  listAmount,
  untilDate,
  untilKind = 'promotion',
  suffix = '',
  className = '',
  size = 'md',
  mode = 'recurring',
}: Props) {
  const locale = useLocale();
  const tc = useTranslations('common');
  const tp = useTranslations('promotions');

  const sizeClass =
    size === 'lg' ? 'text-3xl font-semibold tabular-nums' :
    size === 'sm' ? 'text-sm font-mono' :
    'text-base font-semibold tabular-nums';

  const promo = isRecurringPromo(amount, listAmount, untilDate);
  const dateLabel = untilDate ? formatPromoDate(untilDate, locale) : '';
  const showStrike = listAmount != null && listAmount > amount;

  // Landing / marketing: strikethrough list + promo (no until/then sentence).
  if (mode === 'recurring' && showStrike && !untilDate) {
    const isFree = amount === 0;
    return (
      <span className={`inline-flex items-baseline gap-2 flex-wrap ${className}`}>
        <span className={`text-slate-500 line-through ${size === 'sm' ? 'text-xs' : 'text-sm'} tabular-nums`}>
          {tc('price', { amount: listAmount! })}
          {suffix}
        </span>
        <span className={sizeClass}>
          {isFree ? (
            <span className="text-emerald-400">{tp('freePrice')}</span>
          ) : (
            <>
              {tc('price', { amount })}
              {suffix}
            </>
          )}
        </span>
      </span>
    );
  }

  if (mode === 'recurring' && promo && listAmount != null) {
    const isFree = amount === 0 && untilKind === 'launch_free';
    const thenLine = tp('recurringThenList', {
      list: tc('price', { amount: listAmount }),
      suffix,
    });
    const untilLineClass =
      size === 'lg'
        ? 'text-sm tabular-nums leading-tight'
        : size === 'sm'
          ? 'text-[10px] tabular-nums leading-tight'
          : 'text-xs tabular-nums leading-tight';
    const thenLineClass =
      size === 'lg'
        ? 'text-xs tabular-nums leading-tight opacity-90'
        : 'text-[10px] tabular-nums leading-tight opacity-80';
    return (
      <span className={`inline-flex flex-col items-end gap-px leading-none ${className}`}>
        <span className={untilLineClass}>
          {isFree
            ? tp('recurringFreeUntil', { date: dateLabel })
            : tp('recurringPromoUntil', {
                promo: tc('price', { amount }),
                date: dateLabel,
                suffix,
              })}
        </span>
        <span className={thenLineClass}>{thenLine}</span>
      </span>
    );
  }

  if (mode === 'oneTime' && listAmount != null && listAmount > amount) {
    return (
      <span className={`inline-flex flex-col items-end tabular-nums ${className}`}>
        <span className={`text-slate-400 ${size === 'lg' ? 'text-xs' : size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>
          {tp('hardwareFromList')}{' '}
          <span className="line-through">{tc('price', { amount: listAmount })}</span>
        </span>
        <span className={`${sizeClass} text-white mt-0.5`}>{tc('price', { amount })}</span>
        {untilDate && (
          <span className={`text-slate-400 mt-0.5 ${size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>
            {tp('hardwarePromoUntil', { date: dateLabel })}
          </span>
        )}
      </span>
    );
  }

  if (amount === 0) {
    return (
      <span className={`${sizeClass} ${className}`}>
        <span className="text-emerald-400">{tp('freePrice')}</span>
      </span>
    );
  }

  return (
    <span className={`tabular-nums ${sizeClass} ${className}`}>
      {tc('price', { amount })}
      {recurringPriceSuffix(amount, suffix)}
    </span>
  );
}
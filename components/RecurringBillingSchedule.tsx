'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { RecurringServiceLine } from '@/lib/cart-services';
import { buildRecurringBillingSchedule } from '@/lib/recurring-billing-schedule';
import { formatPromoDate, recurringPriceSuffix } from '@/lib/promo-display';

interface Props {
  lines: RecurringServiceLine[];
  /** When set (e.g. VAT-inclusive checkout), display gross amounts */
  grossAmount?: (net: number) => number;
  className?: string;
  size?: 'sm' | 'md';
}

export default function RecurringBillingSchedule({
  lines,
  grossAmount,
  className = '',
  size = 'sm',
}: Props) {
  const locale = useLocale();
  const tc = useTranslations('common');
  const tp = useTranslations('promotions');

  const phases = buildRecurringBillingSchedule(lines);
  if (phases.length === 0) return null;

  const display = (net: number) => (grossAmount ? grossAmount(net) : net);
  const suffix = tc('perMonth');
  const textClass = size === 'sm' ? 'text-[10px] leading-snug' : 'text-xs leading-snug';
  const hasMultiple = phases.length > 1;

  return (
    <div className={className}>
      <p className={`${textClass} text-slate-400 mb-0.5`}>{tp('recurringScheduleTitle')}</p>
      <div className="space-y-px">
        {phases.map((phase, index) => {
          const amount = display(phase.monthlyNet);
          const untilLabel = phase.untilDate
            ? formatPromoDate(phase.untilDate, locale)
            : undefined;
          const isFirst = index === 0;
          const then = !isFirst;

          let copy: string;
          if (untilLabel) {
            if (amount === 0) {
              copy = then
                ? tp('recurringScheduleThenFreeUntil', { date: untilLabel })
                : tp('recurringScheduleFreeUntil', { date: untilLabel });
            } else {
              const price = tc('price', { amount });
              copy = then
                ? tp('recurringScheduleThenUntil', { price, suffix, date: untilLabel })
                : tp('recurringScheduleUntil', { price, suffix, date: untilLabel });
            }
          } else if (hasMultiple) {
            copy = tp('recurringScheduleThenOngoing', {
              price: tc('price', { amount }),
              suffix: recurringPriceSuffix(amount, suffix),
            });
          } else {
            copy = `${tc('price', { amount })}${recurringPriceSuffix(amount, suffix)}`;
          }

          return (
            <p
              key={`${phase.fromDate}-${phase.untilDate ?? 'ongoing'}`}
              className={`${textClass} tabular-nums text-emerald-400/90`}
            >
              {copy}
            </p>
          );
        })}
      </div>
      {hasMultiple && (
        <p className={`${textClass} text-slate-500 mt-1`}>{tp('recurringScheduleNote')}</p>
      )}
    </div>
  );
}
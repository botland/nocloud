'use client';

import { useTranslations } from 'next-intl';
import PromoPrice from '@/components/PromoPrice';
import RecurringBillingSchedule from '@/components/RecurringBillingSchedule';
import type { RecurringServiceLine } from '@/lib/cart-services';
import { totalMonthlyAt } from '@/lib/recurring-billing-schedule';

interface Props {
  lines: RecurringServiceLine[];
  /** Per-service lines, combined schedule, or both */
  variant?: 'lines' | 'schedule' | 'both';
  /** Show payment-method note when all recurring lines are €0 today */
  showPmNote?: boolean;
  className?: string;
  nameClassName?: string;
  /** When set (e.g. VAT-inclusive checkout), display gross amounts in promo copy */
  grossAmount?: (net: number) => number;
}

export default function RecurringServicesSummary({
  lines,
  variant = 'lines',
  showPmNote = false,
  className = '',
  nameClassName = 'text-emerald-400/90',
  grossAmount,
}: Props) {
  const tc = useTranslations();

  if (lines.length === 0) return null;

  const servicesMonthly = totalMonthlyAt(lines);
  const display = (net: number) => (grossAmount ? grossAmount(net) : net);
  const showLines = variant === 'lines' || variant === 'both';
  const showSchedule = variant === 'schedule' || variant === 'both';

  return (
    <div className={className}>
      {showLines && (
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="flex justify-between items-start gap-3 text-xs">
              <span className={`truncate min-w-0 ${nameClassName}`}>{line.name}</span>
              <PromoPrice
                amount={display(line.price)}
                listAmount={line.listPrice != null ? display(line.listPrice) : undefined}
                untilDate={line.launchFreeUntil || line.promoEndsAt}
                untilKind={line.launchFreeUntil ? 'launch_free' : 'promotion'}
                suffix={tc('common.perMonth')}
                size="sm"
                className="text-right shrink-0 max-w-[65%]"
              />
            </div>
          ))}
        </div>
      )}
      {showSchedule && (
        <RecurringBillingSchedule
          lines={lines}
          grossAmount={grossAmount}
          size="sm"
          className={showLines ? 'mt-2 pt-2 border-t border-slate-800/80' : ''}
        />
      )}
      {showPmNote && servicesMonthly === 0 && (
        <p className="text-[10px] text-amber-400/90 leading-snug pt-2">
          {tc('promotions.recurringPmRequired')}
        </p>
      )}
    </div>
  );
}
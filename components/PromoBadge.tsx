'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PriceBadge } from '@/lib/promotions';

interface Props {
  badge: PriceBadge;
  /** `corner` = floating pill on card edge; `inline` = compact pill beside a label */
  variant?: 'corner' | 'inline';
  /** When false, renders only the pill (for use inside PromoBadgeStack). Default true for corner. */
  floating?: boolean;
  className?: string;
}

// Deterministic month formatting to avoid hydration mismatches
// between server (Node) and client (different browsers/OS locales)
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatUntilDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    const day = d.getUTCDate();
    const month = SHORT_MONTHS[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return iso;
  }
}

function PromoBadgePill({
  badge,
  variant,
  className = '',
}: {
  badge: PriceBadge;
  variant: 'corner' | 'inline';
  className?: string;
}) {
  const locale = useLocale();
  const tp = useTranslations('promotions');
  const labelKey = badge.labelKey.replace(/^promotions\./, '');

  const isLaunch = badge.kind === 'launch_free';
  const colorClass = isLaunch
    ? 'bg-emerald-400 text-slate-950'
    : 'bg-amber-400 text-slate-950';

  const label =
    badge.percent != null
      ? tp(labelKey, { percent: badge.percent })
      : tp(labelKey);
  const until = badge.until
    ? isLaunch
      ? tp('managedCareLaunchFreeUntil', { date: formatUntilDate(badge.until) })
      : tp('hardwarePromoUntil', { date: formatUntilDate(badge.until) })
    : null;

  const pillClass =
    variant === 'inline'
      ? `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${colorClass}`
      : `${colorClass} text-[10px] font-bold px-3 py-1 rounded-2xl tracking-wider text-center leading-tight shadow-sm`;

  const Wrapper = variant === 'inline' ? 'span' : 'div';

  return (
    <Wrapper className={`${pillClass} ${className}`}>
      <span className="block">{label}</span>
      {until && variant === 'corner' && (
        <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-90 mt-0.5">
          {until}
        </span>
      )}
    </Wrapper>
  );
}

export default function PromoBadge({
  badge,
  variant = 'corner',
  floating = true,
  className = '',
}: Props) {
  if (variant === 'inline') {
    return <PromoBadgePill badge={badge} variant="inline" className={className} />;
  }

  const pill = <PromoBadgePill badge={badge} variant="corner" className={className} />;

  if (!floating) {
    return pill;
  }

  return (
    <div className="absolute -top-3 right-6 z-10 max-w-[calc(100%-3rem)] pointer-events-none">
      {pill}
    </div>
  );
}

/** Row of promo pills along the top edge of a card (e.g. pre-order + tier launch). */
export function PromoBadgeStack({
  badges,
  className = '',
}: {
  badges: PriceBadge[];
  className?: string;
}) {
  const visible = badges.filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <div
      className={`absolute -top-3 left-3 right-3 z-10 flex flex-row flex-nowrap items-center justify-center gap-1 pointer-events-none ${className}`}
    >
      {visible.map((badge, idx) => (
        <PromoBadge
          key={`${badge.labelKey}-${idx}`}
          badge={badge}
          variant="inline"
          floating={false}
          className="shrink-0"
        />
      ))}
    </div>
  );
}
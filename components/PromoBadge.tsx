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

function formatUntilDate(iso: string, locale: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
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

  const label = tp(labelKey);
  const until = badge.until
    ? isLaunch
      ? tp('managedCareLaunchFreeUntil', { date: formatUntilDate(badge.until, locale) })
      : tp('hardwarePromoUntil', { date: formatUntilDate(badge.until, locale) })
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

/** Stack multiple corner badges vertically at the same anchor (e.g. overlapping promos). */
export function PromoBadgeStack({
  badges,
  className = '',
}: {
  badges: PriceBadge[];
  className?: string;
}) {
  const visible = badges.filter(Boolean);
  if (visible.length === 0) return null;

  if (visible.length === 1) {
    return <PromoBadge badge={visible[0]} className={className} />;
  }

  return (
    <div
      className={`absolute -top-2 right-4 z-10 flex flex-col items-end gap-1 max-w-[calc(100%-2rem)] pointer-events-none ${className}`}
    >
      {visible.map((badge, idx) => (
        <PromoBadge key={`${badge.labelKey}-${idx}`} badge={badge} floating={false} />
      ))}
    </div>
  );
}
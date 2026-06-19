import { isPreorderMode } from './commerce-mode';
import {
  aggregateHardwarePromoNet,
  applyHardwareDiscount,
  calculateHardwarePrice,
  getHardwarePrice,
  getServicePrice as getBaseServicePrice,
  HARDWARE_PRICES,
  PREORDER_HARDWARE_DISCOUNT_PERCENT,
  SERVICE_PRICES_BY_TIER,
  type HardwareCustomization,
  type HardwareSlug,
  type ServiceKey,
} from './pricing';

export type PromotionKind = 'promotion' | 'launch_free';

export interface PriceBadge {
  kind: PromotionKind;
  labelKey: string;
  /** ISO date YYYY-MM-DD for UI copy (e.g. free-until). */
  until?: string;
  /** Discount percent for badge copy (e.g. pre-order hardware). */
  percent?: number;
}

export interface ResolvedPrice {
  net: number;
  list: number;
  badge?: PriceBadge;
  /** All applicable hardware promo badges (e.g. pre-order + tier launch). */
  badges?: PriceBadge[];
  promotionIds?: string[];
  /** When set, service is complimentary until this date (exclusive midnight UTC). */
  launchFreeUntil?: string;
  /** Last inclusive day (YYYY-MM-DD) of a time-boxed tier promotion; billing reverts to list after. */
  promoEndsAt?: string;
}

export interface TierPromotion {
  id: string;
  labelKey: string;
  startDate: string;
  endDate: string;
  tiers: HardwareSlug[];
  /** 0–100 discount applied to the list price. */
  discountPercent: number;
}

export interface ServiceTierPromotion extends TierPromotion {
  services: ServiceKey[];
}

/**
 * Managed Care launch: complimentary recurring until this date (exclusive).
 * Independent of time-boxed tier promotions above.
 */
export const MANAGED_CARE_LAUNCH_OFFER = {
  serviceKey: 'managedCare' as const,
  /** Orders before this date (UTC) include complimentary Managed Care until then. */
  freeUntil: '2027-01-01',
  labelKey: 'managedCareLaunchFree',
  untilLabelKey: 'managedCareLaunchFreeUntil',
} as const;

/**
 * Time-boxed hardware promotions per tier. Edit dates/percent when running campaigns.
 * Empty array = no hardware promos (safe default for tests).
 */
export const HARDWARE_TIER_PROMOTIONS: TierPromotion[] = [
  {
    id: 'edge-launch-2026',
    labelKey: 'launchEdge',
    startDate: '2026-06-01',
    endDate: '2026-09-30',
    tiers: ['edge'],
    discountPercent: 10,
  },
];

/** Time-boxed recurring service promotions per tier (excludes launch-free Managed Care). */
export const SERVICE_TIER_PROMOTIONS: ServiceTierPromotion[] = [
  {
    id: 'studio-vault-2026',
    labelKey: 'vaultStudio',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    tiers: ['studio'],
    services: ['secureVaultBackup'],
    discountPercent: 20,
  },
];

export function startOfDayUtc(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`);
}

export function endOfDayUtc(isoDate: string): number {
  return Date.parse(`${isoDate}T23:59:59.999Z`);
}

export function isDateInRange(isoStart: string, isoEnd: string, at: Date = new Date()): boolean {
  const t = at.getTime();
  return t >= startOfDayUtc(isoStart) && t <= endOfDayUtc(isoEnd);
}

export function isBeforeUtcDate(isoDate: string, at: Date = new Date()): boolean {
  return at.getTime() < startOfDayUtc(isoDate);
}

export function launchFreeUntilEpoch(isoDate: string): number {
  return Math.floor(startOfDayUtc(isoDate) / 1000);
}

/** Stripe phase end (exclusive): first second of the UTC day after the inclusive promo end date. */
export function promoPhaseEndEpoch(isoEndDate: string): number {
  const dayAfter = new Date(startOfDayUtc(isoEndDate));
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return Math.floor(dayAfter.getTime() / 1000);
}

export function isManagedCareLaunchFree(at: Date = new Date()): boolean {
  return isBeforeUtcDate(MANAGED_CARE_LAUNCH_OFFER.freeUntil, at);
}

export function getActiveHardwarePromotion(
  slug: HardwareSlug,
  at: Date = new Date(),
): TierPromotion | undefined {
  return HARDWARE_TIER_PROMOTIONS.find(
    (p) => p.tiers.includes(slug) && isDateInRange(p.startDate, p.endDate, at),
  );
}

function getPreorderHardwareDiscountPercent(slug: HardwareSlug): number {
  if (!isPreorderMode() || !(slug in HARDWARE_PRICES)) return 0;
  return PREORDER_HARDWARE_DISCOUNT_PERCENT;
}

export function getActiveServicePromotion(
  key: ServiceKey,
  slug: HardwareSlug,
  at: Date = new Date(),
): ServiceTierPromotion | undefined {
  return SERVICE_TIER_PROMOTIONS.find(
    (p) =>
      p.services.includes(key) &&
      p.tiers.includes(slug) &&
      isDateInRange(p.startDate, p.endDate, at),
  );
}

function applyPercentOff(list: number, percent: number): number {
  if (percent <= 0) return list;
  return Math.max(0, Math.round(list * (1 - percent / 100)));
}

export function resolveHardwarePrice(
  slug: HardwareSlug | string,
  customization?: HardwareCustomization,
  at: Date = new Date(),
): ResolvedPrice {
  const tier = slug as HardwareSlug;
  const list = customization
    ? calculateHardwarePrice(tier, customization)
    : getHardwarePrice(tier);

  if (!(tier in HARDWARE_PRICES)) {
    return { net: list, list };
  }

  const knownTier = tier as HardwareSlug;
  const preorderPercent = getPreorderHardwareDiscountPercent(knownTier);
  const promo = getActiveHardwarePromotion(knownTier, at);

  const badges: PriceBadge[] = [];
  if (preorderPercent > 0) {
    badges.push({
      kind: 'promotion',
      labelKey: 'preorderHardwareDiscount',
      percent: preorderPercent,
    });
  }
  if (promo && promo.discountPercent > 0) {
    badges.push({
      kind: 'promotion',
      labelKey: promo.labelKey,
      until: promo.endDate,
    });
  }

  const tierPercent = promo?.discountPercent ?? 0;
  if (preorderPercent <= 0 && tierPercent <= 0) {
    return { net: list, list };
  }

  const promotionIds: string[] = [];
  if (preorderPercent > 0) promotionIds.push('preorder-hardware-discount');
  if (promo) promotionIds.push(promo.id);

  const net = aggregateHardwarePromoNet(
    knownTier,
    preorderPercent,
    tierPercent,
    customization,
  );

  return {
    net,
    list,
    badge: badges[0],
    badges,
    promotionIds,
  };
}

export function resolveServicePrice(
  key: ServiceKey,
  hardwareSlug?: HardwareSlug | string,
  at: Date = new Date(),
): ResolvedPrice {
  const slug = hardwareSlug as HardwareSlug | undefined;
  const list = getBaseServicePrice(key, slug);

  if (key === MANAGED_CARE_LAUNCH_OFFER.serviceKey && isManagedCareLaunchFree(at)) {
    return {
      net: 0,
      list,
      badge: {
        kind: 'launch_free',
        labelKey: MANAGED_CARE_LAUNCH_OFFER.labelKey,
        until: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
      },
      launchFreeUntil: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
    };
  }

  const promo =
    slug && slug in SERVICE_PRICES_BY_TIER
      ? getActiveServicePromotion(key, slug as HardwareSlug, at)
      : undefined;

  if (!promo) {
    return { net: list, list };
  }

  return {
    net: applyPercentOff(list, promo.discountPercent),
    list,
    badge: { kind: 'promotion', labelKey: promo.labelKey, until: promo.endDate },
    promotionIds: [promo.id],
    promoEndsAt: promo.endDate,
  };
}

/** Lowest effective monthly service price for marketing (respects launch-free Managed Care). */
export function resolveMinServicePrice(key: ServiceKey, at: Date = new Date()): ResolvedPrice {
  const tiers = Object.keys(SERVICE_PRICES_BY_TIER) as HardwareSlug[];
  const resolved = tiers.map((slug) => resolveServicePrice(key, slug, at));
  const net = Math.min(...resolved.map((r) => r.net));
  const best = resolved.find((r) => r.net === net) ?? resolved[0];
  return {
    net,
    list: best.list,
    badge: best.badge,
    launchFreeUntil: best.launchFreeUntil,
    promotionIds: best.promotionIds,
    promoEndsAt: best.promoEndsAt,
  };
}
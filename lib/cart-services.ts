import type { CartItem } from './types';

export type RecurringServiceLine = {
  id: string;
  name: string;
  key?: string;
  price: number;
  listPrice?: number;
  launchFreeUntil?: string;
  promoEndsAt?: string;
};

/** True when the cart includes any recurring service selection (regardless of current net price). */
export function hasRecurringServices(cart: CartItem[]): boolean {
  return cart.some((item) => (item.services?.length || 0) > 0);
}

export function recurringServicesMonthly(cart: CartItem[]): number {
  return cart.reduce(
    (sum, item) =>
      sum +
      (item.services || []).reduce(
        (s, svc) => s + (svc.price || 0) * (item.quantity || 1),
        0,
      ),
    0,
  );
}

/** One row per service instance (cart line qty expands into multiple appliances). */
export function recurringLinesFromCart(cart: CartItem[]): RecurringServiceLine[] {
  return cart.flatMap((item) => {
    const qty = item.quantity || 1;
    return (item.services || []).flatMap((svc, idx) =>
      Array.from({ length: qty }, (_, i) => ({
        id: `${item.id}-${svc.key || idx}-${i}`,
        key: svc.key,
        name: svc.name,
        price: svc.price,
        listPrice: svc.listPrice,
        launchFreeUntil: svc.launchFreeUntil,
        promoEndsAt: svc.promoEndsAt,
      })),
    );
  });
}

/** Same service + same promotional window (amounts may differ per tier). */
export function recurringPromoGroupKey(line: RecurringServiceLine): string {
  return [
    line.key || line.name,
    line.launchFreeUntil ?? '',
    line.promoEndsAt ?? '',
  ].join('|');
}

/**
 * Combine recurring services with the same key and promotional period by summing
 * monthly net and list amounts (tier-priced units may differ). Used in cart / checkout footers.
 */
export function aggregateRecurringServiceLines(lines: RecurringServiceLine[]): RecurringServiceLine[] {
  const groups = new Map<
    string,
    RecurringServiceLine & { count: number; listTotal: number }
  >();

  for (const line of lines) {
    const groupKey = recurringPromoGroupKey(line);
    const listUnit = line.listPrice ?? line.price;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.price += line.price;
      existing.listTotal += listUnit;
    } else {
      groups.set(groupKey, {
        ...line,
        count: 1,
        listTotal: listUnit,
      });
    }
  }

  return Array.from(groups.entries()).map(([groupKey, g]) => ({
    id: groupKey,
    key: g.key,
    name: g.count > 1 ? `${g.name} ×${g.count}` : g.name,
    price: g.price,
    listPrice: g.listTotal,
    launchFreeUntil: g.launchFreeUntil,
    promoEndsAt: g.promoEndsAt,
  }));
}

export function aggregatedRecurringLinesFromCart(cart: CartItem[]): RecurringServiceLine[] {
  return aggregateRecurringServiceLines(recurringLinesFromCart(cart));
}
import { describe, it, expect } from 'vitest';
import {
  lineMonthlyAt,
  totalMonthlyAt,
  collectBillingTransitionDates,
  buildRecurringBillingSchedule,
} from '@/lib/recurring-billing-schedule';
import type { RecurringServiceLine } from '@/lib/cart-services';
import { MANAGED_CARE_LAUNCH_OFFER } from '@/lib/promotions';
import { SERVICE_PRICES_BY_TIER } from '@/lib/pricing';

describe('lib/recurring-billing-schedule', () => {
  const june2026 = new Date('2026-06-15T12:00:00.000Z');

  const managedCareLaunch: RecurringServiceLine = {
    id: 'mc',
    name: 'Managed Care',
    key: 'managedCare',
    price: 0,
    listPrice: SERVICE_PRICES_BY_TIER.studio.managedCare,
    launchFreeUntil: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
  };

  const vaultPromo: RecurringServiceLine = {
    id: 'vault',
    name: 'Secure Vault Backup',
    key: 'secureVaultBackup',
    price: Math.round(SERVICE_PRICES_BY_TIER.studio.secureVaultBackup * 0.8),
    listPrice: SERVICE_PRICES_BY_TIER.studio.secureVaultBackup,
    promoEndsAt: '2026-08-31',
  };

  it('returns zero for launch-free service before free-until date', () => {
    expect(lineMonthlyAt(managedCareLaunch, june2026)).toBe(0);
  });

  it('charges list price after launch-free window', () => {
    const after = new Date('2027-06-01T12:00:00.000Z');
    expect(lineMonthlyAt(managedCareLaunch, after)).toBe(managedCareLaunch.listPrice);
  });

  it('sums all lines at a given instant', () => {
    const total = totalMonthlyAt([managedCareLaunch, vaultPromo], june2026);
    expect(total).toBe(vaultPromo.price);
  });

  it('collects transition dates from promos and launch windows', () => {
    const dates = collectBillingTransitionDates([managedCareLaunch, vaultPromo]);
    expect(dates).toEqual(['2026-09-01', MANAGED_CARE_LAUNCH_OFFER.freeUntil]);
  });

  it('builds merged phases for launch-free managed care only', () => {
    const phases = buildRecurringBillingSchedule([managedCareLaunch], june2026);
    expect(phases).toEqual([
      {
        fromDate: '2026-06-15',
        untilDate: '2026-12-31',
        monthlyNet: 0,
      },
      {
        fromDate: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
        monthlyNet: managedCareLaunch.listPrice,
      },
    ]);
  });

  it('builds combined schedule when vault promo ends before managed care launch', () => {
    const phases = buildRecurringBillingSchedule(
      [managedCareLaunch, vaultPromo],
      june2026,
    );

    expect(phases).toHaveLength(3);
    expect(phases[0]).toMatchObject({
      fromDate: '2026-06-15',
      untilDate: '2026-08-31',
      monthlyNet: vaultPromo.price,
    });
    expect(phases[1]).toMatchObject({
      fromDate: '2026-09-01',
      untilDate: '2026-12-31',
      monthlyNet: vaultPromo.listPrice,
    });
    expect(phases[2]).toMatchObject({
      fromDate: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
      monthlyNet:
        (managedCareLaunch.listPrice ?? 0) + (vaultPromo.listPrice ?? 0),
    });
  });

  it('returns a single ongoing phase for stable recurring pricing', () => {
    const stable: RecurringServiceLine = {
      id: 'stable',
      name: 'Support',
      price: 25,
      listPrice: 25,
    };
    const phases = buildRecurringBillingSchedule([stable], june2026);
    expect(phases).toEqual([{ fromDate: '2026-06-15', monthlyNet: 25 }]);
  });

  it('returns empty schedule for no lines', () => {
    expect(buildRecurringBillingSchedule([])).toEqual([]);
  });
});
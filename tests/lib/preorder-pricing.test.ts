import { describe, it, expect } from 'vitest';
import {
  applyHardwareDiscount,
  computeTotalPreorderDeposit,
  computePreorderQuote,
  getPreorderDeposit,
  aggregateHardwarePromoNet,
  getHardwareUpgradeExtra,
  hardwareNetWithBaseDiscount,
  HARDWARE_PRICES,
  PREORDER_DEPOSITS,
  PREORDER_HARDWARE_DISCOUNT_PERCENT,
} from '@/lib/pricing';

describe('lib/pricing pre-order helpers', () => {
  it('exposes fixed deposits per tier', () => {
    expect(PREORDER_DEPOSITS.edge).toBe(500);
    expect(PREORDER_DEPOSITS.studio).toBe(1500);
    expect(PREORDER_DEPOSITS.forge).toBe(5000);
    expect(getPreorderDeposit('edge')).toBe(500);
  });

  it('sums deposits across cart items with quantity', () => {
    const total = computeTotalPreorderDeposit([
      { product: { slug: 'edge' }, quantity: 2 },
      { product: { slug: 'studio' }, quantity: 1 },
    ]);
    expect(total).toBe(500 * 2 + 1500);
  });

  it('computes balance due from hardware total minus deposit', () => {
    const quote = computePreorderQuote(7990, 1500);
    expect(quote.hardwareTotal).toBe(7990);
    expect(quote.totalDeposit).toBe(1500);
    expect(quote.balanceDue).toBe(6490);
  });

  it('exposes pre-order hardware discount percent and helper', () => {
    expect(PREORDER_HARDWARE_DISCOUNT_PERCENT).toBeGreaterThan(0);
    expect(applyHardwareDiscount(HARDWARE_PRICES.studio, PREORDER_HARDWARE_DISCOUNT_PERCENT)).toBe(
      Math.round(HARDWARE_PRICES.studio * (1 - PREORDER_HARDWARE_DISCOUNT_PERCENT / 100)),
    );
  });

  it('hardwareNetWithBaseDiscount discounts base only and keeps upgrades at list', () => {
    const customization = { vram: { value: 24, label: '24 GB GDDR6' } };
    const net = hardwareNetWithBaseDiscount('edge', PREORDER_HARDWARE_DISCOUNT_PERCENT, customization);
    expect(net).toBe(applyHardwareDiscount(HARDWARE_PRICES.edge, PREORDER_HARDWARE_DISCOUNT_PERCENT) + 2690);
  });

  it('getHardwareUpgradeExtra returns list option surcharges only', () => {
    const customization = { ram: { value: 128, label: '128 GB' } };
    expect(getHardwareUpgradeExtra('studio', customization)).toBe(1090);
    expect(getHardwareUpgradeExtra('studio')).toBe(0);
  });

  it('aggregateHardwarePromoNet stacks pre-order on base then tier on base and upgrades', () => {
    const customization = { vram: { value: 24, label: '24 GB GDDR6' } };
    const net = aggregateHardwarePromoNet('edge', 10, 10, customization);
    const baseAfterBoth = applyHardwareDiscount(applyHardwareDiscount(HARDWARE_PRICES.edge, 10), 10);
    expect(net).toBe(baseAfterBoth + applyHardwareDiscount(2690, 10));
  });
});
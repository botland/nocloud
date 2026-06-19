import { describe, it, expect } from 'vitest';
import {
  computeTotalPreorderDeposit,
  computePreorderQuote,
  getPreorderDeposit,
  PREORDER_DEPOSITS,
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
});
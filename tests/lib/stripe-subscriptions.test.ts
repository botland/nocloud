import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import {
  createMonthlyRecurringPrice,
  createMonthlyRecurringPriceDataItem,
  createPhasedMonthlySubscription,
} from '@/lib/stripe-subscriptions'

function mockStripe() {
  return {
    products: {
      create: vi.fn().mockResolvedValue({ id: 'prod_1' }),
    },
    prices: {
      create: vi
        .fn()
        .mockResolvedValueOnce({ id: 'price_promo' })
        .mockResolvedValueOnce({ id: 'price_list' }),
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({ id: 'sub_from_schedule' }),
    },
    subscriptionSchedules: {
      create: vi.fn().mockResolvedValue({
        id: 'sched_1',
        subscription: 'sub_from_schedule',
      }),
    },
  }
}

describe('lib/stripe-subscriptions', () => {

  it('createMonthlyRecurringPrice creates product and monthly price', async () => {
    const stripe = mockStripe()
    stripe.prices.create.mockReset()
    stripe.prices.create.mockResolvedValue({ id: 'price_1' })

    const result = await createMonthlyRecurringPrice(stripe as unknown as Stripe, 'Managed Care', 99, {
      description: 'Support',
      metadata: { serial_number: 'NC-1' },
    })

    expect(result).toEqual({ productId: 'prod_1', priceId: 'price_1' })
    expect(stripe.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Managed Care', description: 'Support' }),
    )
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'eur',
        product: 'prod_1',
        unit_amount: 9900,
        recurring: { interval: 'month' },
      }),
    )
  })

  it('createMonthlyRecurringPrice reuses an existing product id', async () => {
    const stripe = mockStripe()
    stripe.prices.create.mockReset()
    stripe.prices.create.mockResolvedValue({ id: 'price_2' })

    await createMonthlyRecurringPrice(stripe as unknown as Stripe, 'Vault', 12, {
      productId: 'prod_existing',
    })

    expect(stripe.products.create).not.toHaveBeenCalled()
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ product: 'prod_existing', unit_amount: 1200 }),
    )
  })

  it('createMonthlyRecurringPriceDataItem returns a typed subscription item', async () => {
    const stripe = mockStripe()
    const item = await createMonthlyRecurringPriceDataItem(
      stripe as unknown as Stripe,
      'Managed Care',
      45,
      {
        description: 'Monthly support',
        metadata: { host_serial_number: 'NC-STUDIO-1' },
      },
    )

    expect(item.price_data).toMatchObject({
      currency: 'eur',
      product: 'prod_1',
      unit_amount: 4500,
      recurring: { interval: 'month' },
      nickname: 'Managed Care',
    })
  })

  it('createPhasedMonthlySubscription builds promo then list schedule', async () => {
    const stripe = mockStripe()

    const sub = await createPhasedMonthlySubscription(stripe as unknown as Stripe, 'cus_1', {
      productName: 'SecureVault Backup',
      promoAmountEur: 8,
      listAmountEur: 10,
      promoPhaseEndEpoch: 1_800_000_000,
      trialEnd: 1_700_000_000,
      metadata: { promo_ends_at: '2026-08-31' },
      collection_method: 'charge_automatically',
      default_payment_method: 'pm_1',
      days_until_due: 30,
      expand: ['latest_invoice'],
    })

    expect(stripe.subscriptionSchedules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        end_behavior: 'release',
        phases: [
          expect.objectContaining({
            items: [{ price: 'price_promo', quantity: 1 }],
            end_date: 1_800_000_000,
            trial_end: 1_700_000_000,
          }),
          expect.objectContaining({
            items: [{ price: 'price_list', quantity: 1 }],
          }),
        ],
        default_settings: expect.objectContaining({
          collection_method: 'charge_automatically',
          default_payment_method: 'pm_1',
          invoice_settings: { days_until_due: 30 },
        }),
        expand: ['subscription.latest_invoice'],
      }),
    )
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_from_schedule', {
      expand: ['latest_invoice'],
    })
    expect(sub).toEqual({ id: 'sub_from_schedule' })
  })

  it('createPhasedMonthlySubscription returns expanded subscription when schedule includes it', async () => {
    const expanded = { id: 'sub_expanded', latest_invoice: 'inv_1' }
    const stripe = mockStripe()
    stripe.subscriptionSchedules.create.mockResolvedValue({
      id: 'sched_1',
      subscription: expanded,
    })

    const sub = await createPhasedMonthlySubscription(stripe as unknown as Stripe, 'cus_1', {
      productName: 'Managed Care',
      promoAmountEur: 0,
      listAmountEur: 99,
      promoPhaseEndEpoch: 1_800_000_000,
    })

    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(sub).toBe(expanded)
  })
})
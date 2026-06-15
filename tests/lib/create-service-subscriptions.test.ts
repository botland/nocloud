import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import { createRecurringServiceSubscription } from '@/lib/create-service-subscriptions'
import type { ServiceInstance } from '@/lib/product-instances'
import {
  launchFreeUntilEpoch,
  promoPhaseEndEpoch,
  resolveServicePrice,
} from '@/lib/promotions'
import { PRICING_VERSION, SERVICE_PRICES_BY_TIER } from '@/lib/pricing'

function studioVaultService(overrides: Partial<ServiceInstance> = {}): ServiceInstance {
  const resolved = resolveServicePrice('secureVaultBackup', 'studio', new Date('2026-06-15T12:00:00.000Z'))
  return {
    key: 'secureVaultBackup',
    name: 'SecureVault Backup',
    price: resolved.net,
    listPrice: resolved.list,
    productLineId: `SecureVault-Backup@${PRICING_VERSION}`,
    hostSerialNumber: 'NC-STUDIO-ABCDEF1234',
    hostProductLineId: `Studio@${PRICING_VERSION}`,
    hostSlug: 'studio',
    hostName: 'Studio',
    promoEndsAt: resolved.promoEndsAt,
    promotionIds: resolved.promotionIds,
    ...overrides,
  }
}

describe('createRecurringServiceSubscription', () => {
  let stripe: any

  beforeEach(() => {
    stripe = {
      products: { create: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
      prices: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'price_promo' })
          .mockResolvedValueOnce({ id: 'price_list' }),
      },
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: 'sub_simple', latest_invoice: null }),
        retrieve: vi.fn().mockResolvedValue({ id: 'sub_from_schedule', latest_invoice: null }),
      },
      subscriptionSchedules: {
        create: vi.fn().mockResolvedValue({ id: 'sched_1', subscription: 'sub_from_schedule' }),
      },
    }
  })

  it('Managed Care launch: bills list price after complimentary trial', async () => {
    const resolved = resolveServicePrice('managedCare', 'studio', new Date('2026-06-15T12:00:00.000Z'))
    const service: ServiceInstance = {
      key: 'managedCare',
      name: 'Managed Care',
      price: resolved.net,
      listPrice: resolved.list,
      productLineId: `Managed-Care@${PRICING_VERSION}`,
      hostSerialNumber: 'NC-STUDIO-ABCDEF1234',
      hostProductLineId: `Studio@${PRICING_VERSION}`,
      hostSlug: 'studio',
      hostName: 'Studio',
      launchFreeUntil: resolved.launchFreeUntil,
    }

    await createRecurringServiceSubscription(stripe as Stripe, 'cus_1', service, {
      trial_end: 1_700_000_000,
    })

    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled()
    const subArg = stripe.subscriptions.create.mock.calls[0][0]
    expect(subArg.trial_end).toBe(launchFreeUntilEpoch('2027-01-01'))
    expect(subArg.items[0].price_data.unit_amount).toBe(SERVICE_PRICES_BY_TIER.studio.managedCare * 100)
    expect(subArg.metadata.launch_free_until).toBe('2027-01-01')
    expect(subArg.metadata.promo_ends_at).toBeUndefined()
  })

  it('tier promo: uses subscription schedule with promo then list phases', async () => {
    const service = studioVaultService()
    const orderTrialEnd = Math.floor(new Date('2026-06-15T12:00:00.000Z').getTime() / 1000) + 32 * 24 * 3600

    await createRecurringServiceSubscription(stripe as Stripe, 'cus_1', service, {
      trial_end: orderTrialEnd,
      metadata: { order_session: 'cs_test' },
    })

    expect(stripe.subscriptions.create).not.toHaveBeenCalled()
    expect(stripe.subscriptionSchedules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        end_behavior: 'release',
        phases: [
          expect.objectContaining({
            items: [{ price: 'price_promo', quantity: 1 }],
            end_date: promoPhaseEndEpoch('2026-08-31'),
            trial_end: orderTrialEnd,
          }),
          expect.objectContaining({
            items: [{ price: 'price_list', quantity: 1 }],
          }),
        ],
        metadata: expect.objectContaining({
          promo_ends_at: '2026-08-31',
          promo_price: String(service.price),
          list_price: String(service.listPrice),
          promotion_ids: 'studio-vault-2026',
          order_session: 'cs_test',
        }),
      }),
    )

    expect(stripe.prices.create).toHaveBeenCalledTimes(2)
    const promoCall = stripe.prices.create.mock.calls[0][0]
    const listCall = stripe.prices.create.mock.calls[1][0]
    expect(promoCall.unit_amount).toBe(service.price * 100)
    expect(listCall.unit_amount).toBe(service.listPrice * 100)
  })

  it('tier promo expired before billing starts: bills list price only', async () => {
    const service = studioVaultService()
    const trialAfterPromo = promoPhaseEndEpoch('2026-08-31') + 1

    await createRecurringServiceSubscription(stripe as Stripe, 'cus_1', service, {
      trial_end: trialAfterPromo,
    })

    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled()
    const subArg = stripe.subscriptions.create.mock.calls[0][0]
    expect(subArg.items[0].price_data.unit_amount).toBe(service.listPrice * 100)
    expect(subArg.trial_end).toBe(trialAfterPromo)
  })
})
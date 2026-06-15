import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import {
  createRecurringServiceSubscription,
  createFullServiceSubscriptions,
  servicesFromOrderMetadata,
} from '@/lib/create-service-subscriptions'
import type { ServiceInstance } from '@/lib/product-instances'
import { compactServicesForMetadata } from '@/lib/product-instances'
import {
  launchFreeUntilEpoch,
  promoPhaseEndEpoch,
  resolveServicePrice,
} from '@/lib/promotions'
import { PRICING_VERSION, SERVICE_PRICES_BY_TIER } from '@/lib/pricing'

vi.mock('@/lib/stripe-pm', () => ({
  extractPaymentMethodFromSession: vi.fn(),
  setDefaultPaymentMethodOnCustomerAndSubs: vi.fn(),
}))

import {
  extractPaymentMethodFromSession,
  setDefaultPaymentMethodOnCustomerAndSubs,
} from '@/lib/stripe-pm'

function stableVaultService(overrides: Partial<ServiceInstance> = {}): ServiceInstance {
  return studioVaultService({
    price: SERVICE_PRICES_BY_TIER.studio.secureVaultBackup,
    listPrice: SERVICE_PRICES_BY_TIER.studio.secureVaultBackup,
    promoEndsAt: undefined,
    promotionIds: undefined,
    ...overrides,
  })
}

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
    vi.mocked(extractPaymentMethodFromSession).mockReset()
    vi.mocked(setDefaultPaymentMethodOnCustomerAndSubs).mockReset()
    vi.mocked(extractPaymentMethodFromSession).mockResolvedValue(undefined)
    vi.mocked(setDefaultPaymentMethodOnCustomerAndSubs).mockResolvedValue(undefined)

    stripe = {
      products: { create: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
      prices: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'price_promo' })
          .mockResolvedValueOnce({ id: 'price_list' }),
      },
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: 'sub_simple', latest_invoice: 'inv_1' }),
        list: vi.fn().mockResolvedValue({ data: [] }),
        update: vi.fn().mockResolvedValue({ id: 'sub_simple' }),
        retrieve: vi.fn().mockResolvedValue({ id: 'sub_from_schedule', latest_invoice: null }),
      },
      subscriptionSchedules: {
        create: vi.fn().mockResolvedValue({ id: 'sched_1', subscription: 'sub_from_schedule' }),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue({ id: 'inv_1', status: 'paid', paid: true, amount_paid: 9900 }),
      },
      customers: {
        update: vi.fn().mockResolvedValue({ id: 'cus_1' }),
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

  it('stable recurring service bills current price without schedule', async () => {
    const service = studioVaultService({
      price: SERVICE_PRICES_BY_TIER.studio.secureVaultBackup,
      listPrice: SERVICE_PRICES_BY_TIER.studio.secureVaultBackup,
      promoEndsAt: undefined,
      promotionIds: undefined,
    })

    await createRecurringServiceSubscription(stripe as Stripe, 'cus_1', service)

    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled()
    const subArg = stripe.subscriptions.create.mock.calls[0][0]
    expect(subArg.items[0].price_data.unit_amount).toBe(service.price * 100)
  })

  it('applies grossUnit to billed amounts', async () => {
    const service = stableVaultService()

    await createRecurringServiceSubscription(stripe as Stripe, 'cus_1', service, {
      grossUnit: (net) => net * 1.2,
    })

    const subArg = stripe.subscriptions.create.mock.calls[0][0]
    expect(subArg.items[0].price_data.unit_amount).toBe(
      Math.round(service.price * 1.2 * 100),
    )
  })
})

describe('servicesFromOrderMetadata', () => {
  it('parses compact services metadata', () => {
    const service = studioVaultService()
    const json = JSON.stringify(compactServicesForMetadata([service]))
    const parsed = servicesFromOrderMetadata(json, PRICING_VERSION)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].key).toBe('secureVaultBackup')
  })

  it('returns empty array for missing or invalid metadata', () => {
    expect(servicesFromOrderMetadata(undefined, PRICING_VERSION)).toEqual([])
    expect(servicesFromOrderMetadata('{bad json', PRICING_VERSION)).toEqual([])
  })
})

describe('createFullServiceSubscriptions', () => {
  let stripe: any

  beforeEach(() => {
    vi.mocked(extractPaymentMethodFromSession).mockReset()
    vi.mocked(setDefaultPaymentMethodOnCustomerAndSubs).mockReset()
    vi.mocked(extractPaymentMethodFromSession).mockResolvedValue('pm_card_123')
    vi.mocked(setDefaultPaymentMethodOnCustomerAndSubs).mockResolvedValue(undefined)

    stripe = {
      products: { create: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
      prices: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'price_promo' })
          .mockResolvedValueOnce({ id: 'price_list' }),
      },
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: 'sub_new', latest_invoice: 'inv_1' }),
        list: vi.fn().mockResolvedValue({ data: [] }),
        update: vi.fn().mockResolvedValue({ id: 'sub_new' }),
        retrieve: vi.fn().mockResolvedValue({ id: 'sub_from_schedule', latest_invoice: null }),
      },
      subscriptionSchedules: {
        create: vi.fn().mockResolvedValue({ id: 'sched_1', subscription: 'sub_from_schedule' }),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue({ id: 'inv_1', status: 'paid', paid: true, amount_paid: 0 }),
      },
      customers: {
        update: vi.fn().mockResolvedValue({ id: 'cus_1' }),
      },
    }
  })

  const session = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'cs_test_123',
      customer: 'cus_1',
      metadata: {
        pricing_version: PRICING_VERSION,
        order_placed_at: String(Math.floor(new Date('2026-06-15T12:00:00.000Z').getTime() / 1000)),
        ...overrides,
      },
    }) as unknown as Stripe.Checkout.Session

  it('skips when customer or services are missing', async () => {
    await createFullServiceSubscriptions(stripe, { id: 'cs_x', customer: null } as any, [])
    await createFullServiceSubscriptions(stripe, session(), [])
    expect(stripe.subscriptions.create).not.toHaveBeenCalled()
  })

  it('skips creation when subs already exist for the order session', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [{ metadata: { order_session: 'cs_test_123', service: 'managedCare' } }],
    })

    await createFullServiceSubscriptions(stripe, session(), [stableVaultService()])

    expect(stripe.subscriptions.create).not.toHaveBeenCalled()
  })

  it('attaches PM to pre-created hybrid service subs and returns early', async () => {
    await createFullServiceSubscriptions(
      stripe,
      session({ service_subscription_ids: JSON.stringify(['sub_pre_1', 'sub_pre_2']) }),
      [stableVaultService()],
    )

    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(2)
    expect(stripe.subscriptions.create).not.toHaveBeenCalled()
    expect(setDefaultPaymentMethodOnCustomerAndSubs).toHaveBeenCalledWith(
      stripe,
      'cus_1',
      'pm_card_123',
    )
  })

  it('creates service subs with PM and default_incomplete fallback', async () => {
    vi.mocked(extractPaymentMethodFromSession).mockResolvedValue(undefined)

    await createFullServiceSubscriptions(stripe, session(), [stableVaultService()])

    expect(stripe.subscriptions.create).toHaveBeenCalled()
    const subArg = stripe.subscriptions.create.mock.calls[0][0]
    expect(subArg.payment_behavior).toBe('default_incomplete')
    expect(subArg.default_payment_method).toBeUndefined()
  })

  it('retries once when Stripe reports missing default payment method', async () => {
    stripe.subscriptions.create
      .mockRejectedValueOnce(new Error('Customer has no attached payment source'))
      .mockResolvedValueOnce({ id: 'sub_retry', latest_invoice: null })

    await createFullServiceSubscriptions(stripe, session(), [stableVaultService()])

    expect(stripe.customers.update).toHaveBeenCalled()
    expect(stripe.subscriptions.create).toHaveBeenCalledTimes(2)
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_retry', {
      default_payment_method: 'pm_card_123',
    })
  })
})
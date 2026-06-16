import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import {
  extractPaymentMethodFromSession,
  setDefaultPaymentMethodOnCustomerAndSubs,
} from '@/lib/stripe-pm'

describe('lib/stripe-pm', () => {
  let stripe: any

  beforeEach(() => {
    stripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn(),
        },
      },
      paymentIntents: {
        retrieve: vi.fn(),
      },
      setupIntents: {
        retrieve: vi.fn(),
      },
      customers: {
        listPaymentMethods: vi.fn(),
        update: vi.fn(),
      },
      subscriptions: {
        update: vi.fn(),
      },
    }
  })

  it('returns payment_method directly on session when present', async () => {
    const pm = await extractPaymentMethodFromSession(stripe as Stripe, {
      id: 'cs_1',
      payment_method: 'pm_direct',
    } as Stripe.Checkout.Session)
    expect(pm).toBe('pm_direct')
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
  })

  it('extracts PM from expanded payment_intent', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_1',
      customer: 'cus_1',
      payment_intent: {
        id: 'pi_1',
        object: 'payment_intent',
        client_secret: 'pi_secret',
        payment_method: { id: 'pm_from_pi' },
      },
    })
    stripe.paymentIntents.retrieve.mockResolvedValue({
      payment_method: { id: 'pm_from_pi' },
    })

    const pm = await extractPaymentMethodFromSession(stripe as Stripe, {
      id: 'cs_1',
      customer: 'cus_1',
      payment_intent: 'pi_1',
    } as Stripe.Checkout.Session)

    expect(pm).toBe('pm_from_pi')
  })

  it('extracts PM from setup_intent for hybrid flows', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_1',
      customer: 'cus_1',
      setup_intent: 'seti_1',
    })
    stripe.setupIntents.retrieve.mockResolvedValue({
      payment_method: 'pm_from_si',
    })

    const pm = await extractPaymentMethodFromSession(stripe as Stripe, {
      id: 'cs_1',
      customer: 'cus_1',
      setup_intent: 'seti_1',
    } as Stripe.Checkout.Session)

    expect(pm).toBe('pm_from_si')
    expect(stripe.setupIntents.retrieve).toHaveBeenCalledWith('seti_1', {
      expand: ['payment_method'],
    })
  })

  it('falls back to listing recent customer payment methods', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_1',
      customer: 'cus_1',
      payment_intent: 'pi_1',
    })
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error('no pi'))
    stripe.customers.listPaymentMethods.mockResolvedValue({
      data: [{ id: 'pm_listed', type: 'card' }],
    })

    const pm = await extractPaymentMethodFromSession(stripe as Stripe, {
      id: 'cs_1',
      customer: 'cus_1',
      payment_intent: 'pi_1',
    } as Stripe.Checkout.Session)

    expect(pm).toBe('pm_listed')
    warnSpy.mockRestore()
  })

  it('setDefaultPaymentMethodOnCustomerAndSubs updates customer and subscriptions', async () => {
    await setDefaultPaymentMethodOnCustomerAndSubs(stripe as Stripe, 'cus_1', 'pm_1', [
      'sub_a',
      'sub_b',
    ])

    expect(stripe.customers.update).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_1' },
    })
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(2)
  })

  it('setDefaultPaymentMethodOnCustomerAndSubs no-ops without ids', async () => {
    await setDefaultPaymentMethodOnCustomerAndSubs(stripe as Stripe, '', 'pm_1')
    expect(stripe.customers.update).not.toHaveBeenCalled()
  })
})
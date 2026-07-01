import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import {
  dunningElapsedDays,
  getRecurringDunningConfig,
  isServiceSubscription,
  processSubscriptionDunning,
} from '@/lib/recurring-dunning'

vi.mock('@/lib/stripe-billing-portal', () => ({
  createPaymentMethodUpdateUrl: vi.fn().mockResolvedValue('https://billing.stripe.com/session/test'),
}))

vi.mock('@/lib/emails', () => ({
  sendRecurringPaymentWarningEmail: vi.fn(),
  sendRecurringPaymentCancelledEmail: vi.fn(),
  sendAdminRecurringPaymentCancelledEmail: vi.fn(),
}))

describe('lib/recurring-dunning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RECURRING_PM_FAILURE_WARN_DAYS = '7'
    process.env.RECURRING_PM_FAILURE_CANCEL_DAYS = '14'
  })

  it('isServiceSubscription matches line_type recurring_service', () => {
    expect(isServiceSubscription({ metadata: { line_type: 'recurring_service' } } as Stripe.Subscription)).toBe(true)
    expect(isServiceSubscription({ metadata: { host_serial_number: 'NC-X' } } as Stripe.Subscription)).toBe(true)
    expect(isServiceSubscription({ metadata: { financing: 'full' } } as Stripe.Subscription)).toBe(false)
  })

  it('getRecurringDunningConfig reads env defaults', () => {
    expect(getRecurringDunningConfig()).toEqual({ warnDays: 7, cancelDays: 14 })
  })

  it('dunningElapsedDays computes whole days', () => {
    const first = 1_000_000
    expect(dunningElapsedDays(first, first + 7 * 86400)).toBe(7)
  })

  it('processSubscriptionDunning warns at WARN_DAYS', async () => {
    const now = Math.floor(Date.now() / 1000)
    const sub = {
      id: 'sub_warn',
      customer: 'cus_1',
      metadata: {
        first_payment_failed_at: String(now - 8 * 86400),
        dunning_stage: 'failed',
        service: 'Managed Care',
        host_serial_number: 'NC-STUDIO-ABC',
        customer_email: 'buyer@example.com',
        locale: 'en',
      },
    } as Stripe.Subscription

    const stripe = {
      subscriptions: {
        update: vi.fn().mockResolvedValue(sub),
        cancel: vi.fn(),
      },
      customers: { retrieve: vi.fn() },
    } as unknown as Stripe

    const result = await processSubscriptionDunning(stripe, sub, { nowUnix: now })
    expect(result).toBe('warned')
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_warn', {
      metadata: { dunning_stage: 'warned' },
    })
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('processSubscriptionDunning cancels at CANCEL_DAYS', async () => {
    const now = Math.floor(Date.now() / 1000)
    const sub = {
      id: 'sub_cancel',
      customer: 'cus_1',
      metadata: {
        first_payment_failed_at: String(now - 15 * 86400),
        dunning_stage: 'warned',
        service: 'Managed Care',
        customer_email: 'buyer@example.com',
      },
    } as Stripe.Subscription

    const stripe = {
      subscriptions: {
        update: vi.fn().mockResolvedValue(sub),
        cancel: vi.fn().mockResolvedValue({}),
      },
      customers: { retrieve: vi.fn() },
    } as unknown as Stripe

    const result = await processSubscriptionDunning(stripe, sub, { nowUnix: now })
    expect(result).toBe('cancelled')
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_cancel')
  })
})
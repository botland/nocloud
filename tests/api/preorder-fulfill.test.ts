import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/preorder/fulfill/route'

const emailMocks = vi.hoisted(() => ({
  sendBalancePaymentRequiredEmail: vi.fn(),
  sendAdminOrderNotificationEmail: vi.fn(),
}))

let stripeMocks: any

vi.mock('stripe', () => ({
  default: vi.fn(() => stripeMocks),
}))

vi.mock('@/lib/stripe-pm', () => ({
  extractPaymentMethodFromSession: vi.fn(),
}))

vi.mock('@/lib/emails', () => emailMocks)

import { extractPaymentMethodFromSession } from '@/lib/stripe-pm'

function fulfillPost(body: object, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('http://localhost:8080/api/preorder/fulfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-admin-key',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function paidPreorderSession(overrides: Record<string, any> = {}) {
  return {
    id: 'cs_deposit',
    payment_status: 'paid',
    customer: 'cus_1',
    customer_details: { email: 'buyer@example.com' },
    metadata: {
      order_type: 'preorder',
      preorder_status: 'deposit_paid',
      quoted_balance_due: '1000',
      quoted_hardware_total: '1500',
      company_name: 'Acme',
      vat_number: 'FR123',
      po_number: 'PO-1',
      pricing_version: 'test-v',
      locale: 'en',
      hardware: JSON.stringify([
        { name: 'Studio', config: 'Standard', serialNumber: 'NC-STUDIO-ABC123' },
      ]),
      services: '[]',
      ...overrides,
    },
  }
}

describe('api/preorder/fulfill', () => {
  const originalAdmin = process.env.ADMIN_API_KEY
  const originalStripe = process.env.STRIPE_SECRET_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_API_KEY = 'test-admin-key'
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.ADMIN_EMAIL = 'admin@example.com'

    stripeMocks = {
      checkout: {
        sessions: {
          retrieve: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
      },
      paymentIntents: { create: vi.fn() },
      invoices: {
        create: vi.fn().mockResolvedValue({ id: 'in_balance' }),
        finalizeInvoice: vi.fn().mockResolvedValue({}),
        retrieve: vi.fn().mockResolvedValue({
          id: 'in_balance',
          hosted_invoice_url: 'https://invoice.stripe.com/test',
        }),
      },
      invoiceItems: { create: vi.fn().mockResolvedValue({}) },
    }

    ;(extractPaymentMethodFromSession as any).mockResolvedValue('pm_card_123')
  })

  afterEach(() => {
    process.env.ADMIN_API_KEY = originalAdmin
    process.env.STRIPE_SECRET_KEY = originalStripe
  })

  it('returns 401 without admin key', async () => {
    const res = await fulfillPost({ depositSessionId: 'cs_x' }, { Authorization: 'Bearer wrong' })
    expect(res.status).toBe(401)
  })

  it('returns alreadyFulfilled when balance paid', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue(
      paidPreorderSession({ preorder_status: 'balance_paid' }),
    )
    const res = await fulfillPost({ depositSessionId: 'cs_deposit' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyFulfilled: true })
  })

  it('charge success returns payment intent', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue(paidPreorderSession())
    stripeMocks.paymentIntents.create.mockResolvedValue({ id: 'pi_balance', status: 'succeeded' })

    const res = await fulfillPost({ depositSessionId: 'cs_deposit', action: 'charge' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, method: 'charge', paymentIntentId: 'pi_balance' })
    expect(stripeMocks.checkout.sessions.update).toHaveBeenCalledWith('cs_deposit', {
      metadata: expect.objectContaining({ preorder_status: 'balance_charge_pending' }),
    })
  })

  it('charge failure auto-invoices and emails customer+admin with S/N', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue(paidPreorderSession())
    stripeMocks.paymentIntents.create.mockRejectedValue({
      code: 'card_declined',
      message: 'Your card was declined.',
    })

    const res = await fulfillPost({ depositSessionId: 'cs_deposit', action: 'charge' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      method: 'invoice',
      fallback: true,
      invoiceId: 'in_balance',
    })

    expect(stripeMocks.invoices.create).toHaveBeenCalled()
    expect(emailMocks.sendBalancePaymentRequiredEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        hardwareStr: expect.stringContaining('NC-STUDIO-ABC123'),
      }),
    )
    expect(emailMocks.sendAdminOrderNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentAction: 'charge_failed_fallback_to_invoice' }),
    )
    expect(stripeMocks.checkout.sessions.update).toHaveBeenCalledWith('cs_deposit', {
      metadata: expect.objectContaining({ preorder_status: 'balance_invoice_sent' }),
    })
  })

  it('action=invoice creates invoice without charge attempt', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue(paidPreorderSession())

    const res = await fulfillPost({ depositSessionId: 'cs_deposit', action: 'invoice' })
    expect(res.status).toBe(200)
    expect(stripeMocks.paymentIntents.create).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ method: 'invoice', invoiceId: 'in_balance' })
  })
})
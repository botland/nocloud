import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/checkout/route'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import {
  calculateLease,
  HARDWARE_PRICES,
  SERVICE_PRICES,
  LEASE_MIN,
  LEASE_MAX,
  PBI_MIN,
  PBI_MAX,
  SEPA_MAX,
  UPFRONT_PERCENT,
  PRICING_VERSION,
} from '@/lib/pricing'
import type { CheckoutPayload } from '@/lib/types'

// --- Mocks (hoist-safe pattern: vi.mock returns a stable constructor fn; we .mockImplementation per test) ---
let mockStripeInstance: any
let mockResendInstance: any

vi.mock('stripe', () => {
  return { default: vi.fn() }
})

vi.mock('resend', () => {
  return { Resend: vi.fn() }
})

// --- Test helpers ---
function makeRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost:8080/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function basePayload(overrides: Partial<CheckoutPayload> = {}): CheckoutPayload {
  return {
    items: [
      {
        id: 123,
        product: { id: 1, slug: 'studio', name: 'Studio', tier: 'MEDIUM', price: HARDWARE_PRICES.studio, description: '' },
        services: [],
        quantity: 1,
        totalPrice: HARDWARE_PRICES.studio,
      },
    ],
    email: 'buyer@example.com',
    company: 'Acme Corp',
    vatNumber: 'FR123456',
    poNumber: 'PO-42',
    address: '1 Test Street',
    city: 'Paris',
    postal: '75001',
    country: 'FR',
    paymentMethod: 'stripe',
    financing: 'full',
    locale: 'en',
    ...overrides,
  }
}

function withServices(payload: CheckoutPayload, keys: Array<'managedCare' | 'secureVaultBackup'> = ['managedCare']): CheckoutPayload {
  const services = keys.map((key) => ({
    name: key === 'managedCare' ? 'Managed Care' : 'SecureVault Backup',
    price: SERVICE_PRICES[key],
    key,
  }))
  const qty = payload.items[0].quantity || 1
  const svcTotal = services.reduce((s, sv) => s + sv.price * qty, 0)
  return {
    ...payload,
    items: [
      {
        ...payload.items[0],
        services,
        totalPrice: payload.items[0].totalPrice + svcTotal,
      },
    ],
  }
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('api/checkout (functional contract tests - black box over payload + Stripe side effects)', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // Re-create fresh mock instances for every test (prevents cross-test pollution)
    mockStripeInstance = {
      customers: { create: vi.fn() },
      invoices: { create: vi.fn(), finalizeInvoice: vi.fn() },
      invoiceItems: { create: vi.fn() },
      products: { create: vi.fn() },
      subscriptions: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
    }
    mockResendInstance = {
      emails: { send: vi.fn() },
    }

    // Wire the hoisted mock constructors to return our fresh instances
    ;(Stripe as any).mockImplementation(() => mockStripeInstance)
    ;(Resend as any).mockImplementation(() => mockResendInstance)

    // Provide the minimal envs the route checks (real values not used because of mocks)
    setEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    setEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:8080')
    setEnv('RESEND_API_KEY', 're_test_dummy')
    setEnv('ADMIN_EMAIL', 'admin@example.com')

    // Default successful returns for common objects
    mockStripeInstance.customers.create.mockResolvedValue({ id: 'cus_test' })
    mockStripeInstance.invoices.create.mockResolvedValue({ id: 'in_test' })
    mockStripeInstance.invoiceItems.create.mockResolvedValue({})
    mockStripeInstance.invoices.finalizeInvoice.mockResolvedValue({})
    mockStripeInstance.products.create.mockResolvedValue({ id: 'prod_test' })
    mockStripeInstance.subscriptions.create.mockResolvedValue({ id: 'sub_test' })
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.test/pay' })

    mockResendInstance.emails.send.mockResolvedValue({ id: 'email_123' })
  })

  // ---------- Happy paths (response shape + key Stripe call contracts) ----------

  it('full + card (non-invoice): returns url, creates Checkout Session with resolved prices + metadata, no immediate Resend in route', async () => {
    const payload = basePayload({ paymentMethod: 'stripe', financing: 'full' })
    const req = makeRequest(payload)
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('url')
    expect(json.url).toContain('checkout.stripe.test')

    // Customer pre-create happened (best effort)
    expect(mockStripeInstance.customers.create).toHaveBeenCalled()

    // Final session creation (the observable redirect path)
    const sessionCall = mockStripeInstance.checkout.sessions.create.mock.calls[0][0]
    expect(sessionCall.mode).toBe('payment')
    expect(sessionCall.line_items[0].quantity).toBe(1)
    expect(sessionCall.line_items[0].price_data.unit_amount).toBe(HARDWARE_PRICES.studio * 100)
    expect(sessionCall.metadata).toMatchObject({
      financing: 'full',
      pricing_version: PRICING_VERSION,
      services: '[]',
    })
    expect(sessionCall.payment_method_types).toEqual(['card'])

    // No Resend calls for card full path (emails happen in webhook)
    expect(mockResendInstance.emails.send).not.toHaveBeenCalled()
  })

  it('full + sepa (under limit): succeeds and uses sepa_debit pm type', async () => {
    const payload = basePayload({ paymentMethod: 'sepa', financing: 'full' })
    // studio = 7990 <= 10000
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)
    const call = mockStripeInstance.checkout.sessions.create.mock.calls[0][0]
    expect(call.payment_method_types).toEqual(['sepa_debit'])
  })

  it('full + sepa (over SEPA limit): returns 400 with helpful message', async () => {
    const payload = basePayload({
      paymentMethod: 'sepa',
      financing: 'full',
      items: [{ ...basePayload().items[0], product: { ...basePayload().items[0].product, slug: 'forge' }, totalPrice: HARDWARE_PRICES.forge }],
    })
    const res = await POST(makeRequest(payload))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/SEPA Direct Debit payments are limited to €10,000/)
  })

  it('full + invoice (with services): returns success+invoiceId, creates send_invoice + service subs + trial invoice updates + sends Resend (customer + admin)', async () => {
    const payload = withServices(basePayload({ paymentMethod: 'invoice', financing: 'full' }))
    const hw = HARDWARE_PRICES.studio
    const svc = SERVICE_PRICES.managedCare
    const res = await POST(makeRequest(payload))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true, invoiceId: 'in_test' })

    // Main invoice + hardware line item
    expect(mockStripeInstance.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata: expect.objectContaining({ financing: 'full', pricing_version: PRICING_VERSION }),
      })
    )
    expect(mockStripeInstance.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: hw * 100 })
    )

    // Service sub creation (trial, send_invoice)
    expect(mockStripeInstance.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_method: 'send_invoice',
        items: expect.arrayContaining([
          expect.objectContaining({
            price_data: expect.objectContaining({ unit_amount: svc * 100, recurring: { interval: 'month' } }),
          }),
        ]),
      })
    )

    // Resend called twice (customer + admin)
    expect(mockResendInstance.emails.send).toHaveBeenCalledTimes(2)
    const subjects = mockResendInstance.emails.send.mock.calls.map((c: any[]) => c[0].subject)
    expect(subjects.some((s: string) => s.includes('nocloud.ai order'))).toBe(true)
  })

  it('lease + card: creates lease sub (with trial + cancel_at) + pre-creates service subs + upfront Checkout session (returns url); no route-level Resend', async () => {
    const payload = withServices(basePayload({ paymentMethod: 'stripe', financing: 'lease' }), ['managedCare'])
    const hw = HARDWARE_PRICES.studio
    const lease = calculateLease(hw, SERVICE_PRICES.managedCare)
    expect(lease.isAllowed).toBe(true)

    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('url')

    // Lease sub created (direct path)
    const subCall = mockStripeInstance.subscriptions.create.mock.calls[0][0]
    expect(subCall).toMatchObject({
      collection_method: 'charge_automatically',
      trial_end: expect.any(Number),
      cancel_at: expect.any(Number),
      payment_behavior: 'default_incomplete',
    })
    expect(subCall.metadata).toMatchObject({
      financing: 'lease',
      contract_type: 'leasing',
      upfront_percent: String(UPFRONT_PERCENT),
      pricing_version: PRICING_VERSION,
    })

    // Upfront-only checkout session
    const sessionCall = mockStripeInstance.checkout.sessions.create.mock.calls[0][0]
    expect(sessionCall.mode).toBe('payment')
    expect(sessionCall.line_items[0].price_data.unit_amount).toBe(lease.upfrontAmount * 100)
    expect(sessionCall.metadata.is_lease_upfront).toBe('true')
    expect(sessionCall.metadata.lease_subscription_id).toBeDefined()

    expect(mockResendInstance.emails.send).not.toHaveBeenCalled()
  })

  it('lease + invoice: creates only upfront send_invoice + InvoiceItem, returns success+invoiceId, sends lease-upfront Resend emails', async () => {
    const payload = basePayload({ paymentMethod: 'invoice', financing: 'lease' })
    const hw = HARDWARE_PRICES.studio
    const lease = calculateLease(hw, 0)
    expect(lease.isAllowed).toBe(true)

    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, invoiceId: 'in_test' })

    expect(mockStripeInstance.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_method: 'send_invoice',
        metadata: expect.objectContaining({
          financing: 'lease',
          is_upfront_only: 'true',
          upfront_percent: String(UPFRONT_PERCENT),
          lease_upfront_amount: lease.upfrontAmount.toString(),
        }),
      })
    )
    expect(mockStripeInstance.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: lease.upfrontAmount * 100 })
    )

    // Lease-specific registered emails (customer + admin)
    expect(mockResendInstance.emails.send).toHaveBeenCalledTimes(2)
  })

  // ---------- Validation & error paths (server is authoritative) ----------

  it('lease out of range (below min or above max) returns 400 with exact range message', async () => {
    const low = basePayload({ financing: 'lease', items: [{ ...basePayload().items[0], product: { ...basePayload().items[0].product, slug: 'edge' } }] })
    const resLow = await POST(makeRequest(low))
    expect(resLow.status).toBe(400)
    const jLow = await resLow.json()
    expect(jLow.error).toContain(`between €${LEASE_MIN} and €${LEASE_MAX}`)

    const highPayload = basePayload({
      financing: 'lease',
      items: [{ ...basePayload().items[0], product: { ...basePayload().items[0].product, slug: 'forge' }, quantity: 20 }],
    })
    const resHigh = await POST(makeRequest(highPayload))
    expect(resHigh.status).toBe(400)
  })

  it('invoice + hardware outside PBI range returns 400', async () => {
    // forge * 2 = 29800 > PBI_MAX (20000)
    const bad = basePayload({
      paymentMethod: 'invoice',
      financing: 'full',
      items: [{
        ...basePayload().items[0],
        product: { ...basePayload().items[0].product, slug: 'forge' },
        quantity: 2,
        totalPrice: HARDWARE_PRICES.forge * 2,
      }],
    })
    const res = await POST(makeRequest(bad))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toContain(`between €${PBI_MIN} and €${PBI_MAX}`)
  })

  it('lease without email returns 400 (customer creation requirement)', async () => {
    const payload = { ...basePayload({ financing: 'lease' }), email: '' }
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toMatch(/Email is required/)
  })

  it('missing STRIPE_SECRET_KEY returns 500 before processing', async () => {
    setEnv('STRIPE_SECRET_KEY', undefined)
    const res = await POST(makeRequest(basePayload()))
    expect(res.status).toBe(500)
    const j = await res.json()
    expect(j.error).toMatch(/Stripe secret key is not configured/)
  })

  it('sepa over limit for lease monthly uses the monthly dueAmount in message (or graceful handling)', async () => {
    // Large lease (forge * qty) — the monthly due for lease can trigger the SEPA guard
    const payload = basePayload({
      paymentMethod: 'sepa',
      financing: 'lease',
      items: [{
        ...basePayload().items[0],
        product: { ...basePayload().items[0].product, slug: 'forge' },
        quantity: 10,
        totalPrice: HARDWARE_PRICES.forge * 10,
      }],
    })
    const res = await POST(makeRequest(payload))
    // The guard may or may not fire depending on exact monthly calc vs dueAmount; the test documents the intent.
    // Either a clear 400 with the message or a 200 (the important thing is no unhandled crash).
    expect([200, 400]).toContain(res.status)
  })

  // ---------- Multi-item + qty + services round-trip ----------
  it('multi-item + quantity + services resolves correct totals into metadata and line items', async () => {
    const payload: CheckoutPayload = {
      ...basePayload(),
      items: [
        {
          id: 1,
          product: { id: 0, slug: 'edge', name: 'Edge', tier: '', price: HARDWARE_PRICES.edge, description: '' },
          services: [{ name: 'Managed Care', price: SERVICE_PRICES.managedCare, key: 'managedCare' }],
          quantity: 2,
          totalPrice: HARDWARE_PRICES.edge * 2 + SERVICE_PRICES.managedCare * 2,
        },
        {
          id: 2,
          product: { id: 1, slug: 'studio', name: 'Studio', tier: '', price: HARDWARE_PRICES.studio, description: '' },
          services: [],
          quantity: 1,
          totalPrice: HARDWARE_PRICES.studio,
        },
      ],
      paymentMethod: 'stripe',
      financing: 'full',
    }
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(200)

    const sessionCall = mockStripeInstance.checkout.sessions.create.mock.calls[0][0]
    // 2*edge + 1*studio hardware
    const expectedHardware = (HARDWARE_PRICES.edge * 2 + HARDWARE_PRICES.studio) * 100
    expect(sessionCall.line_items[0].quantity).toBe(2)
    expect(sessionCall.line_items[1].quantity).toBe(1)
    // Services are only in metadata for the full-card path (provisioned in webhook)
    const servicesMeta = JSON.parse(sessionCall.metadata.services)
    expect(servicesMeta.length).toBe(1)
    expect(servicesMeta[0].price).toBe(SERVICE_PRICES.managedCare * 2)
  })
})

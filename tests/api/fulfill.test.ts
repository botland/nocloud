import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/fulfill/route'

const mocks = vi.hoisted(() => ({
  createFullServiceSubscriptions: vi.fn(),
}))

let stripeMocks: { checkout: { sessions: { retrieve: ReturnType<typeof vi.fn> } } }

vi.mock('stripe', () => ({
  default: vi.fn(() => stripeMocks),
}))

vi.mock('@/lib/create-service-subscriptions', () => ({
  createFullServiceSubscriptions: mocks.createFullServiceSubscriptions,
}))

function fulfillRequest(sessionId?: string) {
  const url = sessionId
    ? `http://localhost:8080/api/fulfill?session_id=${sessionId}`
    : 'http://localhost:8080/api/fulfill'
  return GET(new NextRequest(url))
}

describe('api/fulfill', () => {
  const originalKey = process.env.STRIPE_SECRET_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    stripeMocks = {
      checkout: { sessions: { retrieve: vi.fn() } },
    }
  })

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalKey
  })

  it('returns 400 when session_id is missing', async () => {
    const res = await fulfillRequest()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'session_id required' })
  })

  it('returns 500 when Stripe is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await fulfillRequest('cs_test')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Stripe not configured' })
  })

  it('creates service subs for full orders with services', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test',
      customer: 'cus_1',
      metadata: {
        financing: 'full',
        services: '[{"n":"Managed Care","p":99}]',
        pricing_version: 'test-v',
      },
    })

    const res = await fulfillRequest('cs_test')
    expect(res.status).toBe(200)
    expect(mocks.createFullServiceSubscriptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'cs_test' }),
      '[{"n":"Managed Care","p":99}]',
      'test-v',
    )
    expect(await res.json()).toMatchObject({ success: true })
  })

  it('skips service sub creation for pre-order deposit sessions', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_preorder',
      customer: 'cus_1',
      metadata: {
        order_type: 'preorder',
        financing: 'full',
        services: '[{"n":"Managed Care","p":0}]',
      },
    })

    const res = await fulfillRequest('cs_preorder')
    expect(mocks.createFullServiceSubscriptions).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ message: 'No service subs needed for this order' })
  })

  it('skips service sub creation for lease orders', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_lease',
      customer: 'cus_1',
      metadata: { financing: 'lease', services: '[{"n":"X","p":1}]' },
    })

    const res = await fulfillRequest('cs_lease')
    expect(mocks.createFullServiceSubscriptions).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ message: 'No service subs needed for this order' })
  })

  it('skips when services metadata is empty', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_hw',
      customer: 'cus_1',
      metadata: { financing: 'full', services: '[]' },
    })

    const res = await fulfillRequest('cs_hw')
    expect(mocks.createFullServiceSubscriptions).not.toHaveBeenCalled()
  })

  it('returns 500 when Stripe retrieve fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeMocks.checkout.sessions.retrieve.mockRejectedValue(new Error('stripe down'))

    const res = await fulfillRequest('cs_fail')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'stripe down' })
    errorSpy.mockRestore()
  })
})
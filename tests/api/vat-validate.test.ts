import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/vat/validate/route'

const mocks = vi.hoisted(() => ({
  validateVatWithVies: vi.fn(),
}))

vi.mock('@/lib/vies', () => ({
  validateVatWithVies: mocks.validateVatWithVies,
}))

function postValidate(body: unknown) {
  return POST(
    new NextRequest('http://localhost:8080/api/vat/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('api/vat/validate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 400 when VAT number is missing', async () => {
    const res = await postValidate({ country: 'FR' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ valid: false, reason: 'No VAT number provided' })
    expect(mocks.validateVatWithVies).not.toHaveBeenCalled()
  })

  it('returns 503 when VIES is unavailable', async () => {
    mocks.validateVatWithVies.mockResolvedValue({
      isValid: false,
      unavailable: true,
      reason: 'VIES service is temporarily unavailable',
    })

    const res = await postValidate({ vatNumber: 'DE123456789', country: 'DE' })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ valid: false, unavailable: true })
  })

  it('returns valid result from VIES', async () => {
    mocks.validateVatWithVies.mockResolvedValue({
      isValid: true,
      name: 'ACME GMBH',
      address: 'Berlin',
      reason: 'VAT number verified via VIES',
    })

    const res = await postValidate({ vatNumber: 'DE123456789', country: 'DE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      valid: true,
      reason: 'VAT number verified via VIES',
      name: 'ACME GMBH',
      address: 'Berlin',
    })
  })

  it('returns invalid result without unavailable flag', async () => {
    mocks.validateVatWithVies.mockResolvedValue({
      isValid: false,
      reason: 'VAT number is not registered or not valid according to VIES',
    })

    const res = await postValidate({ vatNumber: 'DE999999999', country: 'DE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ valid: false })
  })

  it('returns 500 on unexpected errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.validateVatWithVies.mockRejectedValue(new Error('boom'))

    const res = await postValidate({ vatNumber: 'DE123456789', country: 'DE' })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ valid: false, unavailable: true })
    errorSpy.mockRestore()
  })
})
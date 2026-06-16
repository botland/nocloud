import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseVatForVies, validateVatWithVies } from '@/lib/vies'

describe('lib/vies', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parseVatForVies splits country prefix and number', () => {
    expect(parseVatForVies('DE123456789')).toEqual({ countryCode: 'DE', vatNumber: '123456789' })
    expect(parseVatForVies('fr 12 345 678 901')).toEqual({ countryCode: 'FR', vatNumber: '12345678901' })
  })

  it('validateVatWithVies rejects invalid format without calling VIES', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const result = await validateVatWithVies('BAD', 'FR')
    expect(result.isValid).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('validateVatWithVies parses VIES SOAP valid response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => `
        <soap:Envelope>
          <soap:Body>
            <checkVatResponse>
              <valid>true</valid>
              <name>ACME GMBH</name>
              <address>BERLIN</address>
            </checkVatResponse>
          </soap:Body>
        </soap:Envelope>`,
    } as Response)

    const result = await validateVatWithVies('DE123456789', 'DE')
    expect(result.isValid).toBe(true)
    expect(result.name).toBe('ACME GMBH')
  })

  it('validateVatWithVies returns unavailable on service fault', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<faultstring>MS_UNAVAILABLE</faultstring>',
    } as Response)

    const result = await validateVatWithVies('DE123456789', 'DE')
    expect(result.isValid).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('validateVatWithVies rejects registered-but-invalid numbers', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => `
        <soap:Envelope><soap:Body>
          <checkVatResponse><valid>false</valid></checkVatResponse>
        </soap:Body></soap:Envelope>`,
    } as Response)

    const result = await validateVatWithVies('DE123456789', 'DE')
    expect(result.isValid).toBe(false)
    expect(result.reason).toContain('not registered')
  })

  it('validateVatWithVies returns unavailable on network errors', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))

    const result = await validateVatWithVies('DE123456789', 'DE')
    expect(result.unavailable).toBe(true)
    expect(result.reason).toContain('Could not reach VIES')
  })

  it('validateVatWithVies rejects non-EU VAT prefixes', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const result = await validateVatWithVies('US123456789', 'US')
    expect(result.isValid).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
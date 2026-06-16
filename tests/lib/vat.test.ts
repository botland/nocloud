import { describe, it, expect } from 'vitest'
import {
  validateVatNumber,
  determineVatTreatment,
  computeVatAmounts,
  resolveFinalVatCharge,
  isEuCountry,
  getVatRate,
} from '@/lib/vat'

describe('lib/vat', () => {
  describe('validateVatNumber', () => {
    it('rejects empty and malformed numbers', () => {
      expect(validateVatNumber('', 'FR').isValid).toBe(false)
      expect(validateVatNumber('FR1', 'FR').isValid).toBe(false)
      expect(validateVatNumber('DE12345', 'FR').isValid).toBe(false)
      expect(validateVatNumber('FR-12.34.56', 'FR').isValid).toBe(true)
    })

    it('rejects invalid characters', () => {
      expect(validateVatNumber('FR12#4567', 'FR').isValid).toBe(false)
    })
  })

  describe('determineVatTreatment', () => {
    it('domestic FR allows VAT-inclusive election', () => {
      const t = determineVatTreatment({ customerCountry: 'FR', vatNumber: 'FR12345678901' })
      expect(t.mandatoryTreatment).toBe('charge_vat')
      expect(t.vatRate).toBe(0.2)
      expect(t.canOfferVatInclusive).toBe(true)
    })

    it('intra-EU with valid VAT number enforces reverse charge', () => {
      const t = determineVatTreatment({
        customerCountry: 'DE',
        vatNumber: 'DE123456789',
        viesValidated: true,
      })
      expect(t.mandatoryTreatment).toBe('reverse_charge')
      expect(t.vatRate).toBe(0)
      expect(t.canOfferVatInclusive).toBe(false)
    })

    it('intra-EU without valid VAT number charges customer-country VAT', () => {
      const t = determineVatTreatment({ customerCountry: 'DE', vatNumber: '' })
      expect(t.mandatoryTreatment).toBe('charge_vat')
      expect(t.vatRate).toBe(0.19)
      expect(t.canOfferVatInclusive).toBe(true)
    })

    it('non-EU export is zero-rated with no election', () => {
      const t = determineVatTreatment({ customerCountry: 'other' })
      expect(t.mandatoryTreatment).toBe('zero_rated')
      expect(t.canOfferVatInclusive).toBe(false)
    })
  })

  describe('computeVatAmounts', () => {
    it('returns net unchanged when not VAT-inclusive', () => {
      expect(computeVatAmounts(1000, 0.2, false)).toEqual({
        net: 1000,
        vatAmount: 0,
        gross: 1000,
        rateUsed: 0,
      })
    })

    it('grosses up with cent-safe rounding', () => {
      const r = computeVatAmounts(7990, 0.2, true)
      expect(r.net).toBe(7990)
      expect(r.vatAmount).toBe(1598)
      expect(r.gross).toBe(9588)
      expect(r.rateUsed).toBe(0.2)
    })
  })

  describe('resolveFinalVatCharge', () => {
    it('ignores illegal inclusive choice under reverse charge', () => {
      const treatment = determineVatTreatment({
        customerCountry: 'DE',
        vatNumber: 'DE123456789',
        viesValidated: true,
      })
      const r = resolveFinalVatCharge(treatment, true)
      expect(r.chargesVat).toBe(false)
      expect(r.effectiveRate).toBe(0)
      expect(r.reason).toContain('illegal')
    })

    it('charges VAT when customer elects inclusive on allowed path', () => {
      const treatment = determineVatTreatment({ customerCountry: 'FR' })
      const r = resolveFinalVatCharge(treatment, true)
      expect(r.chargesVat).toBe(true)
      expect(r.effectiveRate).toBe(0.2)
    })
  })

  describe('helpers', () => {
    it('isEuCountry and getVatRate', () => {
      expect(isEuCountry('DE')).toBe(true)
      expect(isEuCountry('US')).toBe(false)
      expect(getVatRate('IT')).toBe(0.22)
      expect(getVatRate('ZZ')).toBe(0)
    })
  })
})
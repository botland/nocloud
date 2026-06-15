import { describe, it, expect } from 'vitest'
import {
  formatPromoDate,
  isRecurringPromo,
  recurringPriceSuffix,
} from '@/lib/promo-display'

describe('lib/promo-display', () => {
  it('formatPromoDate formats UTC dates per locale', () => {
    expect(formatPromoDate('2026-08-31', 'en')).toMatch(/31/)
    expect(formatPromoDate('2026-08-31', 'fr')).toMatch(/31/)
  })

  it('formatPromoDate returns a string for malformed input', () => {
    expect(typeof formatPromoDate('not-a-date', 'en')).toBe('string')
  })

  it('isRecurringPromo is true only with until date and higher list price', () => {
    expect(isRecurringPromo(8, 10, '2026-08-31')).toBe(true)
    expect(isRecurringPromo(10, 10, '2026-08-31')).toBe(false)
    expect(isRecurringPromo(8, 10, undefined)).toBe(false)
    expect(isRecurringPromo(8, undefined, '2026-08-31')).toBe(false)
  })

  it('recurringPriceSuffix omits suffix for complimentary amounts', () => {
    expect(recurringPriceSuffix(0, '/mo')).toBe('')
    expect(recurringPriceSuffix(12, '/mo')).toBe('/mo')
  })
})
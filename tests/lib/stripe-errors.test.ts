import { describe, it, expect } from 'vitest'
import { extractStripeErrorCode, mapStripeErrorToMessage } from '@/lib/stripe-errors'

describe('lib/stripe-errors', () => {
  it('extractStripeErrorCode prefers decline_code over code', () => {
    expect(extractStripeErrorCode({ decline_code: 'insufficient_funds', code: 'card_declined' })).toBe(
      'insufficient_funds',
    )
  })

  it('mapStripeErrorToMessage returns localized card_declined message', () => {
    const en = mapStripeErrorToMessage({ code: 'card_declined' }, 'en')
    const fr = mapStripeErrorToMessage({ code: 'card_declined' }, 'fr')
    expect(en).toContain('declined')
    expect(fr).toContain('refusée')
  })

  it('mapStripeErrorToMessage falls back to Stripe message', () => {
    expect(mapStripeErrorToMessage({ message: 'Custom bank error' }, 'en')).toBe('Custom bank error')
  })
})
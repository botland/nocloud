import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const prefix = namespace ? `${namespace}.` : ''
    return (key: string, values?: Record<string, unknown>) => {
      if (!values) return `${prefix}${key}`
      return `${prefix}${key}:${Object.values(values).join('|')}`
    }
  },
  useLocale: () => 'en',
}))

import PromoPrice from '@/components/PromoPrice'

describe('PromoPrice', () => {
  it('renders free price for zero amount', () => {
    render(<PromoPrice amount={0} />)
    expect(screen.getByText('promotions.freePrice')).toBeTruthy()
  })

  it('renders recurring promo until/then copy', () => {
    render(
      <PromoPrice
        amount={8}
        listAmount={10}
        untilDate="2026-08-31"
        suffix="/mo"
        mode="recurring"
      />,
    )
    expect(screen.getByText(/recurringPromoUntil/)).toBeTruthy()
    expect(screen.getByText(/recurringThenList/)).toBeTruthy()
  })

  it('renders marketing strikethrough without until date', () => {
    render(
      <PromoPrice amount={8} listAmount={10} suffix="/mo" mode="recurring" size="lg" />,
    )
    expect(screen.getByText(/common\.price:10/)).toBeTruthy()
    expect(screen.getByText(/common\.price:8/)).toBeTruthy()
  })

  it('renders one-time hardware promo copy', () => {
    render(
      <PromoPrice
        amount={7000}
        listAmount={7990}
        untilDate="2026-08-31"
        mode="oneTime"
      />,
    )
    expect(screen.getByText(/hardwareFromList/)).toBeTruthy()
    expect(screen.getByText(/hardwarePromoUntil/)).toBeTruthy()
  })
})
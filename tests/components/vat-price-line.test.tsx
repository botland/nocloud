import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const prefix = namespace ? `${namespace}.` : ''
    return (key: string, values?: Record<string, unknown>) => {
      if (!values) return `${prefix}${key}`
      return `${prefix}${key}:${JSON.stringify(values)}`
    }
  },
}))

import VatPriceLine from '@/components/VatPriceLine'

describe('VatPriceLine', () => {
  it('renders row variant without breakdown', () => {
    render(<VatPriceLine label="Hardware total" amount={1200} net={1000} vat={200} />)
    expect(screen.getByText('Hardware total')).toBeTruthy()
    expect(screen.getByText('common.price:{"amount":1200}')).toBeTruthy()
    expect(screen.queryByText(/vatBreakdown/)).toBeNull()
  })

  it('renders summary variant with VAT breakdown', () => {
    render(
      <VatPriceLine
        label="Total to pay"
        amount={1200}
        net={1000}
        vat={200}
        showBreakdown
        variant="summary"
      />,
    )
    expect(screen.getByText('checkout.vatBreakdown:{"net":1000,"vat":200}')).toBeTruthy()
  })
})
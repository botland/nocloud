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

import PromoBadge, { PromoBadgeStack } from '@/components/PromoBadge'

describe('PromoBadge', () => {
  it('renders launch-free corner badge with until date', () => {
    render(
      <PromoBadge
        badge={{
          kind: 'launch_free',
          labelKey: 'managedCareLaunchFree',
          until: '2027-01-01',
        }}
        variant="corner"
      />,
    )
    expect(screen.getByText('promotions.managedCareLaunchFree')).toBeTruthy()
    expect(screen.getByText(/promotions.managedCareLaunchFreeUntil/)).toBeTruthy()
  })

  it('renders inline promotion badge', () => {
    render(
      <PromoBadge
        badge={{ kind: 'promotion', labelKey: 'vaultStudio', until: '2026-08-31' }}
        variant="inline"
      />,
    )
    expect(screen.getByText('promotions.vaultStudio')).toBeTruthy()
  })

  it('renders pre-order badge with percent interpolation', () => {
    render(
      <PromoBadge
        badge={{ kind: 'promotion', labelKey: 'preorderHardwareDiscount', percent: 10 }}
        variant="corner"
      />,
    )
    expect(screen.getByText('promotions.preorderHardwareDiscount:10')).toBeTruthy()
  })

  it('renders PromoBadgeStack as a horizontal row', () => {
    const { container } = render(
      <PromoBadgeStack
        badges={[
          { kind: 'promotion', labelKey: 'preorderHardwareDiscount', percent: 10 },
          { kind: 'promotion', labelKey: 'launchEdge', until: '2026-09-30' },
        ]}
      />,
    )
    const row = container.firstChild as HTMLElement
    expect(row.className).toMatch(/flex-row/)
    expect(row.className).toMatch(/flex-nowrap/)
    expect(screen.getByText('promotions.preorderHardwareDiscount:10')).toBeTruthy()
    expect(screen.getByText('promotions.launchEdge')).toBeTruthy()
  })
})
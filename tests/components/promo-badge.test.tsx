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

import PromoBadge from '@/components/PromoBadge'

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
})
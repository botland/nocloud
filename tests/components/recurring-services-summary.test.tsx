import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SERVICE_PRICES_BY_TIER } from '@/lib/pricing'
import { MANAGED_CARE_LAUNCH_OFFER } from '@/lib/promotions'

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

import RecurringServicesSummary from '@/components/RecurringServicesSummary'

const launchFreeLine = {
  id: 'mc',
  name: 'Managed Care',
  key: 'managedCare',
  price: 0,
  listPrice: SERVICE_PRICES_BY_TIER.studio.managedCare,
  launchFreeUntil: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
}

describe('RecurringServicesSummary', () => {
  it('returns null when there are no lines', () => {
    const { container } = render(<RecurringServicesSummary lines={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders per-service lines and PM note when monthly total is zero', () => {
    render(<RecurringServicesSummary lines={[launchFreeLine]} showPmNote />)
    expect(screen.getByText('Managed Care')).toBeTruthy()
    expect(screen.getByText('promotions.recurringPmRequired')).toBeTruthy()
  })

  it('renders schedule variant', () => {
    render(<RecurringServicesSummary lines={[launchFreeLine]} variant="schedule" />)
    expect(screen.getByText('promotions.recurringScheduleTitle')).toBeTruthy()
  })
})
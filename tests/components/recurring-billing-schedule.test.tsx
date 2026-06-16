import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MANAGED_CARE_LAUNCH_OFFER } from '@/lib/promotions'
import { SERVICE_PRICES_BY_TIER } from '@/lib/pricing'

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

import RecurringBillingSchedule from '@/components/RecurringBillingSchedule'

describe('RecurringBillingSchedule', () => {
  it('returns null for empty lines', () => {
    const { container } = render(<RecurringBillingSchedule lines={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders phased schedule copy for launch-free managed care', () => {
    render(
      <RecurringBillingSchedule
        lines={[
          {
            id: 'mc',
            name: 'Managed Care',
            key: 'managedCare',
            price: 0,
            listPrice: SERVICE_PRICES_BY_TIER.studio.managedCare,
            launchFreeUntil: MANAGED_CARE_LAUNCH_OFFER.freeUntil,
          },
        ]}
      />,
    )

    expect(screen.getByText('promotions.recurringScheduleTitle')).toBeTruthy()
    expect(screen.getByText(/recurringScheduleFreeUntil/)).toBeTruthy()
    expect(screen.getByText(/recurringScheduleThenOngoing/)).toBeTruthy()
    expect(screen.getByText('promotions.recurringScheduleNote')).toBeTruthy()
  })
})
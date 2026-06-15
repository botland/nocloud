import { describe, it, expect } from 'vitest'
import {
  aggregateRecurringServiceLines,
  aggregatedRecurringLinesFromCart,
  hasRecurringServices,
  recurringServicesMonthly,
} from '@/lib/cart-services'
import type { CartItem } from '@/lib/types'

const baseItem: CartItem = {
  id: 1,
  product: { id: 1, slug: 'studio', name: 'Studio', tier: '', price: 7990, description: '' },
  services: [],
  quantity: 1,
  totalPrice: 7990,
}

describe('lib/cart-services', () => {
  it('detects recurring services even when net price is zero (launch-free)', () => {
    const cart: CartItem[] = [
      {
        ...baseItem,
        services: [{ name: 'Managed Care', price: 0, listPrice: 99, key: 'managedCare', launchFreeUntil: '2027-01-01' }],
      },
    ]
    expect(hasRecurringServices(cart)).toBe(true)
    expect(recurringServicesMonthly(cart)).toBe(0)
  })

  it('returns false when no services selected', () => {
    expect(hasRecurringServices([baseItem])).toBe(false)
  })

  it('aggregates identical recurring services and sums monthly amounts', () => {
    const cart: CartItem[] = [
      {
        ...baseItem,
        quantity: 2,
        services: [
          { name: 'Managed Care', price: 0, listPrice: 58, key: 'managedCare', launchFreeUntil: '2027-01-01' },
        ],
      },
      {
        ...baseItem,
        id: 2,
        services: [
          { name: 'Managed Care', price: 0, listPrice: 58, key: 'managedCare', launchFreeUntil: '2027-01-01' },
        ],
      },
    ]
    const lines = aggregatedRecurringLinesFromCart(cart)
    expect(lines).toHaveLength(1)
    expect(lines[0].name).toBe('Managed Care ×3')
    expect(lines[0].price).toBe(0)
    expect(lines[0].listPrice).toBe(58 * 3)
  })

  it('keeps separate rows when promotion period differs', () => {
    const lines = aggregateRecurringServiceLines([
      { id: '1', name: 'SecureVault Backup', key: 'secureVaultBackup', price: 39, listPrice: 49, promoEndsAt: '2026-08-31' },
      { id: '2', name: 'SecureVault Backup', key: 'secureVaultBackup', price: 49, listPrice: 49 },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0].id).not.toBe(lines[1].id)
  })

  it('aggregates same service and promo period when tier amounts differ', () => {
    const lines = aggregateRecurringServiceLines([
      { id: '1', name: 'Managed Care', key: 'managedCare', price: 0, listPrice: 58, launchFreeUntil: '2027-01-01' },
      { id: '2', name: 'Managed Care', key: 'managedCare', price: 0, listPrice: 49, launchFreeUntil: '2027-01-01' },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe('managedCare|2027-01-01|')
    expect(lines[0].name).toBe('Managed Care ×2')
    expect(lines[0].price).toBe(0)
    expect(lines[0].listPrice).toBe(107)
  })

  it('merges no-promo lines of the same service and sums amounts', () => {
    const lines = aggregateRecurringServiceLines([
      { id: '1', name: 'SecureVault Backup', key: 'secureVaultBackup', price: 49, listPrice: 49 },
      { id: '2', name: 'SecureVault Backup', key: 'secureVaultBackup', price: 59, listPrice: 59 },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe('secureVaultBackup||')
    expect(lines[0].price).toBe(108)
    expect(lines[0].listPrice).toBe(108)
  })
})
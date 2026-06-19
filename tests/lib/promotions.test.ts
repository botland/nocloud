import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveHardwarePrice,
  resolveServicePrice,
  resolveMinServicePrice,
  isManagedCareLaunchFree,
  MANAGED_CARE_LAUNCH_OFFER,
} from '@/lib/promotions'
import {
  aggregateHardwarePromoNet,
  applyHardwareDiscount,
  HARDWARE_PRICES,
  hardwareNetWithBaseDiscount,
  PREORDER_HARDWARE_DISCOUNT_PERCENT,
  SERVICE_PRICES_BY_TIER,
} from '@/lib/pricing'

describe('lib/promotions', () => {
  const june2026 = new Date('2026-06-15T12:00:00.000Z')
  const beforeLaunch = new Date('2026-01-01T00:00:00.000Z')
  const afterLaunch = new Date('2027-06-01T00:00:00.000Z')
  const originalCommerceMode = process.env.NEXT_PUBLIC_COMMERCE_MODE

  beforeEach(() => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'live'
  })

  afterEach(() => {
    if (originalCommerceMode === undefined) {
      delete process.env.NEXT_PUBLIC_COMMERCE_MODE
    } else {
      process.env.NEXT_PUBLIC_COMMERCE_MODE = originalCommerceMode
    }
  })

  it('applies active hardware tier promotion (edge 10% in Jun 2026)', () => {
    const r = resolveHardwarePrice('edge', undefined, june2026)
    expect(r.list).toBe(HARDWARE_PRICES.edge)
    expect(r.net).toBe(Math.round(HARDWARE_PRICES.edge * 0.9))
    expect(r.badge?.labelKey).toBe('launchEdge')
    expect(r.badges).toEqual([expect.objectContaining({ labelKey: 'launchEdge' })])
  })

  it('does not apply hardware promo outside date window', () => {
    const r = resolveHardwarePrice('edge', undefined, new Date('2025-01-01T00:00:00.000Z'))
    expect(r.net).toBe(r.list)
    expect(r.badge).toBeUndefined()
  })

  it('Managed Care launch offer is free until 2027 (independent of tier promos)', () => {
    expect(isManagedCareLaunchFree(beforeLaunch)).toBe(true)
    const studio = resolveServicePrice('managedCare', 'studio', beforeLaunch)
    expect(studio.net).toBe(0)
    expect(studio.list).toBe(SERVICE_PRICES_BY_TIER.studio.managedCare)
    expect(studio.launchFreeUntil).toBe(MANAGED_CARE_LAUNCH_OFFER.freeUntil)
    expect(studio.badge?.kind).toBe('launch_free')
  })

  it('Managed Care charges catalog price after launch window ends', () => {
    const studio = resolveServicePrice('managedCare', 'studio', afterLaunch)
    expect(studio.net).toBe(SERVICE_PRICES_BY_TIER.studio.managedCare)
    expect(studio.launchFreeUntil).toBeUndefined()
  })

  it('applies service tier promotion on studio vault backup', () => {
    const r = resolveServicePrice('secureVaultBackup', 'studio', june2026)
    expect(r.list).toBe(SERVICE_PRICES_BY_TIER.studio.secureVaultBackup)
    expect(r.net).toBe(Math.round(r.list * 0.8))
    expect(r.badge?.labelKey).toBe('vaultStudio')
    expect(r.promoEndsAt).toBe('2026-08-31')
    expect(r.promotionIds).toEqual(['studio-vault-2026'])
  })

  it('resolveMinServicePrice returns launch-free managed care minimum', () => {
    const r = resolveMinServicePrice('managedCare', beforeLaunch)
    expect(r.net).toBe(0)
    expect(r.badge?.kind).toBe('launch_free')
  })

  it('resolveHardwarePrice with customization includes option surcharges before promo', () => {
    const r = resolveHardwarePrice(
      'edge',
      {
        vram: { value: 24, label: '24 GB GDDR6' },
      },
      june2026,
    )
    const listWithVram = HARDWARE_PRICES.edge + 2690
    expect(r.list).toBe(listWithVram)
    expect(r.net).toBe(Math.round(listWithVram * 0.9))
  })

  it('resolveHardwarePrice returns list price for unknown tier slugs', () => {
    const r = resolveHardwarePrice('unknown-tier', undefined, june2026)
    expect(r.net).toBe(0)
    expect(r.list).toBe(0)
    expect(r.badge).toBeUndefined()
  })

  it('resolveServicePrice skips tier promo when hardware slug is unknown', () => {
    const r = resolveServicePrice('secureVaultBackup', 'unknown-tier', june2026)
    expect(r.net).toBe(49)
    expect(r.list).toBe(49)
    expect(r.promoEndsAt).toBeUndefined()
  })

  it('applies pre-order hardware discount on all tiers when commerce mode is preorder', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'preorder'
    for (const slug of ['edge', 'studio', 'forge'] as const) {
      const r = resolveHardwarePrice(slug, undefined, new Date('2025-01-01T00:00:00.000Z'))
      expect(r.list).toBe(HARDWARE_PRICES[slug])
      expect(r.net).toBe(applyHardwareDiscount(HARDWARE_PRICES[slug], PREORDER_HARDWARE_DISCOUNT_PERCENT))
      expect(r.badge?.labelKey).toBe('preorderHardwareDiscount')
      expect(r.badge?.percent).toBe(PREORDER_HARDWARE_DISCOUNT_PERCENT)
    }
  })

  it('pre-order discount applies to base price only, not customization upgrades', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'preorder'
    const customization = { vram: { value: 24, label: '24 GB GDDR6' } }
    const r = resolveHardwarePrice('edge', customization, new Date('2025-01-01T00:00:00.000Z'))
    const listWithVram = HARDWARE_PRICES.edge + 2690
    expect(r.list).toBe(listWithVram)
    expect(r.net).toBe(
      hardwareNetWithBaseDiscount('edge', PREORDER_HARDWARE_DISCOUNT_PERCENT, customization),
    )
    expect(r.net).toBe(applyHardwareDiscount(HARDWARE_PRICES.edge, PREORDER_HARDWARE_DISCOUNT_PERCENT) + 2690)
    expect(r.badge?.percent).toBe(PREORDER_HARDWARE_DISCOUNT_PERCENT)
  })

  it('does not apply pre-order hardware discount in live commerce mode', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'live'
    const r = resolveHardwarePrice('studio', undefined, new Date('2025-01-01T00:00:00.000Z'))
    expect(r.net).toBe(HARDWARE_PRICES.studio)
    expect(r.badge).toBeUndefined()
  })

  it('shows both pre-order and tier badges on edge when both apply', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'preorder'
    const r = resolveHardwarePrice('edge', undefined, june2026)
    expect(r.badges).toHaveLength(2)
    expect(r.badges![0].labelKey).toBe('preorderHardwareDiscount')
    expect(r.badges![1].labelKey).toBe('launchEdge')
    expect(r.net).toBe(
      aggregateHardwarePromoNet('edge', PREORDER_HARDWARE_DISCOUNT_PERCENT, 10),
    )
    expect(r.promotionIds).toEqual(['preorder-hardware-discount', 'edge-launch-2026'])
  })

  it('aggregates both promos with customization (pre-order on base, tier on base + upgrades)', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'preorder'
    const customization = { vram: { value: 24, label: '24 GB GDDR6' } }
    const r = resolveHardwarePrice('edge', customization, june2026)
    expect(r.badges).toHaveLength(2)
    expect(r.net).toBe(
      aggregateHardwarePromoNet('edge', PREORDER_HARDWARE_DISCOUNT_PERCENT, 10, customization),
    )
    expect(r.promotionIds).toEqual(['preorder-hardware-discount', 'edge-launch-2026'])
  })
})
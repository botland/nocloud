import { describe, it, expect } from 'vitest'
import {
  resolveHardwarePrice,
  resolveServicePrice,
  resolveMinServicePrice,
  isManagedCareLaunchFree,
  MANAGED_CARE_LAUNCH_OFFER,
} from '@/lib/promotions'
import { HARDWARE_PRICES, SERVICE_PRICES_BY_TIER } from '@/lib/pricing'

describe('lib/promotions', () => {
  const june2026 = new Date('2026-06-15T12:00:00.000Z')
  const beforeLaunch = new Date('2026-01-01T00:00:00.000Z')
  const afterLaunch = new Date('2027-06-01T00:00:00.000Z')

  it('applies active hardware tier promotion (edge 10% in Jun 2026)', () => {
    const r = resolveHardwarePrice('edge', undefined, june2026)
    expect(r.list).toBe(HARDWARE_PRICES.edge)
    expect(r.net).toBe(Math.round(HARDWARE_PRICES.edge * 0.9))
    expect(r.badge?.labelKey).toBe('launchEdge')
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
})
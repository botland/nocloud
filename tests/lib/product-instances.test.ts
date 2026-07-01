import { describe, it, expect } from 'vitest'
import {
  buildProductLineId,
  generateProductSerial,
  resolveHardwareInstances,
  resolveOrderLineInstances,
  compactServicesForMetadata,
  parseServicesFromMetadata,
  serviceSubscriptionProductInfo,
  buildHardwareCheckoutLineItems,
  buildLeaseUpfrontCheckoutLineItems,
  hardwareForMetadata,
  leaseUpfrontNetPerUnit,
} from '@/lib/product-instances'
import { HARDWARE_PRICES, PRICING_VERSION, SERVICE_PRICES_BY_TIER, UPFRONT_PERCENT } from '@/lib/pricing'

describe('lib/product-instances', () => {
  it('buildProductLineId combines product name and pricing version', () => {
    expect(buildProductLineId('Studio', '2026-06-13-tier-spec-options')).toBe(
      'Studio@2026-06-13-tier-spec-options',
    )
  })

  it('generateProductSerial encodes slug and produces unique values', () => {
    const s1 = generateProductSerial('studio')
    const s2 = generateProductSerial('studio')
    expect(s1).toMatch(/^NC-STUDIO-[A-F0-9]{10}$/)
    expect(s2).toMatch(/^NC-STUDIO-[A-F0-9]{10}$/)
    expect(s1).not.toBe(s2)
  })

  it('resolveHardwareInstances expands quantity into separate serials', () => {
    const instances = resolveHardwareInstances(
      [
        {
          quantity: 2,
          product: { slug: 'studio', name: 'Studio', price: HARDWARE_PRICES.studio },
          services: [{ name: 'Managed Care' }],
        },
      ],
      PRICING_VERSION,
    )
    expect(instances).toHaveLength(2)
    expect(instances[0].serialNumber).not.toBe(instances[1].serialNumber)
    expect(instances[0].productLineId).toBe(`Studio@${PRICING_VERSION}`)
    expect(instances[0].includedServices).toEqual(['Managed Care'])
  })

  it('buildLeaseUpfrontCheckoutLineItems splits upfront per hardware unit', () => {
    const instances = resolveHardwareInstances(
      [{ quantity: 1, product: { slug: 'studio', name: 'Studio', price: HARDWARE_PRICES.studio }, services: [] }],
      PRICING_VERSION,
    )
    const lines = buildLeaseUpfrontCheckoutLineItems(instances, (n) => n, UPFRONT_PERCENT)
    expect(lines).toHaveLength(1)
    expect(lines[0].price_data.unit_amount).toBe(
      Math.round(leaseUpfrontNetPerUnit(instances[0], UPFRONT_PERCENT) * 100),
    )
    expect(lines[0].price_data.product_data.metadata.line_type).toBeUndefined()
    expect(lines[0].price_data.product_data.metadata.serial_number).toMatch(/^NC-STUDIO-/)
  })

  it('resolveOrderLineInstances creates per-appliance service instances with tier pricing and host serial', () => {
    const { hardwareInstances, serviceInstances } = resolveOrderLineInstances(
      [
        {
          quantity: 2,
          product: { slug: 'edge', name: 'Edge', price: HARDWARE_PRICES.edge },
          services: [{ name: 'Managed Care', key: 'managedCare' }],
        },
      ],
      PRICING_VERSION,
    )
    expect(hardwareInstances).toHaveLength(2)
    expect(serviceInstances).toHaveLength(2)
    expect(serviceInstances[0].listPrice).toBe(SERVICE_PRICES_BY_TIER.edge.managedCare)
    expect(serviceInstances[0].price).toBe(0)
    expect(serviceInstances[0].launchFreeUntil).toBe('2027-01-01')
    expect(serviceInstances[0].hostSerialNumber).toBe(hardwareInstances[0].serialNumber)
    expect(serviceInstances[0].productLineId).toBe(`Managed-Care@${PRICING_VERSION}`)
    expect(serviceInstances[1].hostSerialNumber).toBe(hardwareInstances[1].serialNumber)
  })

  it('serviceSubscriptionProductInfo puts host serial in product name for invoice line items', () => {
    const { serviceInstances } = resolveOrderLineInstances(
      [{ quantity: 1, product: { slug: 'studio', name: 'Studio' }, services: [{ name: 'Managed Care', key: 'managedCare' }] }],
      PRICING_VERSION,
    )
    const info = serviceSubscriptionProductInfo(serviceInstances[0])
    expect(info.name).toContain('[S/N:')
    expect(info.name).toContain(serviceInstances[0].hostSerialNumber)
    expect(info.metadata.serial_number).toBe(serviceInstances[0].hostSerialNumber)
  })

  it('compactServicesForMetadata round-trips via parseServicesFromMetadata', () => {
    const { serviceInstances } = resolveOrderLineInstances(
      [{ quantity: 1, product: { slug: 'forge', name: 'Forge' }, services: [{ name: 'SecureVault Backup', key: 'secureVaultBackup' }] }],
      PRICING_VERSION,
    )
    const compact = compactServicesForMetadata(serviceInstances)
    const json = JSON.stringify(compact)
    const restored = parseServicesFromMetadata(json, PRICING_VERSION)
    expect(restored[0].price).toBe(SERVICE_PRICES_BY_TIER.forge.secureVaultBackup)
    expect(restored[0].hostSerialNumber).toBe(serviceInstances[0].hostSerialNumber)
    expect(restored[0].productLineId).toBe(`SecureVault-Backup@${PRICING_VERSION}`)
  })

  it('studio vault promo carries promo end date and promotion ids through metadata', () => {
    const { serviceInstances } = resolveOrderLineInstances(
      [
        {
          quantity: 1,
          product: { slug: 'studio', name: 'Studio' },
          services: [{ name: 'SecureVault Backup', key: 'secureVaultBackup' }],
        },
      ],
      PRICING_VERSION,
    )
    const svc = serviceInstances[0]
    expect(svc.promoEndsAt).toBe('2026-08-31')
    expect(svc.promotionIds).toEqual(['studio-vault-2026'])
    expect(svc.price).toBeLessThan(svc.listPrice)

    const compact = compactServicesForMetadata(serviceInstances)
    expect(compact[0].pe).toBe('2026-08-31')
    expect(compact[0].pi).toEqual(['studio-vault-2026'])

    const restored = parseServicesFromMetadata(JSON.stringify(compact), PRICING_VERSION)
    expect(restored[0].promoEndsAt).toBe('2026-08-31')
    expect(restored[0].promotionIds).toEqual(['studio-vault-2026'])
  })

  it('hardwareForMetadata includes serialNumber for session metadata', () => {
    const instances = resolveHardwareInstances(
      [{ quantity: 1, product: { slug: 'studio', name: 'Studio' }, services: [] }],
      PRICING_VERSION,
    )
    const meta = hardwareForMetadata(instances)
    expect(meta[0].serialNumber).toMatch(/^NC-STUDIO-/)
    expect(meta[0].productLineId).toBe(`Studio@${PRICING_VERSION}`)
  })

  it('buildHardwareCheckoutLineItems attaches product_line_id and serial_number metadata', () => {
    const instances = resolveHardwareInstances(
      [{ quantity: 1, product: { slug: 'edge', name: 'Edge', price: HARDWARE_PRICES.edge }, services: [] }],
      PRICING_VERSION,
    )
    const lines = buildHardwareCheckoutLineItems(instances, (n) => n)
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(1)
    expect(lines[0].price_data.product_data.metadata.product_line_id).toBe(`Edge@${PRICING_VERSION}`)
    expect(lines[0].price_data.product_data.metadata.serial_number).toMatch(/^NC-EDGE-/)
    expect(lines[0].price_data.product_data.description).toContain('[S/N:')
  })
})
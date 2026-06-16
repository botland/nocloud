import { describe, it, expect, vi } from 'vitest'
import {
  buildPaymentContext,
  validatePaymentEligibility,
  resolvePricesAndServices,
} from '@/lib/payment-flow'
import * as pricing from '@/lib/pricing'
import { LEASE_MIN, LEASE_MAX, PBI_MAX, SEPA_MAX } from '@/lib/pricing'

describe('lib/payment-flow', () => {
  describe('buildPaymentContext', () => {
    it('maps full card and hybrid invoice strategies', () => {
      expect(
        buildPaymentContext({
          financing: 'full',
          paymentMethod: 'stripe',
          servicesMonthly: 99,
          hardwareTotal: 7990,
        }).strategy,
      ).toBe('full-card-sepa')

      expect(
        buildPaymentContext({
          financing: 'full',
          paymentMethod: 'invoice',
          servicesMonthly: 99,
          hardwareTotal: 7990,
          recurringPaymentMethod: 'stripe',
        }).strategy,
      ).toBe('full-invoice-hybrid')

      expect(
        buildPaymentContext({
          financing: 'lease',
          paymentMethod: 'invoice',
          servicesMonthly: 0,
          hardwareTotal: 5000,
        }).strategy,
      ).toBe('lease-invoice')
    })

    it('treats launch-free recurring as hasServices', () => {
      const ctx = buildPaymentContext({
        financing: 'full',
        paymentMethod: 'invoice',
        servicesMonthly: 0,
        hardwareTotal: 7990,
        hasRecurringServices: true,
        recurringPaymentMethod: 'sepa',
      })
      expect(ctx.hasServices).toBe(true)
      expect(ctx.isHybridRecurringSetup).toBe(true)
    })
  })

  describe('validatePaymentEligibility', () => {
    const okContext = buildPaymentContext({
      financing: 'full',
      paymentMethod: 'stripe',
      servicesMonthly: 0,
      hardwareTotal: 7990,
    })

    it('returns LEASE_RANGE when hardware is outside lease bounds', () => {
      const ctx = buildPaymentContext({
        financing: 'lease',
        paymentMethod: 'stripe',
        servicesMonthly: 0,
        hardwareTotal: LEASE_MIN - 1,
      })
      expect(validatePaymentEligibility(ctx, LEASE_MIN - 1, 100, 0)).toBe('LEASE_RANGE')
    })

    it('returns PBI_RANGE for invoice outside pay-by-invoice bounds', () => {
      const ctx = buildPaymentContext({
        financing: 'full',
        paymentMethod: 'invoice',
        servicesMonthly: 0,
        hardwareTotal: PBI_MAX + 1,
      })
      expect(validatePaymentEligibility(ctx, PBI_MAX + 1, PBI_MAX + 1, 0)).toBe('PBI_RANGE')
    })

    it('returns INVOICE_POLICY when invoice policy rejects the combination', () => {
      const spy = vi.spyOn(pricing, 'isInvoiceAllowed').mockReturnValue(false)
      const ctx = buildPaymentContext({
        financing: 'lease',
        paymentMethod: 'invoice',
        servicesMonthly: 99,
        hardwareTotal: 5000,
      })
      expect(validatePaymentEligibility(ctx, 5000, 500, 99)).toBe('INVOICE_POLICY')
      spy.mockRestore()
    })

    it('returns SEPA_MAIN when main due amount exceeds limit', () => {
      const ctx = buildPaymentContext({
        financing: 'full',
        paymentMethod: 'sepa',
        servicesMonthly: 0,
        hardwareTotal: 7990,
      })
      expect(validatePaymentEligibility(ctx, 7990, SEPA_MAX + 1, 0)).toBe('SEPA_MAIN')
    })

    it('returns SEPA_SERVICES for hybrid invoice with high recurring SEPA', () => {
      const ctx = buildPaymentContext({
        financing: 'full',
        paymentMethod: 'invoice',
        servicesMonthly: SEPA_MAX + 1,
        hardwareTotal: 5000,
        recurringPaymentMethod: 'sepa',
      })
      expect(validatePaymentEligibility(ctx, 5000, 5000, SEPA_MAX + 1)).toBe('SEPA_SERVICES')
    })

    it('returns null when all checks pass', () => {
      expect(validatePaymentEligibility(okContext, 7990, 7990, 0)).toBeNull()
      expect(
        validatePaymentEligibility(
          buildPaymentContext({
            financing: 'lease',
            paymentMethod: 'stripe',
            servicesMonthly: 0,
            hardwareTotal: 5000,
          }),
          5000,
          500,
          0,
        ),
      ).toBeNull()
      expect(validatePaymentEligibility(okContext, LEASE_MAX, LEASE_MAX, 0)).toBeNull()
    })
  })

  describe('resolvePricesAndServices', () => {
    it('resolves hardware, customization extras, and tier-priced services', () => {
      const result = resolvePricesAndServices([
        {
          quantity: 1,
          product: { slug: 'studio', name: 'Studio', price: 7990 },
          customization: {
            disk: { key: '2tb', label: '2 TB HDD', price: 1050 },
          },
          services: [{ key: 'secureVaultBackup', name: 'SecureVault Backup' }],
        },
      ])

      expect(result.hardwareTotal).toBeGreaterThan(0)
      expect(result.servicesMonthly).toBeGreaterThan(0)
      expect(result.resolvedServicesForMeta[0].name).toBe('SecureVault Backup')
      expect(result.resolvedHardwareForMeta[0].config).toContain('2 TB')
    })

    it('falls back when product slug is missing', () => {
      const result = resolvePricesAndServices([
        { quantity: 2, product: { price: 100 }, services: [{ name: 'Support', price: 10 }] },
      ])
      expect(result.hardwareTotal).toBe(200)
      expect(result.servicesMonthly).toBe(20)
    })
  })
})
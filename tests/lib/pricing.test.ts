import { describe, it, expect } from 'vitest'
import {
  PRICING_VERSION,
  HARDWARE_PRICES,
  SERVICE_PRICES,
  LEASE_MAX,
  LEASE_MIN,
  LEASE_THRESHOLD,
  LEASE_MONTHS_UNDER,
  LEASE_MONTHS_OVER,
  PBI_MAX,
  PBI_MIN,
  SEPA_MAX,
  INVOICE_ONLY_FULL_NO_SERVICES,
  UPFRONT_PERCENT,
  getHardwarePrice,
  getServicePrice,
  calculateLease,
  isLeaseAllowed,
  getUpfrontAmount,
  isOverSepaLimit,
  isPbiAllowed,
  isInvoiceAllowed,
  SERVICE_KEYS,
  TIER_SPEC_OPTIONS,
  getSpecOptions,
  getDefaultOption,
  getOptionPrice,
  calculateHardwarePrice,
  formatHardwareCustomization,
  type LeaseDetails,
} from '@/lib/pricing'

describe('lib/pricing (functional business rules - implementation independent)', () => {
  describe('constants (stable pricing catalog + policy)', () => {
    it('exports PRICING_VERSION for metadata/audit', () => {
      expect(typeof PRICING_VERSION).toBe('string')
      expect(PRICING_VERSION.length).toBeGreaterThan(0)
    })

    it('exports hardware prices with expected slugs and positive EUR values', () => {
      expect(HARDWARE_PRICES.edge).toBe(4990)
      expect(HARDWARE_PRICES.studio).toBe(7990)
      expect(HARDWARE_PRICES.forge).toBe(14900)
    })

    it('exports service prices (monthly recurring)', () => {
      expect(SERVICE_PRICES.managedCare).toBe(99)
      expect(SERVICE_PRICES.secureVaultBackup).toBe(49)
    })

    it('exports lease range and term thresholds', () => {
      expect(LEASE_MIN).toBe(5000)
      expect(LEASE_MAX).toBe(200000)
      expect(LEASE_THRESHOLD).toBe(10000)
      expect(LEASE_MONTHS_UNDER).toBe(12)
      expect(LEASE_MONTHS_OVER).toBe(24)
    })

    it('exports PBI and SEPA limits + invoice policy flag', () => {
      expect(PBI_MIN).toBe(5000)
      expect(PBI_MAX).toBe(20000)
      expect(SEPA_MAX).toBe(10000)
      expect(typeof INVOICE_ONLY_FULL_NO_SERVICES).toBe('boolean')
      expect(UPFRONT_PERCENT).toBe(20)
    })
  })

  describe('price resolvers (authoritative source, used by client + server)', () => {
    it('getHardwarePrice returns correct price for known slugs and 0 for unknown', () => {
      expect(getHardwarePrice('edge')).toBe(4990)
      expect(getHardwarePrice('studio')).toBe(7990)
      expect(getHardwarePrice('forge')).toBe(14900)
      expect(getHardwarePrice('unknown')).toBe(0)
      expect(getHardwarePrice('')).toBe(0)
    })

    it('getServicePrice returns correct price for known keys and 0 for unknown', () => {
      expect(getServicePrice('managedCare')).toBe(99)
      expect(getServicePrice('secureVaultBackup')).toBe(49)
      // @ts-expect-error intentional for runtime guard test
      expect(getServicePrice('nope' as any)).toBe(0)
    })
  })

  describe('calculateLease (core math, must be identical client/server)', () => {
    // Helper to assert full shape without relying on impl internals
    function expectLeaseShape(result: LeaseDetails, expected: Partial<LeaseDetails> & { isAllowed: boolean }) {
      expect(result).toMatchObject({
        isAllowed: expected.isAllowed,
        ...(expected.isAllowed
          ? {
              months: expected.months,
              hardwarePerMonth: expected.hardwarePerMonth,
              upfrontAmount: expected.upfrontAmount,
              financedAmount: expected.financedAmount,
              monthlyTotal: expected.monthlyTotal,
            }
          : {
              months: 0,
              monthlyTotal: 0,
              hardwarePerMonth: 0,
              upfrontAmount: 0,
              financedAmount: 0,
            }),
      })
    }

    it('disallows below LEASE_MIN and above LEASE_MAX', () => {
      expectLeaseShape(calculateLease(4999), { isAllowed: false })
      expectLeaseShape(calculateLease(200001), { isAllowed: false })
      expect(calculateLease(4999).isAllowed).toBe(false)
      expect(calculateLease(200001).isAllowed).toBe(false)
    })

    it('allows exactly at LEASE_MIN and LEASE_MAX', () => {
      const atMin = calculateLease(LEASE_MIN)
      expect(atMin.isAllowed).toBe(true)
      expect(atMin.months).toBe(12)

      const atMax = calculateLease(LEASE_MAX)
      expect(atMax.isAllowed).toBe(true)
      expect(atMax.months).toBe(24)
    })

    it('uses 12 months for hardwareTotal < LEASE_THRESHOLD, 24 months otherwise (threshold inclusive for 24)', () => {
      const under = calculateLease(9999)
      expect(under.months).toBe(12)
      expect(under.isAllowed).toBe(true)

      const atThresh = calculateLease(10000)
      expect(atThresh.months).toBe(24)

      const over = calculateLease(10001)
      expect(over.months).toBe(24)
    })

    it('computes 20% upfront (rounded), financed = total - upfront, hardwarePerMonth = ceil(financed / months)', () => {
      // 7990 is under threshold → 12 months
      // 7990 * 0.2 = 1598 exactly
      const r1 = calculateLease(7990)
      expect(r1.upfrontAmount).toBe(1598)
      expect(r1.financedAmount).toBe(7990 - 1598)
      // 6392 / 12 = 532.666... -> ceil 533
      expect(r1.hardwarePerMonth).toBe(533)
      expect(r1.monthlyTotal).toBe(533) // no services
      expect(r1.months).toBe(12)

      // 14900 >= threshold → 24 months
      // 14900 * 0.2 = 2980
      const r2 = calculateLease(14900)
      expect(r2.upfrontAmount).toBe(2980)
      expect(r2.financedAmount).toBe(11920)
      // 11920 / 24 = 496.666... -> 497
      expect(r2.hardwarePerMonth).toBe(497)
      expect(r2.months).toBe(24)
    })

    it('adds servicesMonthly to monthlyTotal (services do not affect term or upfront)', () => {
      const noSvc = calculateLease(14900, 0)
      const withSvc = calculateLease(14900, 99 + 49)
      expect(withSvc.upfrontAmount).toBe(noSvc.upfrontAmount)
      expect(withSvc.monthlyTotal).toBe(noSvc.hardwarePerMonth + 148)
      expect(withSvc.months).toBe(noSvc.months)
    })

    it('returns consistent zeroed shape when not allowed', () => {
      const bad = calculateLease(1000)
      expect(bad).toEqual({
        months: 0,
        monthlyTotal: 0,
        hardwarePerMonth: 0,
        upfrontAmount: 0,
        financedAmount: 0,
        isAllowed: false,
      })
    })
  })

  describe('lease helper functions (thin wrappers around calculateLease + ranges)', () => {
    it('isLeaseAllowed matches calculateLease().isAllowed', () => {
      expect(isLeaseAllowed(4999)).toBe(false)
      expect(isLeaseAllowed(5000)).toBe(true)
      expect(isLeaseAllowed(200000)).toBe(true)
      expect(isLeaseAllowed(200001)).toBe(false)
    })

    it('getUpfrontAmount returns 0 when not allowed, otherwise 20% rounded', () => {
      expect(getUpfrontAmount(4999)).toBe(0)
      expect(getUpfrontAmount(10000)).toBe(Math.round(10000 * 0.2))
      expect(getUpfrontAmount(14900)).toBe(2980)
    })
  })

  describe('payment method guards (SEPA, PBI, invoice policy)', () => {
    it('isOverSepaLimit uses SEPA_MAX (strict >)', () => {
      expect(isOverSepaLimit(10000)).toBe(false)
      expect(isOverSepaLimit(10001)).toBe(true)
      expect(isOverSepaLimit(0)).toBe(false)
    })

    it('isPbiAllowed uses PBI_MIN/MAX inclusive', () => {
      expect(isPbiAllowed(4999)).toBe(false)
      expect(isPbiAllowed(5000)).toBe(true)
      expect(isPbiAllowed(20000)).toBe(true)
      expect(isPbiAllowed(20001)).toBe(false)
    })

    it('isInvoiceAllowed returns true when INVOICE_ONLY_FULL_NO_SERVICES=false (current policy)', () => {
      // Current policy allows full+services and (UI-disabled) lease+invoice
      expect(isInvoiceAllowed('full', 0)).toBe(true)
      expect(isInvoiceAllowed('full', 148)).toBe(true)
      expect(isInvoiceAllowed('lease', 0)).toBe(true)
      expect(isInvoiceAllowed('lease', 99)).toBe(true)
    })

    it('isInvoiceAllowed would restrict correctly if policy flag were true (defensive test of the function)', () => {
      // We don't mutate the constant, but we can reason about the implementation branch
      // by calling with the knowledge of the flag value. This documents the contract.
      if (INVOICE_ONLY_FULL_NO_SERVICES) {
        expect(isInvoiceAllowed('full', 0)).toBe(true)
        expect(isInvoiceAllowed('full', 1)).toBe(false)
        expect(isInvoiceAllowed('lease', 0)).toBe(false)
      } else {
        // already asserted above
      }
    })
  })

  describe('SERVICE_KEYS (for i18n name lookup while prices come from here)', () => {
    it('exports exactly the service keys as array', () => {
      expect(SERVICE_KEYS).toEqual(['managedCare', 'secureVaultBackup'])
    })
  })

  describe('tier hardware customization (single logical component: TIER_SPEC_OPTIONS + pure fns)', () => {
    it('exports TIER_SPEC_OPTIONS with three slugs and ram/vram/disk lists containing labels + prices', () => {
      expect(TIER_SPEC_OPTIONS.edge).toBeDefined()
      expect(TIER_SPEC_OPTIONS.studio).toBeDefined()
      expect(TIER_SPEC_OPTIONS.forge).toBeDefined()
      ;(['edge','studio','forge'] as const).forEach(slug => {
        const t = TIER_SPEC_OPTIONS[slug]
        expect(Array.isArray(t.ram)).toBe(true)
        expect(Array.isArray(t.vram)).toBe(true)
        expect(Array.isArray(t.disk)).toBe(true)
        // each option has value, label (string, supports tech variants), price
        ;[...t.ram, ...t.vram, ...t.disk].forEach((o: any) => {
          expect(typeof o.value).toBe('number')
          expect(typeof o.label).toBe('string')
          expect(typeof o.price).toBe('number')
        })
      })
    })

    it('getSpecOptions returns the list for known slugs/keys and [] for unknown', () => {
      const ramEdge = getSpecOptions('edge', 'ram')
      expect(ramEdge.length).toBeGreaterThan(0)
      expect(ramEdge[0]).toHaveProperty('label')
      expect(getSpecOptions('edge', 'vram').length).toBeGreaterThan(0)
      expect(getSpecOptions('unknown' as any, 'ram')).toEqual([])
    })

    it('getDefaultOption returns the price===0 entry (or first) for each dimension', () => {
      const defRam = getDefaultOption('studio', 'ram')
      expect(defRam).not.toBeNull()
      // In our data the default for studio ram has price 0 and value 96
      expect(defRam!.price).toBe(0)
      expect(defRam!.value).toBe(96)
    })

    it('getOptionPrice returns the listed price for an exact value match, 0 otherwise or for unknown slug', () => {
      expect(getOptionPrice('edge', 'vram', 24)).toBe(420) // non-default
      expect(getOptionPrice('edge', 'vram', 16)).toBe(0)   // default
      expect(getOptionPrice('edge', 'vram', 999)).toBe(0)
      expect(getOptionPrice('unknown' as any, 'disk', 1)).toBe(0)
    })

    it('calculateHardwarePrice returns base when no customization or all defaults', () => {
      const baseEdge = HARDWARE_PRICES.edge
      expect(calculateHardwarePrice('edge')).toBe(baseEdge)
      // explicit defaults (price 0 options)
      const defaults = {
        ram: getDefaultOption('edge', 'ram')!,
        vram: getDefaultOption('edge', 'vram')!,
        disk: getDefaultOption('edge', 'disk')!,
      }
      expect(calculateHardwarePrice('edge', defaults)).toBe(baseEdge)
    })

    it('calculateHardwarePrice adds the option prices for chosen values (per-appliance)', () => {
      // edge: pick 32 GB ram (+280) + 24 GB vram (+420) + 2 TB HDD (+350)
      const up = {
        ram: { value: 32, label: '32 GB' },
        vram: { value: 24, label: '24 GB' },
        disk: { value: 2, label: '2 TB HDD' },
      }
      const expectedExtra = 280 + 420 + 350
      expect(calculateHardwarePrice('edge', up)).toBe(HARDWARE_PRICES.edge + expectedExtra)
    })

    it('calculateHardwarePrice handles mixed (some dimensions customized, others default)', () => {
      const partial = { vram: { value: 24, label: '24 GB' } } // +420 on edge
      expect(calculateHardwarePrice('edge', partial)).toBe(HARDWARE_PRICES.edge + 420)
    })

    it('formatHardwareCustomization produces a compact label string using the stored labels (tech variants preserved)', () => {
      const c = {
        ram: { value: 24, label: '24 GB' },
        disk: { value: 2, label: '2 TB HDD' },
      }
      const s = formatHardwareCustomization(c)
      expect(s).toContain('24 GB')
      expect(s).toContain('2 TB HDD')
      expect(formatHardwareCustomization(undefined)).toBe('')
    })

    it('different tech labels for same numeric value are supported and distinguishable', () => {
      // In our sample data edge disk has two options with different labels.
      const diskOpts = getSpecOptions('edge', 'disk')
      const labels = diskOpts.map(o => o.label)
      expect(labels).toContain('1 TB NVMe')
      expect(labels).toContain('2 TB HDD')
      // prices can differ
      expect(getOptionPrice('edge', 'disk', 1)).not.toBe(getOptionPrice('edge', 'disk', 2))
    })
  })
})
